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

import { emit } from '../runtime/emitter.js';
import { parse } from '../runtime/parser.js';
import type {
  Component,
  ListLit,
  NameRef,
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

// Walks a freshly parsed AST to find the Freeform that's the
// `content` of the active slide. v0.2.f's Box drawing tool only
// supports slides where content is *directly* a Freeform — the
// reference deck's Freeform-demo slide. Future generalization
// (drawing inside Freeforms nested deeper, e.g., inside a ZStack)
// is straightforward but not in scope.
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

// ─── Constructors ────────────────────────────────────────────────

// Spans are placeholder zeros — the emitter ignores spans, and the
// next re-parse rebuilds them from the actual source. The
// placeholder keeps the type system happy without needing a
// separate "AST without spans" representation.
const ZERO_SPAN: Span = {
  start: { offset: 0, line: 0, column: 0 },
  end: { offset: 0, line: 0, column: 0 },
};

function makeNumberLit(value: number): NumberLit {
  return { kind: 'number', value, span: ZERO_SPAN };
}

function makeNameRef(name: string): NameRef {
  return { kind: 'name_ref', name, span: ZERO_SPAN };
}

function makeSlotFill(name: string, value: Value): SlotFill {
  return { kind: 'slot_fill', name, value, span: ZERO_SPAN };
}

function makeStringLit(value: string): StringLit {
  return { kind: 'string', value, multiline: false, span: ZERO_SPAN };
}

export function makeBoxNode(
  x: number,
  y: number,
  width: number,
  height: number,
  fillToken: string,
): Component {
  return {
    kind: 'component',
    name: 'Box',
    fills: [
      makeSlotFill('x', makeNumberLit(x)),
      makeSlotFill('y', makeNumberLit(y)),
      makeSlotFill('width', makeNumberLit(width)),
      makeSlotFill('height', makeNumberLit(height)),
      makeSlotFill('fill', makeNameRef(fillToken)),
    ],
    implicitChildren: [],
    span: ZERO_SPAN,
    bodySpan: ZERO_SPAN,
  };
}

export function makeTextBoxNode(
  x: number,
  y: number,
  width: number,
  height: number,
): Component {
  return {
    kind: 'component',
    name: 'TextBox',
    fills: [
      makeSlotFill('x', makeNumberLit(x)),
      makeSlotFill('y', makeNumberLit(y)),
      makeSlotFill('width', makeNumberLit(width)),
      makeSlotFill('height', makeNumberLit(height)),
      // Placeholder content so the user has a visible text region
      // to double-click into. Auto-enter-edit on creation is
      // future polish.
      makeSlotFill('content', makeStringLit('Text')),
    ],
    implicitChildren: [],
    span: ZERO_SPAN,
    bodySpan: ZERO_SPAN,
  };
}

export function makeArrowNode(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Component {
  return {
    kind: 'component',
    name: 'Arrow',
    fills: [
      makeSlotFill('x1', makeNumberLit(x1)),
      makeSlotFill('y1', makeNumberLit(y1)),
      makeSlotFill('x2', makeNumberLit(x2)),
      makeSlotFill('y2', makeNumberLit(y2)),
    ],
    implicitChildren: [],
    span: ZERO_SPAN,
    bodySpan: ZERO_SPAN,
  };
}

// ─── Mutators ────────────────────────────────────────────────────

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
// matches `target` from any list it appears in. Returns true if a
// removal happened. Used by the Delete-key handler — the selected
// span identifies which child of which Freeform-children list to
// drop.
export function removeShapeAtSpan(
  ast: SourceFile,
  target: SourceRange,
): boolean {
  let removed = false;
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
        node.items = node.items.filter(
          (item) =>
            !(
              item.kind === 'component' &&
              item.span.start.offset === target.start &&
              item.span.end.offset === target.end
            ),
        );
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

// ─── Edit pipeline ───────────────────────────────────────────────

// Position of a shape in its containing Freeform, used by drag and
// resize to preserve selection across the emit cycle. Spans shift
// when the canonical formatter rewrites whitespace, so the in-flight
// (start, end) doesn't match anything in the post-emit tree — but
// child index *does* survive (the operation only mutates the
// shape's own slot fills, never reorders siblings).
export interface PreserveSelection {
  slideIdx: number;
  childIdx: number;
}

export interface CommitResult {
  newSource: string;
  // The mutated shape's new (start, end), if `mutate` requested
  // selection preservation. Callers stash this in
  // `pendingSelectionRef` so the host's subscribe handler can
  // re-apply selection after `setSource` flushes through.
  newSelection: SourceRange | null;
}

// Source-mutation pipeline shared by every gesture-commit path
// (drag, resize, create, delete, text-edit). The mutate callback
// receives a freshly parsed AST and either:
//   - returns `null` to abort the commit (target not found, no
//     visible change, etc.)
//   - returns `{}` to commit without selection preservation
//   - returns `{ preserveSelection: ... }` to commit AND have
//     this helper re-find the shape post-emit and report its new
//     span via `newSelection` on the result
//
// On parse error (either before mutation or in the post-emit
// reparse), the function returns null without calling setSource —
// the caller stays at the pre-edit source rather than emitting on
// top of a partial AST.
export function commitSourceEdit(
  source: string,
  label: string,
  mutate: (
    ast: SourceFile,
  ) => { preserveSelection?: PreserveSelection } | null,
): CommitResult | null {
  const result = parse(source, label);
  if (result.diagnostics.some((d) => d.severity === 'error')) return null;
  const outcome = mutate(result.ast);
  if (!outcome) return null;
  const newSource = emit(result.ast);
  let newSelection: SourceRange | null = null;
  if (outcome.preserveSelection) {
    const { slideIdx, childIdx } = outcome.preserveSelection;
    const reparsed = parse(newSource, `${label}-after`);
    if (!reparsed.diagnostics.some((d) => d.severity === 'error')) {
      const newShape = findShapeAtChildIdx(reparsed.ast, slideIdx, childIdx);
      if (newShape) {
        newSelection = {
          start: newShape.span.start.offset,
          end: newShape.span.end.offset,
        };
      }
    }
  }
  return { newSource, newSelection };
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
