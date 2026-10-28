import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Component, Value } from '../ast.js';
import { parse } from '../parser.js';
import { emit } from '../emitter.js';
import { booleanLit, listLit, numberLit, omitLit, stringLit } from '../ast-builders.js';
import {
  addBuild, buildDifferences, buildEditRange, buildFrames, buildObjects, buildProperty,
  duplicateBuild, editBuildProperties, ensureBuildObjectIds, moveBuild, objectId,
  removeBuild, resolveBuild, toggleBuildKeyframe, validateBuilds,
} from '../builds.js';
import { commitSourceEdit } from '../../canvas/ast-edits.js';
import { DeckDocument } from '../document.js';

const source = `// keep deck comment
Deck { slides: [
  Slide { label: "diagram" content: Freeform { children: [
    // hand-authored shape
    Box { id: "node" x: 100 y: 20 width: 40 height: 30 fill: oklch(0.7 0.1 40) }
    TextBox { id: "caption" content: "keep " "runs" }
  ] } }
  Slide { label:"untouched" content: TextBox { content: "later" } }
] }
`;
function initial(): Component {
  const parsed = parse(source, 'builds.sw');
  assert.deepEqual(parsed.diagnostics, []);
  const slides = parsed.ast.items[0]!.fills.find(fill => fill.name === 'slides')!.value;
  assert.equal(slides.kind, 'list');
  return structuredClone((slides as { items: Component[] }).items[0]!);
}
function scene(count = 5): Component {
  const slide = initial();
  for (let index = 1; index < count; index++) addBuild(slide, index - 1);
  return slide;
}
function scalar(value: Value | undefined): unknown {
  return value && 'value' in value ? value.value : value?.kind;
}
function values(slide: Component, property = 'x'): unknown[] {
  return buildFrames(slide).map(frame => scalar(buildProperty(slide, frame.index, 'node', property).value));
}

test('adding empty diffs authors stable IDs without copying scene objects', () => {
  const slide = initial();
  const before = buildObjects(slide).length;
  const first = addBuild(slide, 0);
  const ids = buildObjects(slide).map(objectId);
  addBuild(slide, 1);
  ensureBuildObjectIds(slide);
  assert.equal(first.index, 1);
  assert.equal(first.id, 'build-1');
  assert.equal(buildObjects(slide).length, before);
  assert.deepEqual(buildObjects(slide).map(objectId), ids);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(values(slide), [100, 100, 100]);
  assert.deepEqual(validateBuilds(slide), []);
});

test('adding builds canonicalizes nested implicit children before assigning IDs', () => {
  const input = `Deck { slides: [Slide { content: Freeform {
    // preserved container comment
    Stack {
      // preserved object comment
      TextBox { content: "keep " "runs" }
    }
  } }] }`;
  const document = new DeckDocument(input, 'implicit-build.sw');
  const result = commitSourceEdit(input, '<build-add>', ast => {
    const slides = ast.items[0]!.fills[0]!.value;
    assert.equal(slides.kind, 'list');
    addBuild((slides as { items: Component[] }).items[0]!, 0);
    return {};
  }, document.snapshot);
  assert.ok(result);
  assert.deepEqual(parse(result.newSource, 'after.sw').diagnostics, []);
  assert.ok(result.newSource.includes('// preserved container comment'));
  assert.ok(result.newSource.includes('// preserved object comment'));
  assert.ok(result.newSource.includes('content: "keep " "runs"'));
  const slide = (result.ast.items[0]!.fills[0]!.value as { items: Component[] }).items[0]!;
  const objects = buildObjects(slide);
  assert.deepEqual(objects.map(object => object.name), ['Freeform', 'Stack', 'TextBox']);
  assert.ok(objects.every(object => objectId(object) && !object.implicitChildren.length));
  const ids = objects.map(objectId);
  addBuild(slide, 1);
  assert.deepEqual(buildObjects(slide).map(objectId), ids);
});

test('forward edits stop at equal-valued pins, independently per property', () => {
  const slide = scene();
  toggleBuildKeyframe(slide, 3, 'node', 'x');
  assert.equal(buildProperty(slide, 3, 'node', 'x').keyframed, true);
  assert.deepEqual(buildDifferences(slide, 3), []);
  assert.deepEqual(editBuildProperties(slide, 1, 'node', { x: numberLit(200) }), { first: 1, last: 2 });
  assert.deepEqual(values(slide), [100, 200, 200, 100, 100]);
  editBuildProperties(slide, 1, 'node', { y: numberLit(50) });
  assert.deepEqual(values(slide, 'y'), [20, 50, 50, 50, 50]);
});

