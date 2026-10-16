import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeckMetaContext } from '../../../src/Slide.jsx';
import { components } from '../../../decks/v0-reference/registry.js';
import { loadDeck } from '../loader.js';
import { emit } from '../emitter.js';
import { parse } from '../parser.js';

const source = readFileSync('tests/fixtures/chapters.sw', 'utf8');
function render(source: string) {
  const deck = loadDeck({ source, file: 'chapters.sw', components });
  assert.deepEqual(deck.diagnostics, []);
  const html = deck.slides.map(slide => renderToStaticMarkup(createElement(
    DeckMetaContext.Provider, { value: { ...deck.meta, total: deck.slides.length } }, slide,
  )));
  return html;
}
const html = render(source);
assert.ok(html[0]!.includes('Introduction'));
assert.ok(html[1]!.includes('Introduction'));
assert.ok(!html[2]!.includes('class="chrome"'));
assert.ok(html[3]!.includes('Demo'));
assert.equal((html[0]!.match(/class="sep"/g) ?? []).length, 1);
const renamed = render(source.replace('Introduction', 'Motivation'));
assert.ok(renamed[0]!.includes('Motivation'));
assert.ok(renamed[1]!.includes('Motivation'));
assert.ok(renamed[3]!.includes('Demo'));
const footers = (slides: string[]) => slides.map(html => html.match(/<div class="chrome">.*?<\/section>/)?.[0]);
assert.deepEqual(footers(render(emit(parse(source, 'chapters.sw').ast))), footers(html));
const legacy = render(source.replace('name: "UIST 2026"', 'name: "Legacy" subtitle: "Talk"'));
assert.equal((legacy[0]!.match(/class="sep"/g) ?? []).length, 2);
const invalid = loadDeck({ source: source.replace('chapter: "Demo"', 'chapter: 42'), file: 'invalid.sw', components });
assert.ok(invalid.diagnostics.some(d => d.severity === 'error' && d.kind === 'slot-type-mismatch'));
console.log('OK   chapters: inheritance, rename, hidden boundary, footer format, validation, round-trip');
