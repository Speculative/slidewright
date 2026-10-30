import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { DeckDocument } from '../document.js';
import { DeckResolver, loadDeck } from '../loader.js';
import { objectId } from '../builds.js';
import type { ComponentRegistry, ComponentRenderProps } from '../contract.js';
import { components } from '../../../decks/v0-reference/registry.js';

const source = `Deck { slides: [
  Slide { content: Freeform { id: "scene" children: [
    Box { id: "box" x: 10 y: 20 width: 100 height: 50 visible: false }
    TextBox { id: "text" content: "before" }
  ] }
  builds: [
    Build { id: "enter" label: "Enter" changes: [Change { target: "box" visible: true x: 40 opacity: 0.25 }] }
    Build { id: "rename" changes: [Change { target: "text" content: "after" }] }
    Build { id: "reset" changes: [Change { target: "box" x: omit opacity: omit }] }
  ] }
  Slide { content: Box { x: 5 } }
] }`;
const load = (buildIndex = 0, text = source) => loadDeck({ source: text, file: 'builds.sw', components,
  buildIndices: new Map([[0, buildIndex]]) });
const html = (result: ReturnType<typeof loadDeck>) => result.slides.map(slide => renderToStaticMarkup(slide)).join('');
const shape = (result: ReturnType<typeof loadDeck>, id: string) => [...result.shapes.values()].find(data => objectId(data.comp) === id)!;

test('build selection projects forward, resets defaults, and preserves authored owner/value locations', () => {
  const initial = load();
  const entered = load(1);
  const renamed = load(2);
  const reset = load(3);
  for (const result of [initial, entered, renamed, reset]) {
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.slides.length, 2);
    assert.equal(result.slidesData.length, 2);
  }
  assert.equal(shape(initial, 'box').params.x, 10);
  assert.equal(shape(entered, 'box').params.x, 40);
  assert.equal(shape(renamed, 'box').params.x, 40);
  assert.equal(shape(reset, 'box').params.x, 0);
  assert.equal(shape(entered, 'box').comp.span.start.offset, source.indexOf('Box { id: "box"'));
  const x = shape(entered, 'box').comp.fills.find(fill => fill.name === 'x')!;
  assert.equal(x.value.span.start.offset, source.indexOf('40 opacity'));
  assert.equal(renamed.slidesData[0]!.buildIndex, 2);
  assert.ok(renamed.slidesData[0]!.authoredComp.fills.some(fill => fill.name === 'builds'));
  assert.ok(!renamed.slidesData[0]!.comp.fills.some(fill => fill.name === 'builds'));
  assert.match(html(renamed), /after/);
  assert.match(html(initial), /before/);
  assert.doesNotMatch(html(initial), /data-sw-component="Box"[^]*?left:10px/);
  assert.match(html(entered), /opacity:0.25/);
  assert.doesNotMatch(html(reset), /opacity:0.25/);
});

test('projections of one frozen snapshot coexist and leave source authoritative', () => {
  const document = new DeckDocument(source, 'builds.sw');
  const resolver = new DeckResolver();
  const before = JSON.stringify(document.snapshot);
  const first = resolver.resolve(document, { components, buildIndices: new Map([[0, 1]]) });
  const second = resolver.resolve(document, { components, buildIndices: new Map([[0, 3]]) });
  assert.equal(JSON.stringify(document.snapshot), before);
  assert.equal(first.slidesData[0]!.authoredComp, document.snapshot.ast.items[0]!.fills[0]!.value.kind === 'list'
    ? document.snapshot.ast.items[0]!.fills[0]!.value.items[0] : undefined);
  assert.equal(shape(first, 'box').params.x, 40);
  assert.equal(shape(second, 'box').params.x, 0);
  assert.match(html(first), /opacity:0.25/);
  assert.doesNotMatch(html(second), /opacity:0.25/);
  assert.deepEqual(resolver.stats, { resolvedSlides: 1, reusedSlides: 1 });
  assert.equal(second.slidesData[1]!.authoredComp, second.slidesData[1]!.comp);
});

test('build-free slides keep cached AST metadata current after source shifts', () => {
  const document = new DeckDocument(source, 'builds.sw');
  const resolver = new DeckResolver();
  resolver.resolve(document, { components });
  const start = source.indexOf('before');
  document.transact({ baseRevision: 0, origin: 'test', changes: [{ start, end: start + 6, insert: 'longer text before retained slide' }] });
  const result = resolver.resolve(document, { components, buildIndices: new Map([[0, 2]]) });
  const fresh = loadDeck({ source: document.snapshot.source, file: 'builds.sw', components, buildIndices: new Map([[0, 2]]) });
  assert.deepEqual(resolver.stats, { resolvedSlides: 1, reusedSlides: 1 });
  assert.equal(html(result), html(fresh));
  assert.deepEqual([...result.shapes], [...fresh.shapes]);
  assert.deepEqual(result.slidesData, fresh.slidesData);
});

for (const [name, replacement] of [
  ['invalid label', ['label: "Enter"', 'label: 12']],
  ['unknown metadata', ['label: "Enter"', 'duration: 12']],
  ['invalid property', ['x: 40', 'x: "bad"']],
  ['unknown property', ['x: 40', 'bogus: 2']],
  ['invalid opacity', ['opacity: 0.25', 'opacity: "bad"']],
  ['invalid visibility', ['visible: true', 'visible: 2']],
  ['invalid changes', ['changes: [Change { target: "box" visible: true x: 40 opacity: 0.25 }]', 'changes: 5']],
  ['unknown target', ['target: "box"', 'target: "missing"']],
  ['invalid build list', ['builds: [', 'builds: [42']],
  ['duplicate object ID', ['id: "text"', 'id: "box"']],
] as const) {
  test(`diagnoses ${name} even with initial frame selected`, () => {
    const result = load(0, source.replace(replacement[0], replacement[1]));
    assert.ok(result.diagnostics.length > 0, name);
    assert.doesNotThrow(() => html(result));
    assert.equal(result.slides.length, 2);
  });
}