test('unpin inherits from the previous keyframe, even after a backward edit', () => {
  const slide = scene();
  editBuildProperties(slide, 1, 'node', { x: numberLit(200) });
  editBuildProperties(slide, 3, 'node', { x: numberLit(350) });
  assert.equal(toggleBuildKeyframe(slide, 3, 'node', 'x'), false);
  assert.deepEqual(values(slide), [100, 200, 200, 200, 200]);
  assert.equal(buildProperty(slide, 4, 'node', 'x').origin, 1);
});

test('backward edits reach the initial frame and restore following values visibly', () => {
  const slide = scene(4);
  editBuildProperties(slide, 2, 'node', { x: numberLit(200) });
  assert.deepEqual(values(slide), [100, 100, 200, 200]);
  assert.deepEqual(editBuildProperties(slide, 2, 'node', { x: numberLit(250) }, 'backward'), { first: 0, last: 2 });
  assert.deepEqual(values(slide), [250, 250, 250, 200]);
  assert.equal(buildProperty(slide, 2, 'node', 'x').keyframed, false);
  assert.equal(buildProperty(slide, 3, 'node', 'x').keyframed, true);
  assert.equal(buildProperty(slide, 3, 'node', 'x').origin, 3);
});

test('backward propagation stops before earlier authored barriers', () => {
  const slide = scene(6);
  toggleBuildKeyframe(slide, 1, 'node', 'x');
  assert.deepEqual(buildEditRange(slide, 4, 'node', ['x'], 'backward'), { first: 2, last: 4 });
  editBuildProperties(slide, 4, 'node', { x: numberLit(700) }, 'backward');
  assert.deepEqual(values(slide), [100, 100, 700, 700, 700, 100]);
  assert.equal(buildProperty(slide, 1, 'node', 'x').keyframed, true);
});

test('grouped position edits use one range and restore the other coordinate at its edge', () => {
  const slide = scene();
  toggleBuildKeyframe(slide, 3, 'node', 'x');
  editBuildProperties(slide, 1, 'node', { x: numberLit(250), y: numberLit(90) });
  assert.deepEqual(values(slide), [100, 250, 250, 100, 100]);
  assert.deepEqual(values(slide, 'y'), [20, 90, 90, 20, 20]);
  assert.equal(buildProperty(slide, 3, 'node', 'y').keyframed, true);
});

test('pinning a default-valued property creates a barrier without a visual difference', () => {
  const slide = scene();
  toggleBuildKeyframe(slide, 3, 'node', 'opacity', numberLit(1));
  editBuildProperties(slide, 1, 'node', { opacity: numberLit(0.2) });
  assert.deepEqual(values(slide, 'opacity'), [undefined, 0.2, 0.2, 1, 1]);
  assert.equal(buildProperty(slide, 3, 'node', 'opacity').keyframed, true);
  // A pin can be an authored boundary without changing the effective scene.
  const defaultOpacity = (_object: Component, property: string) => property === 'opacity' ? numberLit(1) : undefined;
  const pinnedOnly = scene();
  toggleBuildKeyframe(pinnedOnly, 3, 'node', 'opacity', numberLit(1));
  assert.deepEqual(buildDifferences(pinnedOnly, 3, defaultOpacity), []);
});

test('restoration of an absent optional value uses an explicit default reset', () => {
  const slide = scene();
  editBuildProperties(slide, 2, 'node', { opacity: numberLit(0.4) }, 'backward');
  assert.deepEqual(values(slide, 'opacity'), [0.4, 0.4, 0.4, undefined, undefined]);
  assert.equal(buildProperty(slide, 3, 'node', 'opacity').keyframed, true);
  const projected = resolveBuild(slide, 3);
  assert.equal(buildObjects(projected).find(object => objectId(object) === 'node')!.fills.some(fill => fill.name === 'opacity'), false);
  toggleBuildKeyframe(slide, 3, 'node', 'opacity');
  assert.deepEqual(values(slide, 'opacity'), [0.4, 0.4, 0.4, 0.4, 0.4]);
});

test('hide, edit while absent, and restore preserve identity and the latest geometry', () => {
  const slide = scene();
  editBuildProperties(slide, 1, 'node', { visible: booleanLit(false) });
  editBuildProperties(slide, 2, 'node', { x: numberLit(300) });
  editBuildProperties(slide, 3, 'node', { visible: booleanLit(true) });
  assert.deepEqual(values(slide, 'visible'), [true, false, false, true, true]);
  assert.deepEqual(values(slide), [100, 100, 300, 300, 300]);
  assert.equal(buildDifferences(slide, 1).find(change => change.id === 'node')!.exiting, true);
  assert.equal(buildDifferences(slide, 3).find(change => change.id === 'node')!.entering, true);
  assert.equal(buildObjects(resolveBuild(slide, 3)).filter(object => objectId(object) === 'node').length, 1);
});

