// Source is authoritative. A snapshot and every occurrence in it belong to one
// revision; consumers must never combine cached ASTs from different revisions.
import type { Component, Pos, SourceFile, Span, Value } from './ast.js';
import type { Diagnostic } from './diagnostics.js';
import { parse } from './parser.js';

type Immutable<T> = T extends string | number | boolean | null | undefined | ((...args: never[]) => unknown) ? T : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type OccurrenceHandle = string & { readonly __occurrence: unique symbol };
export interface SourceRange { readonly start: number; readonly end: number }
export interface SourceChange extends SourceRange { readonly insert: string }
export interface DocumentOccurrence {
  readonly handle: OccurrenceHandle;
  readonly component: Immutable<Component>;
  readonly range: SourceRange;
  readonly parent: OccurrenceHandle | null;
}
export interface DocumentSnapshot {
  readonly revision: number;
  readonly source: string;
  readonly file: string;
  readonly ast: Immutable<SourceFile>;
  readonly diagnostics: readonly Immutable<Diagnostic>[];
  readonly occurrences: readonly DocumentOccurrence[];
}
export interface DocumentTransaction {
  readonly baseRevision: number;
  // Sorted, non-overlapping UTF-16 ranges in the BASE revision. Adjacent
  // edits are allowed; multiple inserts at the same position are ambiguous.
  readonly changes: readonly SourceChange[];
  readonly origin: string;
  readonly affectedOwners?: readonly OccurrenceHandle[];
  // Explicit host/file replacement is an identity and history barrier, even
  // when its source happens to equal the previous source.
  readonly replacement?: boolean;
  readonly file?: string;
}
export interface DocumentUpdate {
  readonly before: DocumentSnapshot;
  readonly snapshot: DocumentSnapshot;
  readonly origin: string;
  readonly replacement: boolean;
  readonly changes: readonly SourceChange[];
  readonly mapping: SourceMapping;
  readonly affectedOwners: readonly OccurrenceHandle[];
  readonly changed: readonly OccurrenceHandle[];
  readonly retired: readonly OccurrenceHandle[];
}

function freeze<T>(value: T): Immutable<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

/** A mapping is valid only between its two named revisions. Deleted interior
 * positions return null; boundary affinity controls attachment to inserted text.
 */
export class SourceMapping {
  readonly changes: readonly SourceChange[];
  constructor(
    readonly fromRevision: number,
    readonly toRevision: number,
    readonly oldLength: number,
    changes: readonly SourceChange[],
    readonly replacement = false,
  ) {
    this.changes = freeze(changes.map(change => ({ ...change })));
    Object.freeze(this);
  }

  mapOffset(offset: number, affinity: 'left' | 'right' = 'right'): number | null {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.oldLength) {
      throw new RangeError('Source offset is outside the base document');
    }
    if (this.replacement) return null;
    let delta = 0;
    for (const change of this.changes) {
      if (offset < change.start) break;
      if (offset > change.start && offset < change.end) return null;
      if (offset === change.start) {
        if (affinity === 'left') return offset + delta;
        if (change.end > change.start) return change.start + delta + change.insert.length;
      }
      delta += change.insert.length - (change.end - change.start);
      // Continue at end boundaries: an adjacent edit can start here too.
    }
    return offset + delta;
  }

  mapRange(range: SourceRange): SourceRange | null {
    if (range.end < range.start) throw new RangeError('Reversed source range');
    const start = this.mapOffset(range.start, 'right');
    const end = this.mapOffset(range.end, 'left');
    return start === null || end === null || end < start ? null : { start, end };
  }
}

function components(ast: SourceFile): { component: Component; parent: Component | null }[] {
  const result: { component: Component; parent: Component | null }[] = [];
  function visit(value: Value, parent: Component | null): void {
    if (value.kind === 'list') value.items.forEach(item => visit(item, parent));
    if (value.kind !== 'component') return;
    result.push({ component: value, parent });
    value.fills.forEach(fill => visit(fill.value, value));
    value.implicitChildren.forEach(child => visit(child, value));
  }
  ast.items.forEach(item => visit(item, null));
  return result;
}

/** Session-local document service. Parsing is deliberately full-document for
 * now; slide resolution caches can consume the snapshot without parsing again.
 * Handles survive mapped edits within an owner, but never a complete owner
 * replacement, deletion, absence from a recovered parse, or host replacement.
 */
let nextDocument = 0;

export class DeckDocument {
  private readonly identity = ++nextDocument;
  private nextHandle = 0;
  private current: DocumentSnapshot;
  private byHandle: ReadonlyMap<OccurrenceHandle, DocumentOccurrence>;
  private lineStarts: readonly number[];
  constructor(source: string, file: string) {
    this.current = this.build(source, file, 0);
    this.byHandle = new Map(this.current.occurrences.map(item => [item.handle, item]));
    this.lineStarts = lineStarts(source);
  }
  get snapshot(): DocumentSnapshot { return this.current; }

