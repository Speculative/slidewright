import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { components } from '../../../decks/v0-reference/registry.js';
import { loadDeck } from '../loader.js';
import { parse } from '../parser.js';
import { emit } from '../emitter.js';
const assets: Record<string, string> = { plateauHeadshot: 'headshot.jpg', plateauPennHci: 'penn-hci.svg', plateauConsole: 'js_console.png', plateauPandas: 'pandas.png', plateauStackTrace: 'stack_trace.mp4', plateauStreams: 'streams.mp4', plateauStepping: 'stepping.mp4', plateauComputed: 'computed.mp4', plateauFiltering: 'agg_filter.mp4' };
for (const file of Object.values(assets)) assert.ok(existsSync(`decks/uist-2026/assets/${file}`));
for (const file of ['decks/uist-2026/deck.sw', 'decks/plateau-demo/deck.sw']) {
  const source = readFileSync(file, 'utf8');
  const result = loadDeck({ source, file, components, scope: { bindings: { ...assets, body: 'body', mono: 'mono' } } });
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  if (file.includes('plateau-demo')) assert.equal(result.slides.length, 20);
  else assert.ok(result.slides.length > 0);
  if (file.includes('plateau-demo')) {
    const html = renderToStaticMarkup(createElement('div', null, result.slides));
    for (const expected of ['Data-oriented Debugging with', 'Too Much Information', 'Too Little Information', 'P3:', 'P12:', 'Collection', 'Analysis', 'full stack traces', 'Future Work', 'Discussion']) assert.ok(html.includes(expected));
    assert.equal((html.match(/<video/g) ?? []).length, 5);
    assert.equal((html.match(/data-sw-chart=/g) ?? []).length, 5);
    assert.equal((html.match(/data-sw-debugger=/g) ?? []).length, 1);
    assert.equal((source.match(/notes:/g) ?? []).length, result.slides.length);
    const migration = JSON.parse(readFileSync('decks/uist-2026/migration.json', 'utf8')) as { slides: { notesSha256: string }[] };
    assert.equal(migration.slides.length, 20);
    for (let index = 0; index < result.slides.length; index++) {
      const value = result.slidesData[index]!.comp.fills.find(fill => fill.name === 'notes')!.value;
      assert.equal(value.kind, 'string');
      if (value.kind !== 'string') throw new Error('missing notes');
      const note = value.value;
      assert.equal(createHash('sha256').update(note).digest('hex'), migration.slides[index]!.notesSha256);
    }
  }
  assert.equal(emit(parse(emit(parse(source, 'plateau.sw').ast), 'plateau.sw').ast), emit(parse(source, 'plateau.sw').ast));
  console.log(`OK   ${file}: ${result.slides.length} slides, rendering, and round-trip`);
}
