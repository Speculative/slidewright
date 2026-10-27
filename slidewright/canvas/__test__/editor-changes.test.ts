import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Compartment, EditorState, StateField } from '@codemirror/state';
import { history, undoDepth, redoDepth } from '@codemirror/commands';
import { codeFolding, foldEffect, foldedRanges } from '@codemirror/language';
import { DeckDocument } from '../../runtime/document.js';
import { projectedSourceChanges } from '../editor-changes.js';
import { hostSourceTransactions } from '../source-editor.js';

const projection = (source: string, start = 0, end = source.length) => ({ source, text: source.slice(start, end), globalStart: start, globalEnd: end });

test('host splices retain disjoint changes instead of replacing the interval between them', () => {
  const before = 'Deck { name: "first" slides: [Slide { label: "middle" }] subtitle: "last" }';
  const document = new DeckDocument(before, 'test.sw');
  const changes = [
    { start: before.indexOf('first'), end: before.indexOf('first') + 5, insert: 'longer first' },
    { start: before.indexOf('last'), end: before.indexOf('last') + 4, insert: 'longer last' },
  ];
  const update = document.transact({ baseRevision: 0, origin: 'test', changes });
  assert.deepEqual(projectedSourceChanges(projection(before), projection(update.snapshot.source), update), changes);
});

test('slide projections omit outside edits while keeping precise changes inside their own coordinates', () => {
  const before = 'Deck { name: "first" slides: [Slide { label: "inside" }] subtitle: "last" }';
  const document = new DeckDocument(before, 'test.sw');
  const slide = document.snapshot.occurrences.find(o => o.component.name === 'Slide')!;
  const changes = [
    { start: before.indexOf('first'), end: before.indexOf('first') + 5, insert: 'long first' },
    { start: before.indexOf('inside'), end: before.indexOf('inside') + 6, insert: 'changed inside' },
    { start: before.indexOf('last'), end: before.indexOf('last') + 4, insert: 'long last' },
  ];
  const update = document.transact({ baseRevision: 0, origin: 'test', changes });
  const after = document.occurrence(slide.handle)!;
  assert.deepEqual(projectedSourceChanges(projection(before, slide.range.start, slide.range.end),
    projection(update.snapshot.source, after.range.start, after.range.end), update),
    [{ ...changes[1], start: changes[1]!.start - slide.range.start, end: changes[1]!.end - slide.range.start }]);
});

test('mismatched revisions, projection switches and decoded notes use verified text differences', () => {
  const document = new DeckDocument('Deck {}', 'test.sw');
  const update = document.updateSource('Deck { name: "test" }', 'test.sw')!;
  assert.deepEqual(projectedSourceChanges(projection('abc'), projection('axc'), update), [{ start: 1, end: 2, insert: 'x' }]);
  const notes = { source: document.snapshot.source, text: 'decoded\nnotes', globalStart: 2, globalEnd: 8 };
  assert.deepEqual(projectedSourceChanges({ ...notes, text: 'decoded notes' }, notes, update), [{ start: 7, end: 8, insert: '\n' }]);
});

test('incoming splices map selection and folds while clearing only editor undo history', () => {
  const undo = new Compartment();
  let creations = 0;
  const retained = StateField.define({ create: () => ++creations, update: value => value });
  let state = EditorState.create({ doc: 'prefix\nDeck {\n  slides: []\n}\nsuffix',
    extensions: [undo.of(history()), codeFolding(), retained] });
  state = state.update({ changes: { from: 0, insert: 'typed ' }, selection: { anchor: 20 } }).state;
  const from = state.doc.toString().indexOf('{') + 1;
  const to = state.doc.toString().indexOf('}');
  state = state.update({ effects: foldEffect.of({ from, to }) }).state;
  assert.equal(undoDepth(state), 1);
  for (const spec of hostSourceTransactions(undo, [{ start: 0, end: 6, insert: 'incoming long ' }])) state = state.update(spec).state;
  assert.equal(state.doc.toString(), 'incoming long prefix\nDeck {\n  slides: []\n}\nsuffix');
  assert.equal(state.selection.main.anchor, 28);
  assert.equal(undoDepth(state), 0);
  assert.equal(redoDepth(state), 0);
  assert.equal(creations, 1);
  assert.equal(state.field(retained), 1);
  assert.equal(foldedRanges(state).size, 1);
  foldedRanges(state).between(0, state.doc.length, (start, end) => {
    assert.equal(start, from + 8); assert.equal(end, to + 8);
  });
  state = state.update({ changes: { from: 0, insert: 'new ' } }).state;
  assert.equal(undoDepth(state), 1);
});
