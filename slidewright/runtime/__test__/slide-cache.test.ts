import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeckDocument } from '../document.js';
import { DeckResolver, loadDeck } from '../loader.js';
import { components } from '../../../decks/v0-reference/registry.js';

const source = `Deck {
  name: "cache"
  tokens: Tokens { accent: oklch(0.5 0.1 20) }
  slides: [
    Slide { chapter: "Intro" label: "first" content: Freeform { children: [
      TextBox { x: 10 y: 10 width: 400 height: 100 content: "hello" }
    ] } }
    Slide { label: "second" content: Freeform { children: [
      TextBox { x: 20 y: 20 width: 400 height: 100 content: [Paragraph { content: ["later" Span { content: "marked" color: accent }] }] }
      TextBox { x: 20 y: 150 width: 400 height: 100 content: missingReference }
      TextBox { x: 20 y: 280 width: 400 height: 100 }
    ] } }
  ]
}`;
const input = { components, scope: { bindings: {} } };
function replace(document: DeckDocument, from: string, to: string) {
  const start = document.snapshot.source.indexOf(from);
  assert.ok(start >= 0);
  return document.transact({ baseRevision: document.snapshot.revision, origin: 'test', changes: [{ start, end: start + from.length, insert: to }] });
}
function content(slide: ReactElement): unknown {
  return (slide.props as { children: ReactElement<{ children: ReactElement<{ children: unknown }> }> }).children.props.children.props.children;
}
function html(slides: ReactElement[]) { return slides.map(slide => renderToStaticMarkup(slide)); }

test('unchanged slides reuse resolved content while all source markers and diagnostics move', () => {
  const document = new DeckDocument(source, 'cache.sw');
  const resolver = new DeckResolver();
  const before = resolver.resolve(document, input);
  assert.deepEqual(resolver.stats, { resolvedSlides: 2, reusedSlides: 0 });
  replace(document, 'hello', 'a substantially longer first slide');
  const after = resolver.resolve(document, input);
  assert.equal(after.revision, 1);
  assert.deepEqual(resolver.stats, { resolvedSlides: 1, reusedSlides: 1 });
  assert.equal(content(before.slides[1]!), content(after.slides[1]!));
  const fresh = loadDeck({ ...input, source: document.snapshot.source, file: 'cache.sw' });
  assert.deepEqual(html(after.slides), html(fresh.slides));
  assert.deepEqual(after.diagnostics, fresh.diagnostics);
  assert.deepEqual([...after.shapes.keys()], [...fresh.shapes.keys()]);
  for (const [key, shape] of after.shapes) {
    assert.deepEqual(shape, fresh.shapes.get(key));
  }
  assert.ok(Object.isFrozen(document.snapshot.ast));
});

test('chapter inheritance and deck metadata update without resolving unaffected content', () => {
  const document = new DeckDocument(source, 'cache.sw');
  const resolver = new DeckResolver();
  const before = resolver.resolve(document, input);
  replace(document, 'Intro', 'New chapter');
  const after = resolver.resolve(document, input);
  assert.deepEqual(resolver.stats, { resolvedSlides: 1, reusedSlides: 1 });
  assert.equal(content(before.slides[1]!), content(after.slides[1]!));
  assert.ok(html(after.slides)[1]!.includes('New chapter'));
  replace(document, 'name: "cache"', 'name: "renamed deck"');
  const renamed = resolver.resolve(document, input);
  assert.equal(renamed.meta.name, 'renamed deck');
  assert.deepEqual(resolver.stats, { resolvedSlides: 0, reusedSlides: 2 });
});

test('tokens, asset/scope values, registry entries and wrapper changes invalidate conservatively', () => {
  const document = new DeckDocument(source, 'cache.sw');
  const resolver = new DeckResolver();
  resolver.resolve(document, input);
  replace(document, 'oklch(0.5 0.1 20)', 'oklch(0.7 0.2 40)');
  resolver.resolve(document, input);
  assert.deepEqual(resolver.stats, { resolvedSlides: 2, reusedSlides: 0 });
  const assetInput = { ...input, scope: { bindings: { missingReference: 'resolved asset' } } };
  const bound = resolver.resolve(document, assetInput);
  assert.deepEqual(resolver.stats, { resolvedSlides: 2, reusedSlides: 0 });
  assert.ok(!bound.diagnostics.some(d => d.kind === 'unknown-reference'));
  resolver.resolve(document, { ...assetInput, scope: { bindings: { ...assetInput.scope.bindings } } });
  assert.deepEqual(resolver.stats, { resolvedSlides: 0, reusedSlides: 2 });
  resolver.resolve(document, { ...assetInput, components: { ...components, TextBox: { ...components.TextBox!, meta: { ...components.TextBox!.meta } } } });
  assert.deepEqual(resolver.stats, { resolvedSlides: 2, reusedSlides: 0 });
  resolver.resolve(document, { ...assetInput, wrapShape: props => createElement('div', null, props.comp.name) });
  assert.deepEqual(resolver.stats, { resolvedSlides: 2, reusedSlides: 0 });
  resolver.invalidate();
  resolver.resolve(document, assetInput);
  assert.deepEqual(resolver.stats, { resolvedSlides: 2, reusedSlides: 0 });
});

