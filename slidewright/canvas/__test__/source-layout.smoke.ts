import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import { continuationColumns, sourceFolding, sourceFoldRanges } from '../source-layout.js';

const source = `Deck {
  // { ignored
  notes: """literal [
  } ] { still notes
  """
  slides: [
    Slide { content: Freeform {
      children: []
    } }
  ]
  /* { ignored } */
}`;
const ranges = sourceFoldRanges(source);
assert.equal(ranges.length, 4);
assert.equal(source.slice(ranges[0]!.from, ranges[0]!.to), source.slice(6, -1));
assert.equal(ranges.some(({ from }) => source[from - 1] === '['), true);
const state = EditorState.create({ doc: source, extensions: [sourceFolding] });
const line = state.doc.line(7);
const fold = foldable(state, line.from, line.to)!;
assert.equal(source.slice(fold.from, fold.to), ' content: Freeform {\n      children: []\n    } ');
assert.equal(foldable(state, state.doc.line(3).from, state.doc.line(3).to), null);
// Rebuild folding after edits, and tolerate unfinished input.
const edited = state.update({ changes: { from: 0, insert: '\n' } }).state;
assert.equal(foldable(edited, 1, edited.doc.line(2).to)?.from, 7);
assert.deepEqual(sourceFoldRanges('Deck {\n slides: [\n  Slide {}\n ]'), [{ from: 17, to: 30 }]);
assert.deepEqual(sourceFoldRanges('Deck {\n ]\n}'), []);
assert.equal(continuationColumns('    content: "long text"', 2, true), 13);
assert.equal(continuationColumns('\tname: "text"', 4, true), 10);
assert.equal(continuationColumns('    TextBox {', 2, true), 6);
assert.equal(continuationColumns('Notes: ordinary prose', 2, false), 0);
assert.equal(continuationColumns('  indented prose', 2, false), 2);
console.log('Source layout smoke test passed.');
