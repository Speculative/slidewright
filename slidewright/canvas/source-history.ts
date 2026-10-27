// Source snapshots remain the canvas history authority. Precise inverse ranges
// are a sidecar so undo/redo need not replace unchanged owners between edits.
import { sourceChanges, type SourceChange } from '../runtime/document.js';

export interface SourceUndoEntry {
  readonly source: string;
  readonly fromSource: string;
  readonly slideIdx: number;
  // Transform fromSource into source, in fromSource UTF-16 coordinates.
  readonly changes: readonly SourceChange[];
}

export function sourceUndoEntry(before: string, after: string, slideIdx: number,
  forward: readonly SourceChange[] = sourceChanges(before, after)): SourceUndoEntry {
  const inverse: SourceChange[] = [];
  let previous: SourceChange | undefined;
  let delta = 0;
  let cursor = 0;
  let produced = '';
  for (const change of forward) {
    if (!Number.isInteger(change.start) || !Number.isInteger(change.end) || change.start < 0 ||
        change.end < change.start || change.end > before.length ||
        (previous && (change.start < previous.end || change.start === previous.start))) {
      throw new RangeError('Invalid history change ranges');
    }
    produced += before.slice(cursor, change.start) + change.insert;
    cursor = change.end;
    const start = change.start + delta;
    const undo = { start, end: start + change.insert.length, insert: before.slice(change.start, change.end) };
    const adjacent = inverse.at(-1);
    // Adjacent deletions can become several insertions at the same position.
    // Coalesce contiguous inverse ranges to keep the transaction unambiguous.
    if (adjacent && adjacent.end === undo.start) {
      inverse[inverse.length - 1] = { start: adjacent.start, end: undo.end, insert: adjacent.insert + undo.insert };
    } else inverse.push(undo);
    delta += change.insert.length - (change.end - change.start);
    previous = change;
  }
  if (produced + before.slice(cursor) !== after) throw new Error('History changes do not match their source snapshots');
  return Object.freeze({ source: before, fromSource: after, slideIdx,
    changes: Object.freeze(inverse.map(change => Object.freeze(change))) });
}
