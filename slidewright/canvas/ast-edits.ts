// Slidewright canvas — pure AST edit helpers.
//
// These functions read or mutate slidewright AST nodes without any
// React, DOM, or Host coupling. The canvas's gesture effects use
// them to translate "user moved this shape by (dx, dy)" into "this
// component's x/y slot-fill values change to N/M" — they're the
// AST-level half of every gesture's commit pipeline.
//
// Two shapes of helper live here:
//
//   - **Locators** (findStringAt, findComponentAtSpan,
//     findNumericSlot, findActiveSlideFreeform, findShapeChildIdx,
//     findShapeAtChildIdx). Walk an AST looking for nodes that
//     match a span / index. Return null when no match — callers
//     (gesture handlers) must handle the missing-shape case
//     gracefully because parsing can fail or spans can shift.
//
//   - **Constructors / mutators** (makeBoxNode, makeTextBoxNode,
//     makeArrowNode, appendShapeToFreeform, removeShapeAtSpan).
//     Build new AST subtrees or mutate an existing AST in place.
//     Synthetic nodes use ZERO_SPAN — the emitter ignores spans,
//     and the next re-parse rebuilds them from real source offsets.
//
// One geometry helper (computeArrowGeometry) lives here too —
// strictly it's not an AST edit, but it's a pure helper used by
// the same gesture-commit code, and pulling it out of App keeps
// the SVG-arithmetic noise out of React state-management code.

import { prepareBuildMutation } from './build-editing.js';
import { SourceEditWriter, sameAuthoredValue } from './source-preserving.js';
import { SourceMapping, type DocumentSnapshot, type SourceChange } from '../runtime/document.js';
import { parseDocument, type ParseWork } from '../runtime/document-parser.js';
import { parse } from '../runtime/parser.js';
import { makeComponent, slotFill } from '../runtime/ast-builders.js';
import type {
  Component,
  ListLit,
  Node,
  NumberLit,
  SlotFill,
  SourceFile,
  Span,
  StringLit,
  Value,
} from '../runtime/ast.js';
import type { SourceRange } from './host.js';

// ─── Locators ────────────────────────────────────────────────────

// Walks the AST looking for a StringLit whose source span exactly
// matches `(start, end)`. Used by the text-edit commit path to find
// the node corresponding to the rendered <span data-sw-text-span-*>
// the user double-clicked. Spans are stable byte offsets — they
// uniquely identify the literal even when other strings in the
// source share the same value.
export function findStringAt(
  root: SourceFile,
  start: number,
  end: number,
): StringLit | null {
  let found: StringLit | null = null;
  const visit = (node: Node | Value): void => {
    if (found) return;
    if (
      node.kind === 'string' &&
      node.span.start.offset === start &&
      node.span.end.offset === end
    ) {
      found = node;
      return;
    }
    switch (node.kind) {
      case 'source_file':
        for (const c of node.items) visit(c);
        return;
      case 'component':
        for (const f of node.fills) visit(f);
        for (const c of node.implicitChildren) visit(c);
        return;
      case 'slot_fill':
        visit(node.value);
        return;
      case 'list':
        for (const v of node.items) visit(v);
        return;
      default:
        return;
    }
  };
  visit(root);
  return found;
}

// Same idea as findStringAt, but for whole component invocations —
// used by the drag-to-move gesture to find the AST node whose x/y
// slot-fill values need updating.
export function findComponentAtSpan(
  root: SourceFile,
  start: number,
  end: number,
): Component | null {
  let found: Component | null = null;
  const visit = (node: Node | Value): void => {
    if (found) return;
    if (
      node.kind === 'component' &&
      node.span.start.offset === start &&
      node.span.end.offset === end
    ) {
      found = node;
      return;
    }
    switch (node.kind) {
      case 'source_file':
        for (const c of node.items) visit(c);
        return;
      case 'component':
        for (const f of node.fills) visit(f);
        for (const c of node.implicitChildren) visit(c);
        return;
      case 'slot_fill':
        visit(node.value);
        return;
      case 'list':
        for (const v of node.items) visit(v);
        return;
      default:
        return;
    }
  };
  visit(root);
  return found;
}