test('projection preserves owner spans, supports structured content, and never mutates authored nodes', () => {
  const slide = scene();
  const originalObject = buildObjects(slide).find(object => objectId(object) === 'caption')!;
  editBuildProperties(slide, 2, 'caption', { content: stringLit('new caption') });
  const before = structuredClone(slide);
  const projected = resolveBuild(slide, 2);
  const caption = buildObjects(projected).find(object => objectId(object) === 'caption')!;
  assert.deepEqual(caption.span, originalObject.span);
  assert.equal(scalar(caption.fills.find(fill => fill.name === 'content')!.value), 'new caption');
  assert.deepEqual(slide, before);
  assert.equal(projected.fills.some(fill => fill.name === 'builds'), false);
});

test('duplicate, pin, reorder implements an explicit return after emphasis', () => {
  const slide = scene(2);
  editBuildProperties(slide, 1, 'node', { x: numberLit(250), opacity: numberLit(0.2) });
  const duplicate = duplicateBuild(slide, 0);
  assert.equal(duplicate.index, 1);
  // Capture the otherwise-default opacity as part of the return state.
  toggleBuildKeyframe(slide, 1, 'node', 'opacity', numberLit(1));
  moveBuild(slide, 1, 2);
  assert.deepEqual(values(slide), [100, 250, 100]);
  assert.deepEqual(values(slide, 'opacity'), [undefined, 0.2, 1]);
  assert.equal(buildObjects(slide).filter(object => objectId(object) === 'node').length, 1);
  assert.deepEqual(validateBuilds(slide), []);
  removeBuild(slide, 1);
  assert.deepEqual(values(slide), [100, 100]);
});

test('duplicating an empty build keeps inheritance rather than snapshotting all properties', () => {
  const slide = scene(2);
  duplicateBuild(slide, 1);
  editBuildProperties(slide, 0, 'node', { x: numberLit(500) });
  assert.deepEqual(values(slide), [500, 500, 500]);
});

test('duplicating the initial scene captures structured text as a return value', () => {
  const slide = initial();
  const caption = buildObjects(slide).find(object => objectId(object) === 'caption')!;
  caption.fills.find(fill => fill.name === 'content')!.value = listLit([parse('Paragraph { content: ["original"] }', 'text.sw').ast.items[0]!]);
  addBuild(slide, 0);
  editBuildProperties(slide, 1, 'caption', { content: stringLit('temporary') });
  duplicateBuild(slide, 0);
  moveBuild(slide, 1, 2);
  assert.equal(buildProperty(slide, 1, 'caption', 'content').value?.kind, 'string');
  assert.equal(buildProperty(slide, 2, 'caption', 'content').value?.kind, 'list');
});

test('source transactions retain authored comments and untouched slides through build edits', () => {
  const document = new DeckDocument(source, 'builds.sw');
  const later = source.slice(source.indexOf('  Slide { label:"untouched"'));
  const result = commitSourceEdit(source, 'build', ast => {
    const slides = ast.items[0]!.fills.find(fill => fill.name === 'slides')!.value;
    if (slides.kind !== 'list' || slides.items[0]?.kind !== 'component') return null;
    const slide = slides.items[0];
    addBuild(slide, 0);
    editBuildProperties(slide, 1, 'node', { x: numberLit(200) });
    toggleBuildKeyframe(slide, 1, 'node', 'y');
    return {};
  }, document.snapshot)!;
  assert.ok(result);
  assert.ok(result.newSource.endsWith(later));
  assert.ok(result.newSource.includes('// hand-authored shape'));
  assert.ok(result.newSource.includes('"keep " "runs"'));
  const update = document.updateSource(result.newSource, 'builds.sw', { changes: result.changes });
  assert.ok(update);
  const parsed = parse(result.newSource, 'builds.sw');
  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(emit(parse(emit(parsed.ast), 'again.sw').ast), emit(parsed.ast));
});

test('invalid identities, frame indices, and reserved edits fail clearly', () => {
  const slide = scene(2);
  assert.throws(() => removeBuild(slide, 0), /initial/);
  assert.throws(() => moveBuild(slide, 0, 1), /initial/);
  assert.throws(() => editBuildProperties(slide, 99, 'node', { x: numberLit(1) }), /index/);
  assert.throws(() => editBuildProperties(slide, 1, 'unknown', { x: numberLit(1) }), /Unknown/);
  assert.throws(() => editBuildProperties(slide, 1, 'node', { id: stringLit('new') }), /reserved/);
  assert.throws(() => toggleBuildKeyframe(slide, 0, 'node', 'x'), /Initial/);
  assert.deepEqual(values(slide), [100, 100]);
  const objects = buildObjects(slide);
  objects[0]!.fills.find(fill => fill.name === 'id')!.value = stringLit('node');
  assert.ok(validateBuilds(slide).some(error => error.includes('Duplicate build object ID')));
});

