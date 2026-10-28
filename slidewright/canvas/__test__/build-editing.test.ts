import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Component, SourceFile } from '../../runtime/ast.js';
import { booleanLit, omitLit, listLit, makeComponent, numberLit, slotFill, stringLit } from '../../runtime/ast-builders.js';
import { buildObjects, buildProperty, objectId, type BuildDirection } from '../../runtime/builds.js';
import { DeckDocument, type DocumentSnapshot } from '../../runtime/document.js';
import { commitSourceEdit, findActiveSlideFreeform, removeShapeAtSpan } from '../ast-edits.js';
import { commitBuildPropertyEdit, commitBuildSourceCandidate, createBuildEditingSnapshot, hasBuildEditingContext } from '../build-editing.js';
import { copyElements, pasteElements } from '../element-clipboard.js';

const source = `// untouched header
Deck { slides: [
  Slide { content: Freeform { id: "scene" children: [
    // keep this object comment
    Box { id:"box" x:1.50 y:2 width:30 }
    TextBox { id:"text" content: "initial" }
  ] } builds: [
    Build { id:"one" changes: [Change { target:"box" x:100 } Change { target:"text" content: "overridden" }] }
    Build { id:"two" changes: [] }
    Build { id:"three" changes: [Change { target:"box" x:300 }] }
  ] }
  // untouched later slide
  Slide { content: TextBox { content: "later" } }
] }
// untouched EOF
`;
const field = (node: Component, name: string) => node.fills.find(fill => fill.name === name)?.value;
const slide = (ast: SourceFile): Component => {
  const slides = field(ast.items[0]!, 'slides');
  assert.equal(slides?.kind, 'list');
  return (slides as ReturnType<typeof listLit>).items[0] as Component;
};
const object = (ast: SourceFile, id = 'box') => buildObjects(slide(ast)).find(node => objectId(node) === id)!;
const setup = (buildIndex = 2, direction: BuildDirection = 'forward', input = source) => {
  const document = new DeckDocument(input, 'build-edit.sw');
  const snapshot = createBuildEditingSnapshot(document.snapshot, { slideIndex: 0, buildIndex, direction });
  return { document, snapshot };
};
const numeric = (ast: SourceFile, frame: number, property = 'x', id = 'box') => {
  const value = buildProperty(slide(ast), frame, id, property).value;
  return value?.kind === 'number' ? value.value : undefined;
};
const range = (node: Component) => ({ start: node.span.start.offset, end: node.span.end.offset });
function drag(snapshot: DocumentSnapshot, dx = 10) {
  return commitSourceEdit(snapshot.source, 'move', ast => {
    const node = object(ast);
    const x = field(node, 'x');
    assert.equal(x?.kind, 'number');
    if (x?.kind !== 'number') return null;
    x.value += dx;
    return { preserveSelections: [{ slideIdx: 0, childIdx: 0 }] };
  }, snapshot);
}

test('real source transactions move relative to effective keyframes, preserve source, canonical selection and revisions', () => {
  const { document, snapshot } = setup();
  const original = document.snapshot;
  const result = drag(snapshot)!;
  assert.ok(result);
  assert.equal(numeric(result.ast, 0), 1.5);
  assert.equal(numeric(result.ast, 1), 100);
  assert.equal(numeric(result.ast, 2), 110);
  assert.equal(numeric(result.ast, 3), 300);
  assert.equal(result.baseRevision, original.revision);
  assert.ok(result.newSource.includes('Box { id:"box" x:1.50 y:2 width:30 }'));
  assert.ok(result.newSource.includes('// keep this object comment'));
  assert.ok(result.newSource.endsWith(source.slice(source.indexOf('  // untouched later slide'))));
  assert.deepEqual(result.newSelections, [range(object(result.ast))]);
  assert.equal(document.snapshot, original);
  assert.equal(snapshot.ast, original.ast);
  document.updateSource(result.newSource, 'build-edit.sw', { changes: result.changes, baseRevision: result.baseRevision });
  assert.equal(numeric(document.snapshot.ast as SourceFile, 2), 110);
  // Source history can restore the exact canonical input.
  document.updateSource(source);
  assert.equal(document.snapshot.source, source);
  assert.equal(numeric(document.snapshot.ast as SourceFile, 2), 100);
  assert.equal(drag(snapshot, 20)?.newSource.includes('x: 120'), true);
  assert.equal(commitSourceEdit('other', 'stale', () => ({}), snapshot), null);
});