// Reads a numeric slot fill from a component, returning the AST node
// (so the drag handler can mutate its `value` in place) and the
// current numeric value. Returns null if the slot isn't a plain
// number — a future "computed defaults" world might have a
// solve.* expression here, in which case dragging would need to
// promote it to a literal-override; v0.2.e dodges that by skipping
// non-literal cases.
export function findNumericSlot(
  comp: Component,
  name: string,
): { node: NumberLit; value: number } | null {
  for (const fill of comp.fills) {
    if (fill.name === name && fill.value.kind === 'number') {
      return { node: fill.value, value: fill.value.value };
    }
  }
  return null;
}

// Find a slide's direct Freeform for the legacy child-index selection
// helpers below. Drawing destinations resolve by authored source span
// instead, so they can target nested Freeforms as well.
export function findActiveSlideFreeform(
  ast: SourceFile,
  activeIdx: number,
): Component | null {
  const deck = ast.items[0];
  if (!deck || deck.name !== 'Deck') return null;
  const slidesFill = deck.fills.find((f) => f.name === 'slides');
  if (!slidesFill || slidesFill.value.kind !== 'list') return null;
  const slide = slidesFill.value.items[activeIdx];
  if (!slide || slide.kind !== 'component' || slide.name !== 'Slide') return null;
  const contentFill = slide.fills.find((f) => f.name === 'content');
  if (
    !contentFill ||
    contentFill.value.kind !== 'component' ||
    contentFill.value.name !== 'Freeform'
  ) {
    return null;
  }
  return contentFill.value;
}

// Locate the index of a shape (matched by source span) within the
// active Freeform's `children` list. Used by the selection-
// preservation logic in drag and resize: spans shift on every emit
// so we can't carry the old (start, end) across, but the child
// index is stable as long as the operation only mutates the shape's
// own slot fills.
export function findShapeChildIdx(
  ast: SourceFile,
  slideIdx: number,
  target: SourceRange,
): number | null {
  const freeform = findActiveSlideFreeform(ast, slideIdx);
  if (!freeform) return null;
  const childrenFill = freeform.fills.find((f) => f.name === 'children');
  if (!childrenFill || childrenFill.value.kind !== 'list') return null;
  for (let i = 0; i < childrenFill.value.items.length; i++) {
    const item = childrenFill.value.items[i];
    if (
      item &&
      item.kind === 'component' &&
      item.span.start.offset === target.start &&
      item.span.end.offset === target.end
    ) {
      return i;
    }
  }
  return null;
}

// Reverse direction: find the Component at a given index in the
// active Freeform's children list. Used after re-parsing the post-
// emit source to grab the same shape's new span.
export function findShapeAtChildIdx(
  ast: SourceFile,
  slideIdx: number,
  idx: number,
): Component | null {
  const freeform = findActiveSlideFreeform(ast, slideIdx);
  if (!freeform) return null;
  const childrenFill = freeform.fills.find((f) => f.name === 'children');
  if (!childrenFill || childrenFill.value.kind !== 'list') return null;
  const item = childrenFill.value.items[idx];
  return item?.kind === 'component' ? item : null;
}

// ─── Internal AST helpers ────────────────────────────────────────
//
// Spans are placeholder zeros — the emitter ignores spans, and the
// next re-parse rebuilds them from the actual source. Used by the
// mutators below (addStringSlotFill, appendShapeToFreeform) to
// graft fresh nodes onto an existing tree. Component-specific
// stub constructors (`makeBoxNode` / `makeTextBoxNode` /
// `makeArrowNode`) used to live here but moved to each
// component's own `insertion.stub` in `decks/v0-reference/
// components/`, consuming `runtime/ast-builders` instead.
const ZERO_SPAN: Span = {
  start: { offset: 0, line: 0, column: 0 },
  end: { offset: 0, line: 0, column: 0 },
};