test('insertion, deletion, reorder and explicit replacement keep results equivalent to fresh loads', () => {
  const document = new DeckDocument(source, 'cache.sw');
  const resolver = new DeckResolver();
  const before = resolver.resolve(document, input);
  const second = document.snapshot.occurrences.filter(o => o.component.name === 'Slide')[1]!;
  document.transact({ baseRevision: 0, origin: 'insert', changes: [{ start: second.range.start, end: second.range.start, insert: 'Slide { content: TextBox { content: "inserted" } }\n' }] });
  const inserted = resolver.resolve(document, input);
  assert.deepEqual(resolver.stats, { resolvedSlides: 1, reusedSlides: 2 });
  assert.equal(content(inserted.slides[2]!), content(before.slides[1]!));
  assert.deepEqual(html(inserted.slides), html(loadDeck({ ...input, file: 'cache.sw', source: document.snapshot.source }).slides));
  const added = document.snapshot.occurrences.filter(o => o.component.name === 'Slide')[1]!;
  document.transact({ baseRevision: 1, origin: 'delete', changes: [{ start: added.range.start, end: added.range.end, insert: '' }] });
  const deleted = resolver.resolve(document, input);
  assert.deepEqual(resolver.stats, { resolvedSlides: 0, reusedSlides: 2 });
  assert.equal(content(deleted.slides[1]!), content(before.slides[1]!));
  const first = document.snapshot.occurrences.filter(o => o.component.name === 'Slide')[0]!;
  const last = document.snapshot.occurrences.filter(o => o.component.name === 'Slide')[1]!;
  document.transact({ baseRevision: 2, origin: 'reorder', changes: [
    { start: first.range.start, end: first.range.end, insert: '' },
    { start: last.range.end, end: last.range.end, insert: document.snapshot.source.slice(first.range.start, first.range.end) },
  ] });
  const reordered = resolver.resolve(document, input);
  assert.deepEqual(resolver.stats, { resolvedSlides: 1, reusedSlides: 1 });
  assert.deepEqual(html(reordered.slides), html(loadDeck({ ...input, file: 'cache.sw', source: document.snapshot.source }).slides));
  document.transact({ baseRevision: 3, origin: 'reload', replacement: true, changes: [] });
  resolver.resolve(document, input);
  assert.deepEqual(resolver.stats, { resolvedSlides: 2, reusedSlides: 0 });
});

test('invalid intermediate source and recovery match the one-shot adapter', () => {
  const document = new DeckDocument(source, 'cache.sw');
  const resolver = new DeckResolver();
  resolver.resolve(document, input);
  for (const [from, to] of [['"hello"', '"unterminated'], ['"unterminated', '"fixed"']]) {
    replace(document, from!, to!);
    const result = resolver.resolve(document, input);
    const fresh = loadDeck({ ...input, file: 'cache.sw', source: document.snapshot.source });
    assert.deepEqual(result.diagnostics, fresh.diagnostics);
    assert.deepEqual(html(result.slides), html(fresh.slides));
  }
});

test('malformed lists make forward progress during source editing', async () => {
  // Use a subprocess so a recovery regression fails instead of hanging or
  // exhausting the main test runner's memory.
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--max-old-space-size=96', '--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { parse } from './slidewright/runtime/parser.ts';
    for (const source of ['Deck { slides: [ }', 'Deck { slides: [: Slide {}] }', 'Deck { slides: ["unterminated\\n}'] ) {
      const result = parse(source, 'invalid.sw');
      assert.ok(result.diagnostics.some(d => d.severity === 'error'));
      assert.equal(result.ast.items[0].name, 'Deck');
    }
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('truncated owner boundaries bypass the cache until syntax recovers', () => {
  const document = new DeckDocument(source, 'cache.sw');
  const resolver = new DeckResolver();
  resolver.resolve(document, input);
  const start = source.indexOf('"later"');
  document.transact({ baseRevision: 0, origin: 'truncate', changes: [{ start, end: source.length, insert: '' }] });
  const broken = resolver.resolve(document, input);
  assert.ok(broken.diagnostics.some(d => d.kind === 'parse'));
  const fresh = loadDeck({ ...input, file: 'cache.sw', source: document.snapshot.source });
  assert.deepEqual(broken.diagnostics, fresh.diagnostics);
  assert.deepEqual(html(broken.slides), html(fresh.slides));
  document.transact({ baseRevision: 1, origin: 'recover', changes: [{ start, end: start, insert: source.slice(start) }] });
  const restored = resolver.resolve(document, input);
  assert.deepEqual(resolver.stats, { resolvedSlides: 2, reusedSlides: 0 });
  assert.deepEqual(html(restored.slides), html(loadDeck({ ...input, file: 'cache.sw', source }).slides));
});

test('bound adapters receive current child locations on retained slides', () => {
  const registry = { ...components, Group: { ...components.Group!, canvas: {
    bindChildren: (children: readonly { comp: { span: { start: { offset: number } } } }[]) => ({ childStarts: children.map(child => child.comp.span.start.offset) }),
  } } };
  const grouped = source.replace('TextBox { x: 20 y: 280 width: 400 height: 100 }',
    'Group { children: [TextBox { content: "grouped" }] }');
  const document = new DeckDocument(grouped, 'group.sw');
  const resolver = new DeckResolver();
  resolver.resolve(document, { components: registry });
  replace(document, 'hello', 'much longer before the group');
  const retained = resolver.resolve(document, { components: registry });
  assert.deepEqual(resolver.stats, { resolvedSlides: 1, reusedSlides: 1 });
  const group = [...retained.shapes.values()].find(shape => shape.comp.name === 'Group')!;
  const child = document.snapshot.occurrences.find(item => item.component.name === 'TextBox' &&
    document.snapshot.source.slice(item.range.start, item.range.end).includes('grouped'))!;
  assert.deepEqual(group.canvas, { childStarts: [child.range.start] });
});
