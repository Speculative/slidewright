import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPresenterDeck } from '../src/presenter-model.js';
import { loadDeck } from '../slidewright/runtime/loader.js';
import { components } from '../decks/v0-reference/registry.js';

const source = `Deck { name: "Presenter test" width: 1600 height: 900 slides: [
  Slide { chapter: "Opening" content: TextBox { content: "First" } }
  Slide { content: TextBox { id: "text" content: "Before" }
    notes: ["Initial note" "Build note"]
    builds: [Build { id: "change" changes: [Change { target: "text" content: "After" }] }] }
  Slide { chapter: "Next chapter" content: TextBox { content: "Last" } }
] }`;
const input = { source, file: 'presenter.sw', components };

test('presenter frames match full-deck resolution, with builds, chapters and ordinals', () => {
  const presenter = createPresenterDeck(input);
  assert.equal(presenter.total, 3);
  assert.equal(presenter.meta.width, 1600);
  assert.equal(presenter.meta.height, 900);
  for (const [index, build] of [[0, 0], [1, 0], [1, 1], [2, 0]] as const) {
    const expected = loadDeck({ ...input, buildIndices: new Map([[index, build]]) });
    assert.equal(renderToStaticMarkup(presenter.frame(index, build)!), renderToStaticMarkup(expected.slides[index]!));
    assert.equal(presenter.frame(index, build), presenter.frame(index, build), 'unchanged frames retain element identity');
  }
  assert.equal(presenter.frame(3, 0), null);
  assert.equal(presenter.authored(1)?.fills.find(fill => fill.name === 'notes')?.value.kind, 'list');
});

test('a new presenter source revision does not reuse stale frames', () => {
  const before = createPresenterDeck(input);
  const after = createPresenterDeck({ ...input, source: source.replace('Before', 'Revised') });
  assert.match(renderToStaticMarkup(after.frame(1, 0)!), /Revised/);
  assert.match(renderToStaticMarkup(before.frame(1, 0)!), /Before/);
});