function makeSlotFill(name: string, value: Value): SlotFill {
  return { kind: 'slot_fill', name, value, span: ZERO_SPAN };
}

function makeStringLit(value: string): StringLit {
  return { kind: 'string', value, multiline: false, span: ZERO_SPAN };
}

// ─── Mutators ────────────────────────────────────────────────────

// Materialize a slot fill on a parent component. Used to convert
// an empty-slot selection into a real SlotFill — the inspector's
// "type a value" input and the dblclick-on-empty-text-placeholder
// gesture both pipe through here. Returns true if a fill was added
// (false if the slot already exists, which means the caller should
// edit the existing fill instead).
export function addStringSlotFill(
  parent: Component,
  slotName: string,
  value: string,
): boolean {
  if (parent.fills.some((f) => f.name === slotName)) return false;
  parent.fills.push(makeSlotFill(slotName, makeStringLit(value)));
  return true;
}

// Splice an arbitrary AST value into a parent component's slot.
// Caller passes the slot's declared type so array-typed slots get
// their value wrapped in a single-element `ListLit`. Used by the
// drag-from-toolbar insertion pipeline to materialize a stub into
// a previously-empty slot.
//
// Returns true on success, false if the slot is already filled
// (drag-into-filled-slot is rejected by the drop-target validity
// check, but the AST-level guard belt-and-suspenders).
export function materializeSlotFill(
  parent: Component,
  slotName: string,
  slotType: string,
  value: Value,
): boolean {
  if (parent.fills.some((f) => f.name === slotName)) return false;
  if (slotType.startsWith('array<')) {
    const list: ListLit = {
      kind: 'list',
      items: [value],
      span: ZERO_SPAN,
    };
    parent.fills.push(makeSlotFill(slotName, list));
  } else {
    parent.fills.push(makeSlotFill(slotName, value));
  }
  return true;
}

// Insert a value into an existing array-typed slot at the given
// index. Used by drag-into-gap on a filled `array<...>` slot.
// `index` ranges from 0 (insert before first child) to N (append
// after last child). Returns true on success; false if the slot
// is missing or not a list.
//
// Special case: when `slotName === 'children'` and the parent has
// implicit-children syntax (bare component invocations in its
// body, no `children:` fill), splice into `implicitChildren`
// instead — preserving the author's chosen surface form. The
// inserted value must be a Component for this path; non-component
// values can't be expressed as implicit children, so we fall back
// to materializing an explicit `children: [...]` fill.
export function insertIntoArraySlot(
  parent: Component,
  slotName: string,
  index: number,
  value: Value,
): boolean {
  const fill = parent.fills.find((f) => f.name === slotName);
  if (fill && fill.value.kind === 'list') {
    const items = fill.value.items;
    const clamped = Math.max(0, Math.min(index, items.length));
    items.splice(clamped, 0, value);
    return true;
  }
  if (
    !fill &&
    slotName === 'children' &&
    parent.implicitChildren.length > 0 &&
    value.kind === 'component'
  ) {
    const clamped = Math.max(0, Math.min(index, parent.implicitChildren.length));
    parent.implicitChildren.splice(clamped, 0, value);
    return true;
  }
  return false;
}

// ─── Component-path identity ─────────────────────────────────────
//
// Length-changing source edits shift later component offsets. Operations that need to identify
// "the same logical component" before and after a commit (e.g.,
// dblclick-on-empty-text-slot wants the materialized parent's new
// span) walk the AST by a path of structural segments from the
// SourceFile root, which IS stable as long as no surrounding
// list-reorder happened.

export type PathSegment =
  | { kind: 'item'; index: number }
  | { kind: 'fill'; name: string }
  | { kind: 'implicit'; index: number };

export function pathToComponent(
  root: SourceFile,
  target: Component,
): PathSegment[] | null {
  for (let i = 0; i < root.items.length; i++) {
    const result = walkForPath(
      root.items[i]!,
      target,
      [{ kind: 'item', index: i }],
    );
    if (result) return result;
  }
  return null;
}