test('keyframes validate array members against registered produced types', () => {
  const result = load(0, source.replace('x: 40', 'children: [Span { content: "wrong kind" }]')
    .replace('target: "box"', 'target: "scene"'));
  assert.ok(result.diagnostics.some(d => d.kind === 'slot-type-mismatch' && d.message.includes('produces')));
  assert.doesNotThrow(() => html(result));
});

test('custom wrappers receive effective values', () => {
  const seen: { id: string | undefined; x: unknown }[] = [];
  const result = loadDeck({ source, file: 'wrap.sw', components, buildIndices: new Map([[0, 2]]),
    wrapShape: input => {
      seen.push({ id: objectId(input.comp), x: input.params.x });
      return createElement(input.loaded.render, { key: input.cellKey, slots: input.slots as ComponentRenderProps['slots'], params: input.params, slotsState: input.slotsState });
    },
  });
  assert.ok(seen.some(item => item.id === 'box' && item.x === 40));
  assert.match(html(result), /opacity:0.25/);
  assert.equal(shape(result, 'box').params.x, 40);
});

test('invalid selected indices diagnose and fall back to the initial scene', () => {
  for (const index of [-1, 99, 0.5, NaN]) {
    const result = load(index);
    assert.ok(result.diagnostics.some(d => d.kind === 'invalid-build'));
    assert.equal(result.slidesData[0]!.buildIndex, 0);
    assert.equal(shape(result, 'box').params.x, 10);
  }
});

test('visibility applies to built-in inline and document objects', () => {
  const result = load(0, `Deck { slides: [Slide { content: TextBox { content: [
    Paragraph { visible: false content: "hidden paragraph" }
    Paragraph { content: [Span { visible: false content: "hidden span" } "shown"] }
    List { visible: false items: [ListItem { content: "hidden list" }] }
    List { items: [ListItem { visible: false content: "hidden item" }] }
  ] } }] }`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(html(result), /shown/);
  assert.doesNotMatch(html(result), /hidden (?:paragraph|span|list|item)/);
});

test('component-owned opacity retains its schema and avoids universal wrapping', () => {
  const registry: ComponentRegistry = { Native: {
    meta: { produces: 'block', slots: {}, params: { opacity: { type: 'number' } } },
    render: ({ params }) => createElement('div', { style: { opacity: Number(params.opacity) } }, 'native'),
  } };
  const result = loadDeck({ source: 'Deck { slides: [Slide { content: Native { opacity: 0.4 } }] }', file: 'native.sw', components: registry });
  assert.deepEqual(result.diagnostics, []);
  assert.match(html(result), /opacity:0.4/);
  assert.doesNotMatch(html(result), /data-sw-object-opacity/);
});

test('universal opacity preserves Freeform coordinates and stack layout, hidden children consume no gap', async () => {
  const registry: ComponentRegistry = { ...components, Tile: {
    meta: { produces: 'block', slots: { content: { type: 'text' } }, params: {} },
    render: ({ slots }) => createElement('div', { 'data-tile': true, style: { width: 50, height: 20 } }, slots.content as ReactNode),
  } };
  const result = loadDeck({ file: 'layout.sw', components: registry, source: `Deck { slides: [Slide { content: Freeform { children: [
    Box { x: 70 y: 80 width: 30 height: 40 opacity: 0.3 }
    HStack { children: [Tile { content: "one" } Tile { visible: false content: "hidden" } Tile { opacity: 0.5 content: "two" }] }
  ] } }] }` });
  assert.deepEqual(result.diagnostics, []);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div style="position:relative;width:600px;height:400px">${html(result)}</div>`);
    const box = page.locator('[data-sw-component="Box"] > div');
    const bounds = await box.boundingBox();
    const parent = await page.locator('[data-sw-component="Freeform"] > div').boundingBox();
    assert.equal(bounds!.x - parent!.x, 70);
    assert.equal(bounds!.y - parent!.y, 80);
    const tiles = await page.locator('[data-tile]').all();
    assert.equal(tiles.length, 2);
    const one = (await tiles[0]!.boundingBox())!;
    const two = (await tiles[1]!.boundingBox())!;
    assert.equal(two.x - one.x, 74); // width 50 + HStack gap 24
    assert.equal(two.width, 50);
    assert.equal(two.height, 20);
    assert.equal(await page.locator('[data-sw-object-opacity="0.5"]').evaluate(node => getComputedStyle(node).opacity), '0.5');
  } finally {
    await browser.close();
  }
});

test('speaker notes accept strings or per-frame arrays and validate every array entry', () => {
  for (const notes of ['"Shared"', '["Initial", "Enter", "", "Reset"]', '[]']) {
    for (let index = 0; index < 4; index++) {
      const result = load(index, source.replace('Slide { content:', `Slide { notes: ${notes} content:`));
      assert.deepEqual(result.diagnostics, []);
      const note = (result.slides[0]! as ReactElement<{ children: ReactElement<{ notes: string }> }>).props.children.props.notes;
      assert.equal(note, notes === '"Shared"' ? 'Shared' : notes === '[]' ? '' : ['Initial', 'Enter', '', 'Reset'][index]);
    }
  }
  const bad = load(0, source.replace('Slide { content:', 'Slide { notes: ["Initial", 42] content:'));
  assert.ok(bad.diagnostics.some(d => d.message.includes('notes entries must be strings')));
});
