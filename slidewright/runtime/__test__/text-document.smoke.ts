import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { loadDeck, isRenderableSlotType } from '../loader.js';
import { buildRegistry, BUILTIN_META, type ComponentRenderProps } from '../contract.js';
import { parse } from '../parser.js';
import { emit } from '../emitter.js';
import { paragraphDocument } from '../ast-builders.js';
import { components } from '../../../decks/v0-reference/registry.js';

const inlineRegistry = buildRegistry({
  Pill: {
    slidewright: { produces: 'text', slots: { content: { type: 'text' } }, params: { label: { type: 'string' } } },
    default: ({ slots, params }: ComponentRenderProps) => createElement('span', { title: String(params.label), style: { background: '#00f' } }, slots.content),
  },
});
function source(content: string, extra = '') {
  return `Deck { slides: [Slide { content: Freeform { children: [TextBox { content: ${content} ${extra} }] } }] }`;
}
function load(content: string, extra = '') {
  return loadDeck({ source: source(content, extra), file: 'test.sw', components: { ...components, ...inlineRegistry }, scope: { bindings: { term: 'shared term', numeric: 12 } } });
}
function render(content: string) {
  const result = load(content);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  return renderToStaticMarkup(createElement('div', null, result.slides));
}

const document = `[
  Paragraph { spaceBefore: 12 spaceAfter: 24 align: "right" lineHeight: 1.6
    content: ["Hello " Span { content: "world" weight: "700" } term Pill { content: ["custom"] label: "retained" }]
  }
  List { style: "decimal" start: 4 items: [
    ListItem { content: ["outer"] children: List { style: "square" items: [ListItem { content: ["nested"] }] } }
    ListItem { content: [] children: omit }
  ] }
  Paragraph { content: [] }
]`;
const html = render(document);
assert.match(html, /data-sw-component="Paragraph"/);
assert.match(html, /margin-top:12px;margin-bottom:24px/);
assert.match(html, /text-align:right;line-height:1.6/);
assert.match(html, /data-sw-inline-reference="term"[^>]*>shared term<\/span>/);
assert.match(html, /<span[^>]*data-sw-component="Pill"/);
assert.match(html, /title="retained"/);
assert.match(html, /<ol[^>]*start="4"/);
assert.match(html, /list-style-type:square/);
assert.match(render('"migration shorthand"'), /<p[^>]*>.*migration shorthand.*<\/p>/);
assert.match(render('term'), /shared term/);
assert.ok(!render('[]').includes('data-sw-component="Paragraph"'));
assert.equal(isRenderableSlotType('text-document'), true);
assert.equal(BUILTIN_META.List!.slots.items!.type, 'array<list-item>');

for (const content of [
  '["bare text"]',
  '[Span { content: "inline" }]',
  'List { items: [] }',
  '[Paragraph { content: [List { items: [] }] }]',
  '[List { items: ["bare item"] }]',
  '[List { items: [ListItem { content: [Paragraph { content: "block" }] }] }]',
  '[List { items: [ListItem { content: "item" children: Paragraph { content: "nested block" } }] }]',
  '[Paragraph { content: [Box {}] }]',
  '[Paragraph { content: [numeric] }]',
]) {
  assert.ok(load(content).diagnostics.some(d => d.kind === 'slot-type-mismatch'), `must reject ${content}`);
}
for (const name of ['bullets', 'listStyle', 'listStart']) {
  assert.ok(load('[]', `${name}: []`).diagnostics.some(d => d.kind === 'unknown-slot'), `removed ${name}`);
}
const original = source(document);
const canonical = emit(parse(original, 'test.sw').ast);
assert.equal(emit(parse(canonical, 'test.sw').ast), canonical);
assert.ok(canonical.includes('term'));
assert.ok(canonical.includes('label: "retained"'));
assert.equal(paragraphDocument('new').items[0]?.kind, 'component');
for (const file of ['decks/v0-reference/deck.sw', 'tests/fixtures/slide-grade-text.sw', 'tests/fixtures/single-textbox.sw']) {
  const value = readFileSync(file, 'utf8');
  assert.ok(!/\b(bullets|listStyle|listStart)\s*:/.test(value), `${file} migrated`);
  assert.ok(value.includes('Paragraph {'), `${file} uses structured content`);
}
console.log('OK   text documents, paragraphs, nested lists, custom inline content, references, validation, and migration');