function walkForPath(
  node: Component | Value,
  target: Component,
  path: PathSegment[],
): PathSegment[] | null {
  if (node === target) return path;
  if (node.kind === 'component') {
    for (const fill of node.fills) {
      const r = walkForPath(
        fill.value,
        target,
        [...path, { kind: 'fill', name: fill.name }],
      );
      if (r) return r;
    }
    for (let i = 0; i < node.implicitChildren.length; i++) {
      const r = walkForPath(
        node.implicitChildren[i]!,
        target,
        [...path, { kind: 'implicit', index: i }],
      );
      if (r) return r;
    }
    return null;
  }
  if (node.kind === 'list') {
    for (let i = 0; i < node.items.length; i++) {
      const r = walkForPath(
        node.items[i]!,
        target,
        [...path, { kind: 'item', index: i }],
      );
      if (r) return r;
    }
  }
  return null;
}

export function componentByPath(
  root: SourceFile,
  path: PathSegment[],
): Component | null {
  if (path.length === 0) return null;
  const first = path[0]!;
  if (first.kind !== 'item') return null;
  let cursor: Component | Value | undefined = root.items[first.index];
  for (let i = 1; i < path.length; i++) {
    if (!cursor) return null;
    const seg = path[i]!;
    if (seg.kind === 'fill') {
      if (cursor.kind !== 'component') return null;
      const comp: Component = cursor;
      const fill: SlotFill | undefined = comp.fills.find(
        (f) => f.name === seg.name,
      );
      cursor = fill ? fill.value : undefined;
    } else if (seg.kind === 'item') {
      if (cursor.kind !== 'list') return null;
      cursor = cursor.items[seg.index];
    } else if (seg.kind === 'implicit') {
      if (cursor.kind !== 'component') return null;
      cursor = cursor.implicitChildren[seg.index];
    }
  }
  return cursor && cursor.kind === 'component' ? cursor : null;
}

export function appendShapeToFreeform(
  freeform: Component,
  shape: Component,
): void {
  let childrenFill = freeform.fills.find((f) => f.name === 'children');
  if (!childrenFill) {
    const list: ListLit = { kind: 'list', items: [], span: ZERO_SPAN };
    childrenFill = makeSlotFill('children', list);
    freeform.fills.push(childrenFill);
  }
  if (childrenFill.value.kind !== 'list') return;
  childrenFill.value.items.push(shape);
}

// Walks the AST and removes any Component whose source span exactly
// matches `target` from an explicit list or implicit children.
// Returns true if a removal happened. Scalar slot values are left
// intact: clearing a slot is a separate operation from removing a child.
export function removeShapeAtSpan(
  ast: SourceFile,
  target: SourceRange,
): boolean {
  if (removeListItemAtSpan(ast, target, 'component-only')) return true;

  const visit = (node: Node | Value): boolean => {
    switch (node.kind) {
      case 'source_file':
        return node.items.some(visit);
      case 'component': {
        const index = node.implicitChildren.findIndex(child =>
          child.span.start.offset === target.start &&
          child.span.end.offset === target.end);
        if (index !== -1) {
          node.implicitChildren.splice(index, 1);
          return true;
        }
        return node.fills.some(visit) || node.implicitChildren.some(visit);
      }
      case 'slot_fill':
        return visit(node.value);
      case 'list':
        return node.items.some(visit);
      default:
        return false;
    }
  };
  return visit(ast);
}

