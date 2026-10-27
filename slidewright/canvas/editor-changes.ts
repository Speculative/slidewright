import { sourceChanges, type DocumentUpdate, type SourceChange } from '../runtime/document.js';

export interface SourceProjection {
  source: string;
  text: string;
  globalStart: number;
  globalEnd: number;
}

// Reuse revision-owned host splices only when both projections match the
// transaction. Scoped documents omit outside edits; verify the result before
// accepting boundaries, since slide switches and decoded notes need a fallback.
export function projectedSourceChanges(before: SourceProjection, after: SourceProjection, update?: DocumentUpdate): SourceChange[] {
  if (update?.before.source === before.source && update.snapshot.source === after.source) {
    const changes: SourceChange[] = [];
    let valid = true;
    for (const change of update.changes) {
      if (change.end <= before.globalStart && change.start < before.globalStart) continue;
      if (change.start >= before.globalEnd && change.end > before.globalEnd) continue;
      if (change.start < before.globalStart || change.end > before.globalEnd) { valid = false; break; }
      changes.push({ start: change.start - before.globalStart, end: change.end - before.globalStart, insert: change.insert });
    }
    if (valid) {
      let text = '';
      let position = 0;
      for (const change of changes) {
        text += before.text.slice(position, change.start) + change.insert;
        position = change.end;
      }
      if (text + before.text.slice(position) === after.text) return changes;
    }
  }
  return sourceChanges(before.text, after.text);
}