test('backward grouped edits restore defaults and coordinates at the next frame', () => {
  const { snapshot } = setup(2, 'backward');
  const result = commitBuildPropertyEdit(source, 'move', snapshot, 'box', { x: numberLit(140), y: numberLit(12), opacity: numberLit(0.5) })!;
  assert.ok(result);
  assert.equal(numeric(result.ast, 0), 1.5);
  assert.equal(numeric(result.ast, 1), 100);
  assert.equal(numeric(result.ast, 2), 140);
  assert.equal(numeric(result.ast, 2, 'y'), 12);
  assert.equal(numeric(result.ast, 3, 'y'), 2);
  assert.equal(numeric(result.ast, 3, 'opacity'), undefined);
  assert.match(result.newSource, /opacity: omit/);
});

test('horizontal gestures respect a later barrier on the unchanged y coordinate', () => {
  const input = source.replace('target:"box" x:300', 'target:"box" y:2');
  const { snapshot } = setup(2, 'forward', input);
  const result = commitSourceEdit(input, '<drag>', ast => {
    const x = field(object(ast), 'x');
    if (x?.kind !== 'number') return null;
    x.value += 10;
    return {};
  }, snapshot)!;
  assert.ok(result);
  assert.equal(numeric(result.ast, 2), 110);
  assert.equal(numeric(result.ast, 3), 100);
  assert.equal(numeric(result.ast, 3, 'y'), 2);
});

test('pasted scene objects receive fresh IDs, including copied inline identities', () => {
  const input = source.replace('content: "initial"', 'content: [Paragraph { id: "paragraph" content: ["initial"] }]');
  const { snapshot } = setup(2, 'forward', input);
  const result = commitSourceEdit(input, '<paste>', ast => {
    const freeform = findActiveSlideFreeform(ast, 0)!;
    const children = field(freeform, 'children');
    if (children?.kind !== 'list') return null;
    const pasted = structuredClone(children.items[1]) as Component;
    children.items.push(pasted);
    return { selectComponents: [pasted] };
  }, snapshot)!;
  assert.ok(result);
  const objects = buildObjects(slide(result.ast));
  const ids = objects.map(objectId).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(objects.filter(node => node.name === 'TextBox').length, 2);
  assert.equal(result.newSelections.length, 1);
});

test('copy and paste use the displayed values and preserve earlier builds', () => {
  const { snapshot } = setup();
  const target = { kind: 'component' as const, span: range(object(snapshot.ast as SourceFile)) };
  const clipboard = copyElements(source, [target], snapshot)!;
  assert.match(clipboard, /x: 100/);
  const result = pasteElements(source, [target], 0, clipboard, snapshot)!;
  assert.ok(result);
  const pasted = buildObjects(slide(result.ast)).filter(node => node.name === 'Box')[1]!;
  assert.notEqual(objectId(pasted), 'box');
  assert.equal(field(pasted, 'x')?.kind === 'number' && (field(pasted, 'x') as { value: number }).value, 100);
  assert.equal(buildProperty(slide(result.ast), 0, objectId(pasted)!, 'visible').value?.kind, 'boolean');
});

test('slide metadata remains slide-owned when a build is selected', () => {
  const input = source.replace('Slide { content:', 'Slide { label: "Diagram" content:');
  const { snapshot } = setup(2, 'forward', input);
  const result = commitBuildSourceCandidate(input.replace('label: "Diagram"', 'label: "New label"'), 'label', snapshot)!;
  assert.ok(result);
  assert.equal((field(slide(result.ast), 'label') as { value: string }).value, 'New label');
  assert.equal(field(slide(result.ast), 'id'), undefined);
  assert.equal(numeric(result.ast, 2), 100);
});

test('backward edits with no prior barrier include the initial frame and restore following values', () => {
  const { snapshot } = setup(1, 'backward');
  const result = commitBuildPropertyEdit(source, 'width', snapshot, 'box', { width: numberLit(99) })!;
  assert.ok(result);
  assert.equal(numeric(result.ast, 0, 'width'), 99);
  assert.equal(numeric(result.ast, 1, 'width'), 99);
  assert.equal(numeric(result.ast, 2, 'width'), 30);
});