// Walk the AST looking for a list whose items contain a node with
// the given source span; splice it out. Used by canvas delete
// (component-only mode, preserving the v0.2 behavior) and by the
// inspector's array-row remove button (any-kind mode, lets primitive
// list items be deleted too).
export function removeListItemAtSpan(
  ast: SourceFile,
  target: SourceRange,
  mode: 'component-only' | 'any-kind',
): boolean {
  let removed = false;
  const matches = (item: Value): boolean => {
    if (item.span.start.offset !== target.start) return false;
    if (item.span.end.offset !== target.end) return false;
    return mode === 'any-kind' || item.kind === 'component';
  };
  const visit = (node: Node | Value): void => {
    if (removed) return;
    switch (node.kind) {
      case 'source_file':
        for (const c of node.items) visit(c);
        return;
      case 'component':
        for (const f of node.fills) visit(f);
        for (const c of node.implicitChildren) visit(c);
        return;
      case 'slot_fill':
        visit(node.value);
        return;
      case 'list': {
        const before = node.items.length;
        node.items = node.items.filter((item) => !matches(item));
        if (node.items.length !== before) {
          removed = true;
          return;
        }
        for (const item of node.items) visit(item);
        return;
      }
      default:
        return;
    }
  };
  visit(ast);
  return removed;
}

// ─── Slide-list mutators ─────────────────────────────────────────
//
// Operate on the top-level `Deck.slides` array. The deck is always
// the first item in a well-formed source file. Each helper returns
// false (or a sentinel) when the slides list can't be located so
// the caller can abort the commit.

function findSlidesList(ast: SourceFile): ListLit | null {
  const deck = ast.items[0];
  if (!deck || deck.kind !== 'component' || deck.name !== 'Deck') return null;
  const slidesFill = deck.fills.find((f) => f.name === 'slides');
  if (!slidesFill || slidesFill.value.kind !== 'list') return null;
  return slidesFill.value;
}

// Insert a slide with an empty Freeform, ready for drawing/insertion.
// Returns its index, or -1 if the deck/slides list can't be found.
export function insertEmptySlide(ast: SourceFile, index: number): number {
  const list = findSlidesList(ast);
  if (!list) return -1;
  const insertAt = Math.max(0, Math.min(list.items.length, index));
  list.items.splice(insertAt, 0, makeComponent('Slide', [
    slotFill('content', makeComponent('Freeform', [])),
  ]));
  return insertAt;
}

// Duplicate the complete authored slide, including notes and comments.
// Returns the copy's index, or -1 when there is no slide to copy.
export function duplicateSlideAtIndex(ast: SourceFile, index: number): number {
  const list = findSlidesList(ast);
  const slide = list?.items[index];
  if (!list || !slide) return -1;
  list.items.splice(index + 1, 0, structuredClone(slide));
  return index + 1;
}

// Remove slides at the given indices from the deck's slides list.
// Returns the count actually removed. Indices outside [0, N) are
// silently skipped. Duplicates are deduped. Single commit → single
// undo entry.
export function removeSlidesAtIndices(
  ast: SourceFile,
  indices: ReadonlyArray<number>,
): number {
  const list = findSlidesList(ast);
  if (!list) return 0;
  const drop = new Set<number>();
  for (const i of indices) {
    if (i >= 0 && i < list.items.length) drop.add(i);
  }
  if (drop.size === 0) return 0;
  list.items = list.items.filter((_, i) => !drop.has(i));
  return drop.size;
}

// Reorder slides: take the slides at `fromIndices` (in their
// existing relative order) and splice them in at `toIndex` of the
// original list. `toIndex` is interpreted relative to the
// ORIGINAL indexing — i.e., "insert before slide N of the
// pre-move list" — and indices in `fromIndices` count toward
// neither the source nor destination after extraction. Returns
// true if the list changed, false otherwise (no-op when the
// destination falls inside the contiguous moved range).
export function reorderSlides(
  ast: SourceFile,
  fromIndices: ReadonlyArray<number>,
  toIndex: number,
): boolean {
  const list = findSlidesList(ast);
  if (!list) return false;
  const n = list.items.length;
  const dedup = Array.from(new Set(fromIndices)).filter((i) => i >= 0 && i < n);
  if (dedup.length === 0) return false;
  dedup.sort((a, b) => a - b);
  // No-op check: the moved range is already at toIndex (i.e.,
  // toIndex is inside or just-after the moved indices and the
  // group is contiguous). Specifically, if the original indices
  // are [k, k+1, ..., k+m-1] and toIndex ∈ [k, k+m], it's a no-op.
  const contiguous = dedup.every((v, i) => i === 0 || v === dedup[i - 1]! + 1);
  if (contiguous && toIndex >= dedup[0]! && toIndex <= dedup[dedup.length - 1]! + 1) {
    return false;
  }
  const moving = dedup.map((i) => list.items[i]!);
  // Count how many removed slides are at indices < toIndex so we
  // can adjust the insertion point after extraction.
  let insertAt = toIndex;
  for (const i of dedup) {
    if (i < toIndex) insertAt--;
  }
  // Extract (filter) then splice in at the adjusted point.
  list.items = list.items.filter((_, i) => !dedup.includes(i));
  list.items.splice(insertAt, 0, ...moving);
  return true;
}

