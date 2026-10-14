import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadDeck } from '../loader.js';
import { parse } from '../parser.js';
import { emit } from '../emitter.js';
import { components } from '../../../decks/v0-reference/registry.js';
import * as Image from '../../../decks/v0-reference/components/Image.js';
import * as Video from '../../../decks/v0-reference/components/Video.js';

const source = readFileSync('tests/fixtures/media.sw', 'utf8');
function render(value: string, bindings: Record<string, string> = {}) {
  const result = loadDeck({ source: value, file: 'media.sw', components, scope: { bindings } });
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  return renderToStaticMarkup(createElement('div', null, result.slides));
}
const html = render(source);
assert.match(html, /<img[^>]*src="\/tests\/fixtures\/media.svg"[^>]*alt="Fixture logo"/);
assert.match(html, /object-fit:cover/);
assert.match(html, /border-radius:20px/);
assert.match(html, /<video[^>]*src="\/tests\/fixtures\/media.webm"[^>]*loop=""[^>]*muted=""/);
assert.match(html, /aria-label="Play Demo"/);
assert.match(html, /aria-label="Restart Demo"/);
assert.match(render(source.replace('"/tests/fixtures/media.svg"', 'logo'), { logo: '/portable/logo.svg' }), /src="\/portable\/logo.svg"/);
assert.match(render(source.replace('"/tests/fixtures/media.svg"', '""')), /Set image source/);
assert.match(render(source.replace('"/tests/fixtures/media.webm"', '""')), /Set video source/);
const roundTrip = emit(parse(source, 'media.sw').ast);
assert.equal(emit(parse(roundTrip, 'media.sw').ast), roundTrip);
assert.match(render(roundTrip), /alt="Fixture logo"/);

for (const module of [Image, Video]) {
  assert.equal(module.slidewright.insertion?.stub({ gesture: 'modal', targetSlotType: 'text', rect: { x: 0, y: 0, width: 10, height: 10 } }), null);
  const node = module.slidewright.insertion?.stub({ gesture: 'modal', targetSlotType: 'array<block>', rect: { x: 10, y: 20, width: 640, height: 360 } });
  assert.ok(node);
  assert.equal(node.name, module === Image ? 'Image' : 'Video');
}
console.log('OK   media rendering, asset bindings, placeholders, insertion, and round-trip');