for (const initial of [false, true]) test(`inspector candidate routes ${initial ? 'masked initial' : 'inherited Change'} value to selected frame`, () => {
  const { snapshot } = setup();
  const candidate = initial ? source.replace('x:1.50', 'x:175') : source.replace('x:100', 'x:175');
  const result = commitBuildSourceCandidate(candidate, 'scrub', snapshot)!;
  assert.ok(result);
  assert.equal(numeric(result.ast, 0), 1.5);
  assert.equal(numeric(result.ast, 1), 100);
  assert.equal(numeric(result.ast, 2), 175);
  assert.equal(numeric(result.ast, 3), 300);
  assert.deepEqual(result.newSelections, [range(object(result.ast))]);
  const repeated = commitBuildSourceCandidate(candidate.replace('175', '185'), 'scrub', snapshot)!;
  assert.equal(numeric(repeated.ast, 2), 185);
});

test('inherited candidate edits respect backward direction', () => {
  const { snapshot } = setup(1, 'backward');
  const result = commitBuildSourceCandidate(source.replace('x:100', 'x:180'), 'scrub', snapshot)!;
  assert.ok(result);
  assert.equal(numeric(result.ast, 0), 180);
  assert.equal(numeric(result.ast, 1), 180);
  assert.equal(numeric(result.ast, 2), 100);
  assert.equal(numeric(result.ast, 3), 300);
});

test('insertion authors one hidden definition, visibility from selected frame, and canonical selection', () => {
  const { snapshot } = setup();
  const result = commitSourceEdit(source, 'insert', ast => {
    const parent = findActiveSlideFreeform(ast, 0)!;
    const children = field(parent, 'children');
    if (children?.kind !== 'list') return null;
    const inserted = makeComponent('Box', [slotFill('x', numberLit(44))]);
    children.items.splice(1, 0, inserted);
    return { selectComponents: [inserted] };
  }, snapshot)!;
  assert.ok(result);
  const inserted = buildObjects(slide(result.ast)).find(node => field(node, 'x')?.kind === 'number' && (field(node, 'x') as { value: number }).value === 44)!;
  const id = objectId(inserted)!;
  assert.ok(id);
  assert.equal((buildProperty(slide(result.ast), 1, id, 'visible').value as { value: boolean }).value, false);
  assert.equal((buildProperty(slide(result.ast), 2, id, 'visible').value as { value: boolean }).value, true);
  assert.deepEqual(result.newSelections, [range(inserted)]);
  assert.equal(buildObjects(slide(result.ast)).filter(node => objectId(node) === id).length, 1);
});

test('deletion hides the definition from selected frame onward, preserving IDs for restoration', () => {
  const { snapshot } = setup();
  const result = commitSourceEdit(source, 'delete', ast => {
    assert.ok(removeShapeAtSpan(ast, range(object(ast))));
    return {};
  }, snapshot)!;
  assert.ok(result);
  assert.equal(objectId(object(result.ast)), 'box');
  for (const frame of [0, 1]) assert.equal(buildProperty(slide(result.ast), frame, 'box', 'visible').value?.kind, 'boolean');
  assert.equal((buildProperty(slide(result.ast), 2, 'box', 'visible').value as { value: boolean }).value, false);
  const later = setup(3, 'forward', result.newSource).snapshot;
  const restored = commitBuildPropertyEdit(result.newSource, 'restore', later, 'box', { visible: booleanLit(true) })!;
  assert.ok(restored);
  assert.equal(objectId(object(restored.ast)), 'box');
  assert.equal((buildProperty(slide(restored.ast), 3, 'box', 'visible').value as { value: boolean }).value, true);
});

test('rich text changes keyframe one scene owner content, preserving initial and prior payloads', () => {
  const { snapshot } = setup();
  const result = commitSourceEdit(source, 'text', ast => {
    const owner = object(ast, 'text');
    assert.equal((field(owner, 'content') as { value: string }).value, 'overridden');
    const paragraph = makeComponent('Paragraph', [slotFill('content', listLit([stringLit('edited'), makeComponent('Span', [slotFill('content', stringLit(' marked'))])]))]);
    owner.fills.find(fill => fill.name === 'content')!.value = listLit([paragraph]);
    return { selectComponents: [paragraph] };
  }, snapshot)!;
  assert.ok(result);
  assert.ok(result.newSource.includes('content: "initial"'));
  assert.ok(result.newSource.includes('content: "overridden"'));
  assert.equal(buildProperty(slide(result.ast), 2, 'text', 'content').value?.kind, 'list');
  assert.deepEqual(result.newSelections, [range(object(result.ast, 'text'))]);
  assert.equal(buildObjects(slide(result.ast)).filter(node => node.name === 'Freeform').length, 1);
});