// Compute, given an original list size, a set of from-indices,
// and a destination toIndex, the resulting indices of the moved
// slides in the post-reorder list. Mirrors reorderSlides's index
// arithmetic so the caller can update slide-selection state
// without re-parsing. Returns null on no-op (matching reorder-
// Slides's no-op rule).
export function projectReorderedIndices(
  total: number,
  fromIndices: ReadonlyArray<number>,
  toIndex: number,
): number[] | null {
  const dedup = Array.from(new Set(fromIndices))
    .filter((i) => i >= 0 && i < total)
    .sort((a, b) => a - b);
  if (dedup.length === 0) return null;
  const contiguous = dedup.every((v, i) => i === 0 || v === dedup[i - 1]! + 1);
  if (contiguous && toIndex >= dedup[0]! && toIndex <= dedup[dedup.length - 1]! + 1) {
    return null;
  }
  let insertAt = toIndex;
  for (const i of dedup) {
    if (i < toIndex) insertAt--;
  }
  return dedup.map((_, k) => insertAt + k);
}

// ─── Edit pipeline ───────────────────────────────────────────────

// Position of a shape in its containing Freeform, used by drag and
// resize to preserve selection across source edits. A length-changing
// splice can shift the in-flight (start, end) in the reparsed tree, but
// child index *does* survive (the operation only mutates the
// shape's own slot fills, never reorders siblings).
export interface PreserveSelection {
  slideIdx: number;
  childIdx: number;
}

export interface CommitResult {
  baseRevision?: number;
  changes: SourceChange[];
  newSource: string;
  // Read-only validation output; it is never an authoritative host document.
  ast: SourceFile;
  parsing: { input: ParseWork; output: ParseWork };
  // Each preserved shape's new (start, end). Empty array if the
  // mutate callback did not request preservation.
  // Callers stash this in `pendingSelectionRef` so the host's
  // subscribe handler can re-apply selection after `setSource`
  // flushes through.
  newSelections: SourceRange[];
}

