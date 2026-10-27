import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeckDocument, type SourceChange } from '../../runtime/document.js';
import { sourceUndoEntry } from '../source-history.js';

function apply(source: string, changes: readonly SourceChange[]) {
  let cursor = 0;
  let output = '';
  for (const { start, end, insert } of changes) {
    output += source.slice(cursor, start) + insert;
    cursor = end;
  }
  return output + source.slice(cursor);
}

test('disjoint inverse ranges restore UTF-16 source and invert back to redo', () => {
  const before = 'first 🌍 middle retained last';
  const forward = [{ start: 0, end: 5, insert: 'a much longer first' },
    { start: before.indexOf('last'), end: before.length, insert: 'z' }];
  const after = apply(before, forward);
  const undo = sourceUndoEntry(before, after, 2, forward);
  assert.equal(undo.fromSource, after);
  assert.equal(undo.source, before);
  assert.equal(undo.slideIdx, 2);
  assert.equal(undo.changes.length, 2);
  assert.equal(apply(after, undo.changes), before);
  const redo = sourceUndoEntry(after, before, 5, undo.changes);
  assert.equal(apply(before, redo.changes), after);
  assert.deepEqual(redo.changes, forward);
  assert.ok(Object.isFrozen(undo));
  assert.ok(Object.isFrozen(undo.changes[0]));
});

test('adjacent deletions coalesce into an unambiguous insertion accepted by the document service', () => {
  const before = 'Deck { name: "abc" }';
  const start = before.indexOf('abc');
  const changes = [{ start, end: start + 1, insert: '' }, { start: start + 1, end: start + 2, insert: '' }];
  const after = apply(before, changes);
  const undo = sourceUndoEntry(before, after, 0, changes);
  assert.deepEqual(undo.changes, [{ start, end: start, insert: 'ab' }]);
  const document = new DeckDocument(after, 'test.sw');
  document.updateSource(before, 'test.sw', { changes: undo.changes });
  assert.equal(document.snapshot.source, before);
});

test('disjoint slide deletion undo/redo retain stationary occurrences and current locations', () => {
  const before = 'Deck { slides: [Slide { label: "delete one" } Slide { label: "stay" } Slide { label: "delete two" } Slide { label: "later" }] }';
  const document = new DeckDocument(before, 'test.sw');
  const slides = document.snapshot.occurrences.filter(o => o.component.name === 'Slide');
  const forward = [slides[0]!, slides[2]!].map(o => ({ ...o.range, insert: '' }));
  const after = apply(before, forward);
  const undo = sourceUndoEntry(before, after, 0, forward);
  document.updateSource(after, 'test.sw', { changes: forward });
  for (let i = 0; i < 3; i++) {
    document.updateSource(before, 'test.sw', { changes: undo.changes });
    assert.ok(document.occurrence(slides[1]!.handle));
    assert.ok(document.occurrence(slides[3]!.handle));
    assert.equal(document.locate(slides[3]!.handle, { start: 0, end: 5 })!.start.offset, slides[3]!.range.start);
    const redo = sourceUndoEntry(after, before, 0, undo.changes);
    document.updateSource(after, 'test.sw', { changes: redo.changes });
    assert.ok(document.occurrence(slides[1]!.handle));
    assert.ok(document.occurrence(slides[3]!.handle));
  }
});

test('legacy callers derive a validated splice, while malformed or mismatched ranges are rejected', () => {
  assert.equal(apply('new source', sourceUndoEntry('old source', 'new source', 0).changes), 'old source');
  assert.deepEqual(sourceUndoEntry('same', 'same', 0).changes, []);
  assert.throws(() => sourceUndoEntry('abc', 'xyz', 0, []), /snapshots/);
  assert.throws(() => sourceUndoEntry('abc', 'x', 0, [{ start: -1, end: 1, insert: 'x' }]), RangeError);
  assert.throws(() => sourceUndoEntry('abc', 'x', 0, [{ start: 1, end: 2, insert: 'x' }, { start: 1, end: 1, insert: 'y' }]), RangeError);
});

test('seeded disjoint edits and inverse cycles preserve source exactly', () => {
  let seed = 751;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const before = 'abc 🌍\r\n// comments\n0123456789XYZ';
  for (let i = 0; i < 300; i++) {
    const changes: SourceChange[] = [];
    let cursor = 0;
    while (cursor < before.length) {
      const start = cursor + random(before.length - cursor);
      const end = Math.min(before.length, start + random(5));
      changes.push({ start, end, insert: ['x', '', '🌍', '\r\nlonger'][random(4)]! });
      cursor = Math.max(start + 1, end);
    }
    const after = apply(before, changes);
    const undo = sourceUndoEntry(before, after, 0, changes);
    assert.equal(apply(after, undo.changes), before);
    const redo = sourceUndoEntry(after, before, 0, undo.changes);
    assert.equal(apply(before, redo.changes), after);
  }
});