test('text inspector splice captures inherited content without rewriting originating payload', () => {
  const { snapshot } = setup();
  const result = commitBuildSourceCandidate(source.replace('"overridden"', '"edited content"'), 'text', snapshot)!;
  assert.ok(result);
  assert.ok(result.newSource.includes('content: "overridden"'));
  const content = buildProperty(slide(result.ast), 2, 'text', 'content').value;
  assert.equal(content?.kind === 'string' && content.value, 'edited content');
});

test('grouping, reordering, cross-slide edits, identity changes and unrecognized candidate edits abort', () => {
  const { snapshot } = setup();
  for (const operation of ['reorder', 'group', 'identity', 'outside']) {
    const result = commitSourceEdit(source, operation, ast => {
      const parent = findActiveSlideFreeform(ast, 0)!;
      const children = field(parent, 'children');
      if (children?.kind !== 'list') return null;
      if (operation === 'reorder') children.items.reverse();
      if (operation === 'group') children.items = [makeComponent('Freeform', [slotFill('children', listLit(children.items))])];
      if (operation === 'identity') object(ast).fills.find(fill => fill.name === 'id')!.value = stringLit('different');
      if (operation === 'outside') ast.items[0]!.fills.push(slotFill('name', stringLit('global')));
      return {};
    }, snapshot);
    assert.equal(result, null, operation);
  }
  assert.equal(commitBuildSourceCandidate(source.replace('untouched header', 'changed header'), 'comment', snapshot), null);
});

test('undecorated snapshots and plain slides retain canonical editing behavior', () => {
  const { document } = setup();
  const canonical = commitSourceEdit(source, 'canonical', ast => {
    const node = object(ast);
    (field(node, 'x') as { value: number }).value = 12;
    return {};
  }, document.snapshot)!;
  assert.equal(numeric(canonical.ast, 0), 12);
  assert.equal(numeric(canonical.ast, 2), 100);
  const plain = new DeckDocument('Deck { slides: [Slide { content: Box { x: 2 } }] }', 'plain.sw').snapshot;
  assert.equal(createBuildEditingSnapshot(plain, { slideIndex: 0, buildIndex: 0 }), plain);
  const result = commitSourceEdit(plain.source, 'plain', ast => {
    (field(objectByName(ast, 'Box'), 'x') as { value: number }).value += 3;
    return {};
  }, plain)!;
  assert.match(result.newSource, /x: 5/);
});
function objectByName(ast: SourceFile, name: string): Component {
  return buildObjects(slide(ast)).find(node => node.name === name)!;
}


test('registry-defined text slots lower nested edits into the outer owner property', () => {
  const input = source.replace('TextBox { id:"text" content: "initial" }',
    'CustomText { id:"text" children: [Span { content: "inline" }] }');
  const document = new DeckDocument(input, 'custom.sw');
  const snapshot = createBuildEditingSnapshot(document.snapshot, {
    slideIndex: 0, buildIndex: 2,
    registry: { CustomText: { meta: { produces: 'block', slots: { children: { type: 'text' } } }, render: () => null } },
  });
  assert.equal(hasBuildEditingContext(snapshot), true);
  const result = commitSourceEdit(input, 'inline', ast => {
    const owner = object(ast, 'text');
    const children = field(owner, 'children');
    assert.equal(children?.kind, 'list');
    const inline = (children as ReturnType<typeof listLit>).items[0] as Component;
    inline.fills.find(fill => fill.name === 'content')!.value = stringLit('edited inline');
    return { selectComponents: [inline] };
  }, snapshot)!;
  assert.ok(result);
  const children = buildProperty(slide(result.ast), 2, 'text', 'children').value;
  assert.equal(children?.kind, 'list');
  assert.ok(result.newSource.includes('children: [Span { content: "inline" }]'));
  assert.deepEqual(result.newSelections, [range(object(result.ast, 'text'))]);
  assert.ok(result.newSource.includes('target: "text"'));
});