  occurrence(handle: OccurrenceHandle): DocumentOccurrence | undefined {
    return this.byHandle.get(handle);
  }

  /** Convert a retained owner's relative location to current global offsets.
   * This avoids storing global offsets in cached slide-local diagnostics.
   */
  locate(handle: OccurrenceHandle, relative: SourceRange): Span | null {
    const owner = this.occurrence(handle);
    if (!owner) return null;
    if (!Number.isInteger(relative.start) || !Number.isInteger(relative.end) ||
        relative.start < 0 || relative.end < relative.start ||
        relative.end > owner.range.end - owner.range.start) {
      throw new RangeError('Location is outside its occurrence');
    }
    return {
      start: position(this.lineStarts, owner.range.start + relative.start),
      end: position(this.lineStarts, owner.range.start + relative.end),
    };
  }

  transact(transaction: DocumentTransaction): DocumentUpdate {
    const before = this.current;
    if (transaction.baseRevision !== before.revision) throw new Error('Stale document revision');
    if (transaction.file !== undefined && transaction.file !== before.file && !transaction.replacement) {
      throw new Error('Changing files requires a document replacement');
    }
    const changes = transaction.changes.map(change => ({ ...change }));
    let previous: SourceChange | undefined;
    for (const change of changes) {
      if (!Number.isInteger(change.start) || !Number.isInteger(change.end) ||
          change.start < 0 || change.end < change.start || change.end > before.source.length ||
          (previous && (change.start < previous.end || change.start === previous.start))) {
        throw new RangeError('Invalid or overlapping document changes');
      }
      previous = change;
    }
    const inferredOwners = changes.flatMap(change => {
      const enclosing = before.occurrences.filter(item => item.range.start <= change.start &&
        item.range.end >= change.end).sort((a, b) =>
          (a.range.end - a.range.start) - (b.range.end - b.range.start))[0];
      return enclosing ? [enclosing.handle] : [];
    });
    const owners = [...new Set(transaction.affectedOwners ?? inferredOwners)];
    if (owners.some(handle => !this.byHandle.has(handle))) {
      throw new Error('Affected owner does not belong to the base revision');
    }
    let source = '';
    let cursor = 0;
    for (const change of changes) {
      source += before.source.slice(cursor, change.start) + change.insert;
      cursor = change.end;
    }
    source += before.source.slice(cursor);
    freeze(changes);
    const mapping = new SourceMapping(before.revision, before.revision + 1, before.source.length,
      changes, transaction.replacement ?? false);
    const snapshot = this.build(source, transaction.file ?? before.file, mapping.toRevision, mapping);
    const retained = new Set(snapshot.occurrences.map(item => item.handle));
    const old = new Map(before.occurrences.map(item => [item.handle, item]));
    const changed = snapshot.occurrences.filter(item => {
      const prior = old.get(item.handle);
      return !prior || before.source.slice(prior.range.start, prior.range.end) !==
        source.slice(item.range.start, item.range.end);
    }).map(item => item.handle);
    const update = freeze({ before, snapshot, origin: transaction.origin,
      replacement: transaction.replacement ?? false, changes, mapping, affectedOwners: owners, changed,
      retired: before.occurrences.filter(item => !retained.has(item.handle)).map(item => item.handle),
    });
    this.current = snapshot;
    this.byHandle = new Map(snapshot.occurrences.map(item => [item.handle, item]));
    this.lineStarts = lineStarts(source);
    return update;
  }

  private build(source: string, file: string, revision: number, mapping?: SourceMapping): DocumentSnapshot {
    const parsed = parse(source, file);
    const candidates = new Map<string, OccurrenceHandle>();
    if (mapping && !mapping.replacement) {
      for (const item of this.current.occurrences) {
        // A complete replacement cannot establish occurrence identity, even if
        // the new text has exactly the same component name and source span.
        if (mapping.changes.some(change => change.start <= item.range.start &&
            change.end >= item.range.end && change.end > change.start)) continue;
        const range = mapping.mapRange(item.range);
        if (range) candidates.set(`${range.start}:${range.end}:${item.component.name}`, item.handle);
      }
    }
    const handles = new Map<Component, OccurrenceHandle>();
    const occurrences = components(parsed.ast).map(({ component, parent }) => {
      const range = { start: component.span.start.offset, end: component.span.end.offset };
      const key = `${range.start}:${range.end}:${component.name}`;
      const handle = candidates.get(key) ?? `document-${this.identity}:occurrence-${++this.nextHandle}` as OccurrenceHandle;
      handles.set(component, handle);
      return { handle, component, range, parent: parent ? handles.get(parent)! : null };
    });
    return freeze({ revision, source, file, ...parsed, occurrences });
  }
}

function lineStarts(source: string): readonly number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

function position(starts: readonly number[], offset: number): Pos {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid;
  }
  return { offset, line: low + 1, column: offset - starts[low]! + 1 };
}