test('default resets and unrelated styling do not become identity or movement changes', () => {
  const slide = scene(2);
  editBuildProperties(slide, 1, 'node', { fill: omitLit() });
  const differences = buildDifferences(slide, 1);
  assert.deepEqual(differences, [{ id: 'node', entering: false, exiting: false, properties: ['fill'] }]);
  assert.deepEqual(values(slide), [100, 100]);
});

test('many directional edits preserve every frame outside the advertised range', () => {
  const slide = scene(8);
  // Deterministic varied command sequence, checked against resolved scenes
  // rather than reproducing the implementation's boundary algorithm.
  let seed = 481;
  const random = (limit: number): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % limit;
  };
  for (let iteration = 0; iteration < 100; iteration++) {
    const index = random(8);
    const direction = random(2) ? 'forward' : 'backward';
    const properties = iteration % 3 === 0 ? ['x', 'y'] : [iteration % 2 ? 'x' : 'y'];
    if (iteration % 7 === 0) toggleBuildKeyframe(slide, 1 + random(7), 'node', properties[0]!);
    const before = { x: values(slide, 'x'), y: values(slide, 'y') };
    const desired = 1000 + iteration;
    const changes = Object.fromEntries(properties.map(property => [property, numberLit(desired)]));
    const range = editBuildProperties(slide, index, 'node', changes, direction);
    assert.ok(range.first <= index && range.last >= index);
    if (direction === 'forward') assert.equal(range.first, index);
    else assert.equal(range.last, index);
    for (const property of ['x', 'y'] as const) {
      const after = values(slide, property);
      for (let frame = 0; frame < 8; frame++) {
        assert.equal(after[frame], properties.includes(property) && frame >= range.first && frame <= range.last
          ? desired : before[property][frame], `edit ${iteration}, ${property}, frame ${frame}`);
      }
    }
    assert.deepEqual(validateBuilds(slide), []);
  }
});

test('visibility reset returns to visible, including after a bounded backward hide', () => {
  const slide = scene(3);
  editBuildProperties(slide, 1, 'node', { visible: booleanLit(false) }, 'backward');
  assert.deepEqual(values(slide, 'visible'), [false, false, true]);
  editBuildProperties(slide, 1, 'node', { visible: omitLit() });
  assert.deepEqual(values(slide, 'visible'), [false, true, true]);
});

test('everywhere replaces earlier and later property barriers while preserving unrelated keys', () => {
  const slide = scene(5);
  editBuildProperties(slide, 1, 'node', { x: numberLit(200), visible: booleanLit(false) });
  editBuildProperties(slide, 3, 'node', { x: numberLit(400), y: numberLit(90) });
  const beforeY = values(slide, 'y');
  const beforeVisible = values(slide, 'visible');
  assert.deepEqual(editBuildProperties(slide, 2, 'node', { x: numberLit(150) }, 'everywhere'), { first: 0, last: 4 });
  assert.deepEqual(values(slide), [150, 150, 150, 150, 150]);
  assert.deepEqual(values(slide, 'y'), beforeY);
  assert.deepEqual(values(slide, 'visible'), beforeVisible);
  for (let i = 1; i < 5; i++) assert.equal(buildProperty(slide, i, 'node', 'x').keyframed, false);
  assert.deepEqual(validateBuilds(slide), []);
});

test('malformed metadata produces validation errors rather than silently ignoring changes', () => {
  const malformed = `Slide { content: Box { id: "node" } builds: [
    Build { id: "b" changes: [Change { target: "missing" x: 1 }] }
    Build { id: "c" changes: [Change { target: "node" visible: 3 } Change { target: "node" x: 2 }] }
  ] }`;
  const slide = parse(malformed, 'invalid.sw').ast.items[0]!;
  assert.deepEqual(validateBuilds(slide), [
    'Unknown build object: missing', 'Visibility keyframes must be boolean', 'Duplicate build target: node',
  ]);
  const duplicate = parse('Slide { builds: [Build { id: "b" } Build { id: "b" }] }', 'invalid.sw').ast.items[0]!;
  assert.ok(validateBuilds(duplicate).some(error => error.includes('unique')));
});
