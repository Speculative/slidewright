import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import { sourceFoldRanges } from '../source-layout.js';
import { sourceFolding, readSourceFoldingWork } from '../source-folding.js';

function assertFolds(state: EditorState) {
  const source = state.doc.toString();
  const expected = new Map<number, { from: number; to: number }>();
  for (const range of sourceFoldRanges(source)) {
    const from = state.doc.lineAt(range.from).from;
    if (!expected.has(from)) expected.set(from, range);
  }
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    assert.deepEqual(foldable(state, line.from, line.to), expected.get(line.from) ?? null,
      `line ${i} in ${JSON.stringify(source)}`);
  }
}
function editor(source: string) { return EditorState.create({ doc: source, extensions: [sourceFolding] }); }
const deck = (count: number) => `Deck {\n slides: [\n${Array.from({ length: count }, (_, i) =>
  `Slide {\n label: "slide-${i}"\n content: Box {\n x: ${i}\n }\n}`).join('\n')}\n ]\n}`;

test('local and disjoint edits re-lex bounded windows and map existing structure', () => {
  let state = editor(deck(1000));
  const before = readSourceFoldingWork();
  const text = state.doc.toString();
  const changes = ['slide-0', 'slide-500', 'slide-999'].map(value => ({
    from: text.indexOf(value), to: text.indexOf(value) + value.length, insert: value + ' longer 🌍',
  }));
  state = state.update({ changes }).state;
  const after = readSourceFoldingWork();
  assert.equal(after.structureRebuilds, before.structureRebuilds);
  assert.ok(after.lexedCharacters - before.lexedCharacters < 500);
  assert.equal(after.lexCalls - before.lexCalls, 3);
  assertFolds(state);
});

test('newline edits create and remove folds for previously single-line pairs', () => {
  let state = editor('Deck { slides: [Slide { content: Box {} }] }');
  for (const at of [6, 34, 0]) {
    state = state.update({ changes: { from: at, insert: '\n' } }).state;
    assertFolds(state);
    state = state.update({ changes: { from: at, to: at + 1 } }).state;
    assertFolds(state);
  }
});

test('lexical boundaries expand through changed comments and strings, then recover', () => {
  const sources = [
    '/ ? ? Deck {\n content: Box {\n }\n}',
    '\n\n / ? Deck {\n }',
    'Deck {\n notes: """a {\n b }\n """\n slides: [\n Slide {}\n ]\n}',
    'Deck {\n /* comment {\n } ] */\n slides: [\n Slide {}\n ]\n}',
    'Deck {\n notes: "a \\" {"\n // { ignored\n slides: [\n Slide {}\n ]\n}',
    'Deck {\n color: oklch(0.5 0.2 30)\n slides: [\n Slide {}\n ]\n}',
    'Deck {\n notes: "unfinished\\',
  ];
  for (const source of sources) {
    for (let from = 0; from <= source.length; from++) {
      for (const insert of ['"', '""', '/*', '*/', '\\', '\n', ']', '', '🌍']) {
        const state = editor(source);
        const to = Math.min(source.length, from + 1);
        const changed = state.update({ changes: { from, to, insert } }).state;
        assertFolds(changed);
        const restored = changed.update({ changes: { from, to: from + insert.length, insert: source.slice(from, to) } }).state;
        assertFolds(restored);
      }
    }
  }
});

test('seeded arbitrary edit sequences agree with full lexical folding on invalid source', () => {
  let seed = 381773;
  const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  const fragments = ['"', '"""', '{', '}', '[', ']', '\n', '\r\n', '/*', '*/', '//', '\\', 'oklch(', 'a', ' ', '🌍'];
  let state = editor(deck(5));
  for (let i = 0; i < 1500; i++) {
    if (i % 100 === 0) state = editor(deck(5).replace(' slides:',
      ' notes: """{\n[ notes ]\n}"""\n /* [ comment\n ] */\n slides:'));
    const changes: ChangeSpec[] = [];
    const count = 1 + random(3);
    let cursor = 0;
    for (let j = 0; j < count && cursor < state.doc.length; j++) {
      const from = cursor + random(state.doc.length - cursor);
      const to = Math.min(state.doc.length, from + random(8));
      changes.push({ from, to, insert: fragments[random(fragments.length)]! });
      cursor = to + 1;
    }
    state = state.update({ changes }).state;
    assertFolds(state);
  }
});
