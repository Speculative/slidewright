// Incremental lexical folding. Cached tokens belong to the CodeMirror document;
// they never supply authoring ASTs or validation diagnostics.
import { StateField, type Extension, type Text, type Transaction } from '@codemirror/state';
import { foldService } from '@codemirror/language';
import { tokenize, type TokenKind } from '../runtime/lexer.js';

interface FoldRange { from: number; to: number }
interface FoldToken { kind: TokenKind; text: string; from: number; to: number }
interface FoldIndex { tokens: FoldToken[]; pairs: FoldRange[]; lines: Map<number, FoldRange> }
let lexCalls = 0;
let lexedCharacters = 0;
let structureRebuilds = 0;
export function readSourceFoldingWork() { return { lexCalls, lexedCharacters, structureRebuilds }; }

function lex(source: string, offset: number): FoldToken[] {
  lexCalls++;
  lexedCharacters += source.length;
  return tokenize(source, '<editor>').tokens.filter(t => t.kind !== 'eof').map(t => ({
    kind: t.kind, text: t.text, from: offset + t.span.start.offset,
    // An unfinished escape can put the lexer's end one character past EOF.
    to: offset + Math.min(source.length, t.span.end.offset),
  }));
}
function structural(token: FoldToken): boolean {
  return ['lbrace', 'rbrace', 'lbrack', 'rbrack'].includes(token.kind);
}
function pairs(tokens: readonly FoldToken[]): FoldRange[] {
  structureRebuilds++;
  const stack: FoldToken[] = [];
  const ranges: FoldRange[] = [];
  for (const token of tokens) {
    if (token.kind === 'lbrace' || token.kind === 'lbrack') stack.push(token);
    else if (token.kind === 'rbrace' || token.kind === 'rbrack') {
      const open = stack.at(-1);
      if (open?.kind !== (token.kind === 'rbrace' ? 'lbrace' : 'lbrack')) {
        stack.length = 0;
        continue;
      }
      stack.pop();
      ranges.push({ from: open.to, to: token.from });
    }
  }
  return ranges.sort((a, b) => a.from - b.from);
}
function lines(doc: Text, ranges: readonly FoldRange[]): Map<number, FoldRange> {
  const index = new Map<number, FoldRange>();
  for (const range of ranges) {
    const line = doc.lineAt(range.from);
    if (doc.lineAt(range.to).number > line.number && !index.has(line.from)) index.set(line.from, range);
  }
  return index;
}
function create(doc: Text): FoldIndex {
  const tokens = lex(doc.toString(), 0);
  const ranges = pairs(tokens);
  return { tokens, pairs: ranges, lines: lines(doc, ranges) };
}

// Restart at a prior token boundary, then expand until two unchanged suffix
// tokens agree. This handles token mergers, multiline literals/comments and
// invalid intermediate source without a second approximation of the DSL lexer.
function edit(index: FoldIndex, doc: Text, from: number, to: number, insert: Text): FoldIndex {
  const next = doc.replace(from, to, insert);
  const delta = insert.length - (to - from);
  const old = index.tokens;
  let first = old.findIndex(t => t.from > from);
  if (first < 0) first = old.length;
  first = Math.max(0, first - 2);
  // Leading trivia may contain an unrecognized slash that an edit turns
  // into a comment. Include it when there is no preceding token boundary.
  const restart = first === 0 ? 0 : old[first]!.from;
  let end = old.findIndex(t => t.from >= to);
  if (end < 0) end = old.length;
  end = Math.min(old.length, end + 3);
  let replacement: FoldToken[];
  for (;;) {
    const boundary = end < old.length ? old[end]!.from : doc.length;
    replacement = lex(next.sliceString(restart, boundary + delta), restart);
    if (end === old.length) break;
    const suffix = old.slice(Math.max(first, end - 2), end);
    const tail = replacement.slice(-suffix.length);
    if (suffix.length === 2 && tail.length === 2 && suffix.every((token, i) =>
      token.from >= to && token.kind === tail[i]!.kind && token.text === tail[i]!.text &&
      token.from + delta === tail[i]!.from && token.to + delta === tail[i]!.to)) break;
    end = Math.min(old.length, end + Math.max(4, end - first));
  }
  const shift = (token: FoldToken): FoldToken => delta ? { ...token, from: token.from + delta, to: token.to + delta } : token;
  const tokens = [...old.slice(0, first), ...replacement, ...old.slice(end).map(shift)];
  const beforeStructure = old.slice(first, end).filter(structural);
  const afterStructure = replacement.filter(structural);
  // A changed scalar token or whitespace only maps the existing pairs. Keep
  // single-line pairs too: a newline edit may make them newly foldable.
  const map = (pos: number, affinity: -1 | 1): number => {
    if (pos < from || (pos === from && affinity < 0)) return pos;
    if (pos > to || (pos === to && affinity > 0)) return pos + delta;
    return from + (affinity < 0 ? 0 : insert.length);
  };
  const sameStructure = beforeStructure.length === afterStructure.length && beforeStructure.every((t, i) => {
    const other = afterStructure[i]!;
    // Brackets themselves must be outside the edited interval.
    return (t.to <= from || t.from >= to) && t.kind === other.kind &&
      map(t.from, 1) === other.from && map(t.to, -1) === other.to;
  });
  const ranges = sameStructure ? index.pairs.map(r => ({ from: map(r.from, -1), to: map(r.to, 1) })) : pairs(tokens);
  return { tokens, pairs: ranges, lines: lines(next, ranges) };
}
function update(index: FoldIndex, transaction: Transaction): FoldIndex {
  if (!transaction.docChanged) return index;
  const edits: { from: number; to: number; insert: Text }[] = [];
  transaction.changes.iterChanges((from, to, _newFrom, _newTo, insert) => edits.push({ from, to, insert }));
  let doc = transaction.startState.doc;
  // Right-to-left applies disjoint ranges in their original coordinates, while
  // each range gets its own bounded lexical repair and synchronization point.
  for (const change of edits.reverse()) {
    index = edit(index, doc, change.from, change.to, change.insert);
    doc = doc.replace(change.from, change.to, change.insert);
  }
  return index;
}
const folds = StateField.define<FoldIndex>({ create: state => create(state.doc), update });
export const sourceFolding: Extension = [
  folds,
  foldService.of((state, lineStart) => state.field(folds).lines.get(lineStart) ?? null),
];
