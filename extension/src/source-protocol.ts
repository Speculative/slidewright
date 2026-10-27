export interface SourceChange { readonly start: number; readonly end: number; readonly insert: string }

export interface SourceSnapshot {
  source: string;
  version: number;
  fileName: string;
  assets: Record<string, string>;
}
export interface SourceUpdatedMessage extends SourceSnapshot {
  type: 'source-updated';
  baseVersion?: number;
  changes?: readonly SourceChange[];
  requestId?: number;
  replacement?: boolean;
}
export interface SourceResultMessage extends SourceSnapshot {
  type: 'source-result';
  requestId: number;
  accepted: boolean;
}
export interface SetSourceMessage {
  type: 'set-source';
  requestId: number;
  baseVersion: number;
  source: string;
  changes: readonly SourceChange[];
  origin: string;
  replacement?: boolean;
}
export type ExtensionToWebview = SourceUpdatedMessage | SourceResultMessage | { type: 'cursor-changed'; offset: number; version: number };
export type WebviewToExtension = SetSourceMessage | { type: 'ready' } | { type: 'select-source-range'; start: number; end: number; version: number };

// Validate before crossing the native editor boundary. Coordinates are sorted
// UTF-16 offsets in the base version, and must reproduce the requested source.
export function verifyChanges(before: string, after: string, changes: readonly SourceChange[]): void {
  let cursor = 0;
  let previousStart = -1;
  let actual = '';
  for (const change of changes) {
    if (!Number.isInteger(change.start) || !Number.isInteger(change.end) ||
        change.start < cursor || change.start <= previousStart || change.end < change.start || change.end > before.length) {
      throw new Error('Invalid source change ranges');
    }
    actual += before.slice(cursor, change.start) + change.insert;
    cursor = change.end;
    previousStart = change.start;
  }
  actual += before.slice(cursor);
  if (actual !== after) throw new Error('Source changes do not reproduce requested source');
}