// Source-mutation pipeline shared by every gesture-commit path
// (drag, resize, create, delete, text-edit, group operations).
// The mutate callback receives a private mutable AST and either:
//   - returns `null` to abort the commit (target not found, no
//     visible change, etc.)
//   - returns `{}` to commit without selection preservation
//   - returns `{ preserveSelections: [...] }` to commit AND have
//     this helper re-find each shape post-emit and report their
//     new spans via `newSelections` on the result
//   - returns `{ selectComponents: [...] }` to select inserted/authored
//     components by structural path, including inside nested containers
//
// preserveSelections (plural) supports group gestures naturally —
// each selected shape's onCommit contributes one PreserveSelection
// to the list. Single-shape gestures pass a one-element array.
//
// Emit changed authored fragments as source splices, retaining untouched
// source verbatim. Reparse to validate syntax and semantic equivalence.
// On parse error (either before mutation or in the output reparse), the function returns null without calling setSource —
// the caller stays at the pre-edit source rather than emitting on
// top of a partial AST.
export function commitSourceEdit(
  source: string,
  label: string,
  mutate: (
    ast: SourceFile,
  ) => { preserveSelections?: PreserveSelection[]; selectComponents?: Component[] } | null,
  snapshot?: DocumentSnapshot,
): CommitResult | null {
  if (snapshot && snapshot.source !== source) return null;
  const input: ParseWork = { fullParses: snapshot ? 0 : 1, componentParses: 0,
    parsedCharacters: snapshot ? 0 : source.length };
  const result = snapshot ? { ast: structuredClone(snapshot.ast) as SourceFile, diagnostics: snapshot.diagnostics }
    : parse(source, label);
  if (result.diagnostics.some((d) => d.severity === 'error')) return null;
  const writer = new SourceEditWriter(source, result.ast);
  const build = prepareBuildMutation(snapshot, result.ast,
    ['<drag>', '<nudge>'].includes(label) ? [['x', 'y'], ['x1', 'y1', 'x2', 'y2']] : []);
  const editingAst = build?.ast ?? result.ast;
  const outcome = mutate(editingAst);
  if (!outcome) return null;
  if (build) {
    const selected = [...(outcome.selectComponents ?? [])];
    for (const { slideIdx, childIdx } of outcome.preserveSelections ?? []) {
      const node = findShapeAtChildIdx(editingAst, slideIdx, childIdx);
      if (node) selected.push(node);
    }
    if (!build.lower()) return null;
    outcome.selectComponents = selected.map(component => build.canonicalComponent(component)).filter((component): component is Component => !!component);
    outcome.preserveSelections = [];
  }
  const selectedPaths: PathSegment[][] = [];
  for (const component of outcome.selectComponents ?? []) {
    const path = pathToComponent(result.ast, component);
    if (!path) return null;
    selectedPaths.push(path);
  }
  const { newSource, changes } = writer.write(result.ast);
  const reparsed = snapshot
    ? changes.length ? parseDocument(newSource, snapshot.file, snapshot,
        new SourceMapping(snapshot.revision, snapshot.revision + 1, source.length, changes))
      : { ast: snapshot.ast as SourceFile, diagnostics: snapshot.diagnostics,
          parsing: { fullParses: 0, componentParses: 0, parsedCharacters: 0 } }
    : { ...parse(newSource, `${label}-after`), parsing: { fullParses: 1, componentParses: 0, parsedCharacters: newSource.length } };
  if (reparsed.diagnostics.some(d => d.severity === 'error') || !sameAuthoredValue(result.ast, reparsed.ast)) return null;
  const newSelections: SourceRange[] = [];
  if (outcome.preserveSelections?.length || selectedPaths.length) {
    for (const { slideIdx, childIdx } of outcome.preserveSelections ?? []) {
      const newShape = findShapeAtChildIdx(reparsed.ast, slideIdx, childIdx);
      if (newShape) {
        newSelections.push({
          start: newShape.span.start.offset,
          end: newShape.span.end.offset,
        });
      }
    }
    for (const path of selectedPaths) {
      const component = componentByPath(reparsed.ast, path);
      if (component) newSelections.push({ start: component.span.start.offset, end: component.span.end.offset });
    }
  }
  return { baseRevision: snapshot?.revision, newSource, newSelections, changes, ast: reparsed.ast, parsing: { input, output: reparsed.parsing } };
}

// ─── Geometry ────────────────────────────────────────────────────

// Mirrors decks/v0-reference/components/Arrow.tsx's arrowhead
// computation. Used by drag (body translate) and resize (endpoint
// move) to keep the line + polygon visually consistent during live
// gestures — the visible line ends at the arrowhead BASE, not the
// tip, and the polygon needs three vertices recomputed every
// frame as the angle changes. Returns the coordinates the SVG
// elements need to display the final geometry.
export function computeArrowGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth: number,
): { baseX: number; baseY: number; points: string } {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(12, strokeWidth * 3);
  const halfWidth = head * 0.6;
  const baseX = x2 - head * Math.cos(angle);
  const baseY = y2 - head * Math.sin(angle);
  const lx = -Math.sin(angle) * halfWidth;
  const ly = Math.cos(angle) * halfWidth;
  return {
    baseX,
    baseY,
    points: `${x2},${y2} ${baseX + lx},${baseY + ly} ${baseX - lx},${baseY - ly}`,
  };
}