test('implicit child insertion and deletion retain definitions and original surface syntax', () => {
  const input = 'Deck { slides: [Slide { content: Freeform { Box { id:"box" x:1 } TextBox { id:"text" content:"hi" } } builds: [Build { id:"one" changes:[] }] }] }';
  const { snapshot } = setup(1, 'backward', input);
  const result = commitSourceEdit(input, 'implicit', ast => {
    const freeform = findActiveSlideFreeform(ast, 0)!;
    freeform.implicitChildren.shift();
    const added = makeComponent('Box', [slotFill('x', numberLit(22))]);
    freeform.implicitChildren.push(added);
    return { selectComponents: [added] };
  }, snapshot)!;
  assert.ok(result);
  assert.ok(result.newSource.includes('Box { id:"box" x:1 }'));
  assert.ok(!result.newSource.includes('children:'));
  assert.equal((buildProperty(slide(result.ast), 1, 'box', 'visible').value as { value: boolean }).value, false);
  const added = findComponentAtRange(result.ast, result.newSelections[0]!);
  const id = objectId(added)!;
  assert.equal((buildProperty(slide(result.ast), 0, id, 'visible').value as { value: boolean }).value, false);
  assert.equal((buildProperty(slide(result.ast), 1, id, 'visible').value as { value: boolean }).value, true);
});
function findComponentAtRange(ast: SourceFile, target: { start: number; end: number }): Component {
  return buildObjects(slide(ast)).find(node => node.span.start.offset === target.start && node.span.end.offset === target.end)!;
}

test('explicit property groups retain equal-valued members as scope barriers', () => {
  const input = source.replace('target:"box" x:300', 'target:"box" y:300');
  const { snapshot } = setup(2, 'forward', input);
  const result = commitBuildPropertyEdit(input, 'group', snapshot, 'box', { x: numberLit(100), y: numberLit(12) })!;
  assert.ok(result);
  assert.equal(numeric(result.ast, 2), 100);
  assert.equal(numeric(result.ast, 3), 100);
  assert.match(result.newSource, /target: "box"[\s\S]*x: 100[\s\S]*y: 12/);
});

test('everywhere source transactions replace positioning keys without changing content or visibility', () => {
  const { snapshot } = setup(2, 'everywhere');
  const result = drag(snapshot)!;
  assert.ok(result);
  for (let frame = 0; frame < 4; frame++) assert.equal(numeric(result.ast, frame), 110);
  assert.equal((buildProperty(slide(result.ast), 0, 'text', 'content').value as { value: string }).value, 'initial');
  assert.equal((buildProperty(slide(result.ast), 1, 'text', 'content').value as { value: string }).value, 'overridden');
  assert.ok(result.newSource.includes('// untouched later slide'));
  assert.equal(snapshot.source, source);
});

test('effective property removal authors omit rather than changing the initial definition', () => {
  const { snapshot } = setup();
  const result = commitSourceEdit(source, 'reset', ast => {
    const owner = object(ast);
    owner.fills = owner.fills.filter(fill => fill.name !== 'x');
    return {};
  }, snapshot)!;
  assert.ok(result);
  assert.equal(numeric(result.ast, 0), 1.5);
  assert.equal(numeric(result.ast, 1), 100);
  assert.equal(numeric(result.ast, 2), undefined);
  assert.equal(numeric(result.ast, 3), 300);
  assert.match(result.newSource, /x: omit/);
  const explicit = commitBuildPropertyEdit(source, 'reset', snapshot, 'box', { x: omitLit() })!;
  assert.equal(numeric(explicit.ast, 2), undefined);
});

test('build no-op remains byte-identical and singleton removal retains a hidden definition', () => {
  const input = 'Deck { slides: [Slide { content: Box { id:"box" x:1 } builds: [Build { id:"one" changes:[] }] }] }';
  const { snapshot } = setup(1, 'forward', input);
  const noop = commitSourceEdit(input, 'noop', () => ({}), snapshot)!;
  assert.ok(noop);
  assert.equal(noop.newSource, input);
  assert.deepEqual(noop.changes, []);
  const result = commitSourceEdit(input, 'remove slot', ast => {
    slide(ast).fills = slide(ast).fills.filter(fill => fill.name !== 'content');
    return {};
  }, snapshot)!;
  assert.ok(result);
  assert.equal(objectId(object(result.ast)), 'box');
  assert.equal((buildProperty(slide(result.ast), 1, 'box', 'visible').value as { value: boolean }).value, false);
});
