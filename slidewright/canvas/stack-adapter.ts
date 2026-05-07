// Shared canvas-gesture logic for HStack / VStack (and any future
// flow-laid container with a single children-list slot).
//
// Bound up in `makeStackAdapter({ axis })` so HStack and VStack get
// a complete LayoutAdapter from one call. Two gestures live here:
//
//   - **Reorder.** Drag a child to a new index. Entered via
//     `interceptChildDrag`; UX is an insertion-indicator line at
//     the target gap. The dragged child doesn't move during the
//     drag; on release, the parent's `children` slot is rewritten.
//
//   - **Gap-drag.** Drag a grip in the gap between adjacent
//     children to change `spacing`. Entered via `Handles` (each
//     gap renders one grip); UX reflows the layout live.
//
// Both share the opaque-delta channel: `buildGestureState` /
// `combineGestureState` / `applyGesture` / `commit` discriminate on
// the gesture's internal `kind`.

import { useLayoutEffect, useState, createElement } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import type {
  Component,
  ListLit,
  NumberLit,
  Span,
  Value,
} from '../runtime/ast.js';
import {
  findComponentAtSpan,
  findNumericSlot,
  findShapeChildIdx,
} from './ast-edits.js';

import type {
  ChildDragContext,
  LayoutAdapter,
} from './layout-adapter.js';
import type { HandlesProps, ShapeSpan } from './shape-adapter.js';

type Axis = 'h' | 'v';

// ─── Reorder-specific opaque types ───────────────────────────────

interface ReorderInit {
  kind: 'reorder';
  axis: Axis;
  // Index of the dragged child in the parent's children list.
  sourceIdx: number;
  // Each child's main-axis bounds (start = top for VStack / left
  // for HStack; end = bottom / right). Design-space, freeform-
  // relative coordinates.
  childMainBounds: Array<{ start: number; end: number }>;
  // Cross-axis bounds of the parent layout itself — used to size
  // the insertion-indicator line perpendicular to the main axis.
  crossStart: number;
  crossEnd: number;
  // Pointer's main-axis position at gesture start (design space).
  pointerMainStart: number;
}

interface ReorderState extends ReorderInit {}

interface ReorderDelta {
  kind: 'reorder';
  axis: Axis;
  sourceIdx: number;
  // Target insertion slot in the parent's children list. Range
  // [0..N] where N is the original children count. `targetIdx` =
  // i means "insert the dragged child immediately before original
  // child i" (or at the end if i == N). Movement is a no-op when
  // targetIdx == sourceIdx or targetIdx == sourceIdx + 1.
  targetIdx: number;
  // Insertion-line position along the main axis (design-space).
  // Computed in combineGestureState so the overlay's render is
  // a pure read.
  lineMainPos: number;
  crossStart: number;
  crossEnd: number;
}

// ─── Gap-drag-specific opaque types ──────────────────────────────

interface GapDragInit {
  kind: 'gap-drag';
  axis: Axis;
  // The current spacing at gesture start. combineGestureState
  // derives the new spacing as max(0, originalSpacing + cursor
  // delta along main axis).
  originalSpacing: number;
}

interface GapDragState extends GapDragInit {}

interface GapDragDelta {
  kind: 'gap-drag';
  newSpacing: number;
}

type StackInit = ReorderInit | GapDragInit;
type StackState = ReorderState | GapDragState;
type StackDelta = ReorderDelta | GapDragDelta;

// ─── Adapter factory ─────────────────────────────────────────────

export function makeStackAdapter(opts: { axis: Axis }): LayoutAdapter {
  const { axis } = opts;

  return {
    kind: 'layout',

    interceptChildDrag(ctx) {
      return captureReorderInit(ctx, axis);
    },

    Handles(props) {
      return GapDragHandles({ ...props, axis });
    },

    buildGestureState(init) {
      const cast = init as StackInit | null;
      if (!cast) return null;
      if (cast.kind === 'reorder') {
        const state: ReorderState = { ...cast };
        return state;
      }
      if (cast.kind === 'gap-drag') {
        const state: GapDragState = { ...cast };
        return state;
      }
      return null;
    },

    combineGestureState(state, dx, dy) {
      const cast = state as StackState | null;
      if (!cast) return null;
      if (cast.kind === 'reorder') {
        const cursorMain =
          cast.axis === 'v'
            ? cast.pointerMainStart + dy
            : cast.pointerMainStart + dx;
        const targetIdx = targetIndexFromCursor(cast.childMainBounds, cursorMain);
        const lineMainPos = lineFromTargetIdx(cast.childMainBounds, targetIdx);
        const out: ReorderDelta = {
          kind: 'reorder',
          axis: cast.axis,
          sourceIdx: cast.sourceIdx,
          targetIdx,
          lineMainPos,
          crossStart: cast.crossStart,
          crossEnd: cast.crossEnd,
        };
        return out;
      }
      // gap-drag: 1:1 cursor-to-spacing on the main axis. Clamped
      // at 0 (negative spacing isn't meaningful). The dragged grip
      // visually lags the cursor (since the spacing applies across
      // all gaps and only a fraction of the cursor delta lands at
      // any particular gap), but the relationship between cursor
      // motion and spacing is intuitive and predictable.
      const mainDelta = cast.axis === 'v' ? dy : dx;
      const newSpacing = Math.max(0, Math.round(cast.originalSpacing + mainDelta));
      const out: GapDragDelta = { kind: 'gap-drag', newSpacing };
      return out;
    },

    applyGesture(params, delta) {
      // Framework passes the wrapped ShapeDelta. Layouts only care
      // about the opaque arm (no layout-translate or layout-
      // transform); other kinds are no-ops for params.
      const inner = unwrapStackDelta(delta);
      if (!inner) return params;
      if (inner.kind === 'gap-drag') {
        return { ...params, spacing: inner.newSpacing };
      }
      // Reorder uses the insertion-indicator UX: dragged child
      // stays in place. No params change.
      return params;
    },

    commit(ast, span, delta, slideIdx) {
      const inner = unwrapStackDelta(delta);
      if (!inner) return null;
      const layoutComp = findComponentAtSpan(ast, span.start, span.end);
      if (!layoutComp) return null;

      if (inner.kind === 'reorder') {
        const { sourceIdx, targetIdx } = inner;
        // No-op moves: targetIdx == sourceIdx (drop in original
        // spot) or sourceIdx + 1 (drop just after, which is also
        // original spot once the source-removal is accounted for).
        if (targetIdx === sourceIdx || targetIdx === sourceIdx + 1) {
          return null;
        }
        const childrenFill = layoutComp.fills.find((f) => f.name === 'children');
        if (!childrenFill || childrenFill.value.kind !== 'list') return null;
        const list = childrenFill.value as ListLit;
        if (
          sourceIdx < 0 ||
          sourceIdx >= list.items.length ||
          targetIdx < 0 ||
          targetIdx > list.items.length
        ) {
          return null;
        }
        reorderListItems(list, sourceIdx, targetIdx);
      } else if (inner.kind === 'gap-drag') {
        // Write the new spacing to the layout's `spacing` slot.
        // If the slot doesn't exist yet (component was using the
        // default), add a fresh slot fill carrying the new value.
        setOrAddNumericSlot(layoutComp, 'spacing', inner.newSpacing);
      } else {
        return null;
      }

      // Preserve selection on the parent layout (it stays selected
      // across the gesture's commit). When the layout is a direct
      // child of a Freeform, findShapeChildIdx returns its index
      // there so the round-trip can find it again post-emit.
      const childIdx = findShapeChildIdx(ast, slideIdx, span);
      return childIdx !== null
        ? { preserveSelection: { slideIdx, childIdx } }
        : {};
    },

    GestureOverlay({ delta }) {
      const cast = delta as StackDelta | null;
      if (!cast || cast.kind !== 'reorder') return null;
      // Don't render the indicator when the move would be a no-op
      // (sitting in or next to the source slot). Reduces visual
      // chatter at the user's starting position.
      if (cast.targetIdx === cast.sourceIdx || cast.targetIdx === cast.sourceIdx + 1) {
        return null;
      }
      // Insertion line — 6px thick along the main axis, full cross
      // span. The white box-shadow halo separates it visually from
      // the selection border, which often sits just outside the
      // boundary children at targetIdx 0 / N.
      const thickness = 6;
      const half = thickness / 2;
      const style: CSSProperties =
        cast.axis === 'v'
          ? {
              position: 'absolute',
              left: `${cast.crossStart}px`,
              top: `${cast.lineMainPos - half}px`,
              width: `${cast.crossEnd - cast.crossStart}px`,
              height: `${thickness}px`,
              background: 'rgba(0, 102, 255, 1)',
              pointerEvents: 'none',
              borderRadius: '3px',
              boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.95)',
            }
          : {
              position: 'absolute',
              left: `${cast.lineMainPos - half}px`,
              top: `${cast.crossStart}px`,
              width: `${thickness}px`,
              height: `${cast.crossEnd - cast.crossStart}px`,
              background: 'rgba(0, 102, 255, 1)',
              pointerEvents: 'none',
              borderRadius: '3px',
              boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.95)',
            };
      return createElement('div', {
        className: 'sw-reorder-indicator',
        style,
      });
    },
  };
}

// ─── Capture helpers ─────────────────────────────────────────────

function captureReorderInit(
  ctx: ChildDragContext,
  axis: Axis,
): ReorderInit | null {
  // Walk the parent's DOM to find the rendered flex container and
  // its children. parentEl is the loader's display:contents wrapper;
  // its first element child is the user-rendered VStack / HStack
  // root (the flex container).
  const flexEl = ctx.parentEl.firstElementChild;
  if (!(flexEl instanceof HTMLElement)) return null;

  // Determine the cursor's main-axis position at gesture start, in
  // design-space relative to the freeform's positioned div. We
  // capture pointerMainStart in the SAME frame as childMainBounds
  // so combineGestureState's `pointerMainStart + dx/dy` arithmetic
  // works out (dx/dy are design-space deltas from gesture start).
  //
  // freeformInner = the positioned div SelectionLayer / overlays
  // portal into. It's the active Freeform's first element child.
  const freeformInner = findFreeformInner(flexEl);
  if (!freeformInner) return null;
  const freeformRect = freeformInner.getBoundingClientRect();

  const childEls: HTMLElement[] = [];
  // Each direct child of flexEl is the loader's display:contents
  // wrapper for one component invocation. The visible flex item is
  // the wrapper's first element child — measure that for bounds.
  for (const wrapper of Array.from(flexEl.children)) {
    if (!(wrapper instanceof HTMLElement)) continue;
    const inner = wrapper.firstElementChild;
    if (inner instanceof HTMLElement) childEls.push(inner);
  }
  if (childEls.length === 0) return null;

  // Find the dragged child's index — which wrapper has the matching
  // span attrs. We compare against the child SOURCE span passed in
  // (the AST node), which the loader stamps onto the wrapper.
  let sourceIdx = -1;
  const wrappers = Array.from(flexEl.children).filter(
    (n): n is HTMLElement => n instanceof HTMLElement,
  );
  for (let i = 0; i < wrappers.length; i++) {
    const w = wrappers[i]!;
    const start = parseInt(w.getAttribute('data-sw-span-start') ?? '', 10);
    const end = parseInt(w.getAttribute('data-sw-span-end') ?? '', 10);
    if (start === ctx.childSpan.start && end === ctx.childSpan.end) {
      sourceIdx = i;
      break;
    }
  }
  if (sourceIdx === -1) return null;

  // Capture each child's main-axis range in design-space, freeform-
  // relative coords (matching SelectionLayer's portal frame).
  const childMainBounds = childEls.map((el) => {
    const rect = el.getBoundingClientRect();
    if (axis === 'v') {
      return {
        start: (rect.top - freeformRect.top) / ctx.scale,
        end: (rect.bottom - freeformRect.top) / ctx.scale,
      };
    }
    return {
      start: (rect.left - freeformRect.left) / ctx.scale,
      end: (rect.right - freeformRect.left) / ctx.scale,
    };
  });

  // Cross-axis range = the parent layout's own bounds, so the
  // insertion line spans the full width / height of the layout.
  const flexRect = flexEl.getBoundingClientRect();
  const crossStart =
    axis === 'v'
      ? (flexRect.left - freeformRect.left) / ctx.scale
      : (flexRect.top - freeformRect.top) / ctx.scale;
  const crossEnd =
    axis === 'v'
      ? (flexRect.right - freeformRect.left) / ctx.scale
      : (flexRect.bottom - freeformRect.top) / ctx.scale;

  const pointerMainStart =
    axis === 'v'
      ? (ctx.event.clientY - freeformRect.top) / ctx.scale
      : (ctx.event.clientX - freeformRect.left) / ctx.scale;

  const init: ReorderInit = {
    kind: 'reorder',
    axis,
    sourceIdx,
    childMainBounds,
    crossStart,
    crossEnd,
    pointerMainStart,
  };
  return init;
}

// Walk up from any element inside a Freeform to find the
// Freeform's first-element-child (the positioned div used as the
// portal target). Returns null if there's no Freeform ancestor.
function findFreeformInner(el: Element): HTMLElement | null {
  const freeform = el.closest('[data-sw-component="Freeform"]');
  const inner = freeform?.firstElementChild;
  return inner instanceof HTMLElement ? inner : null;
}

// ─── Wrapping / unwrapping ───────────────────────────────────────

// Framework passes a wrapped ShapeDelta to applyGesture / commit:
// `{ kind: 'translate' | 'transform' | 'opaque', ... }`. Layout-
// bespoke gestures arrive in the `opaque` arm. Returns the inner
// StackDelta if the wrap is opaque + the inner is one of ours;
// null otherwise (no-op for non-layout kinds).
function unwrapStackDelta(delta: unknown): StackDelta | null {
  if (typeof delta !== 'object' || delta === null) return null;
  const wrap = delta as { kind?: unknown; delta?: unknown };
  if (wrap.kind !== 'opaque') return null;
  const inner = wrap.delta;
  if (typeof inner !== 'object' || inner === null) return null;
  const cast = inner as StackDelta;
  if (cast.kind === 'reorder' || cast.kind === 'gap-drag') return cast;
  return null;
}

// ─── Per-frame hit-testing ───────────────────────────────────────

// Cursor's main-axis position → which gap should the insertion
// indicator land in. N children → N+1 possible target indices
// (before child 0, between children, after child N-1).
function targetIndexFromCursor(
  childMainBounds: ReadonlyArray<{ start: number; end: number }>,
  cursorMain: number,
): number {
  for (let i = 0; i < childMainBounds.length; i++) {
    const child = childMainBounds[i]!;
    const mid = (child.start + child.end) / 2;
    if (cursorMain < mid) return i;
  }
  return childMainBounds.length;
}

// Position of the insertion line for a given target index. Lines
// sit in the gap between adjacent children; for the boundary
// indices (0 and N), they pin to the start / end of the first /
// last child.
function lineFromTargetIdx(
  childMainBounds: ReadonlyArray<{ start: number; end: number }>,
  targetIdx: number,
): number {
  if (childMainBounds.length === 0) return 0;
  if (targetIdx === 0) return childMainBounds[0]!.start;
  if (targetIdx >= childMainBounds.length) {
    return childMainBounds[childMainBounds.length - 1]!.end;
  }
  const before = childMainBounds[targetIdx - 1]!;
  const after = childMainBounds[targetIdx]!;
  return (before.end + after.start) / 2;
}

// ─── List mutation ───────────────────────────────────────────────

function reorderListItems(
  list: ListLit,
  sourceIdx: number,
  targetIdx: number,
): void {
  const items = list.items;
  const [moved] = items.splice(sourceIdx, 1);
  if (!moved) return;
  // Adjust target index for the removal: if we removed before the
  // target slot, every subsequent index shifted left by one.
  const insertAt = targetIdx > sourceIdx ? targetIdx - 1 : targetIdx;
  items.splice(insertAt, 0, moved);
}

// ─── Param mutation ──────────────────────────────────────────────

const ZERO_SPAN: Span = {
  start: { offset: 0, line: 0, column: 0 },
  end: { offset: 0, line: 0, column: 0 },
};

// Set or add a numeric-valued slot fill on a component. If the
// slot already exists with a numeric value, mutate it in place.
// Otherwise (slot missing OR slot has non-number value), append a
// fresh slot fill with the new value. Used by gap-drag to write
// `spacing` even when the source uses the default and there's no
// slot fill yet.
function setOrAddNumericSlot(
  comp: Component,
  name: string,
  value: number,
): void {
  const existing = findNumericSlot(comp, name);
  if (existing) {
    existing.node.value = value;
    return;
  }
  const numLit: NumberLit = { kind: 'number', value, span: ZERO_SPAN };
  const fill: { kind: 'slot_fill'; name: string; value: Value; span: Span } = {
    kind: 'slot_fill',
    name,
    value: numLit,
    span: ZERO_SPAN,
  };
  comp.fills.push(fill);
}

// ─── Gap-drag grips (Handles component) ──────────────────────────
//
// Rendered inside SelectionLayer when the layout is selected. Each
// gap between adjacent children gets one grip — a small visual
// bar centered in the gap, pointer-active for grabbing. Pointerdown
// on a grip emits an opaque init that captures the layout's
// current `spacing`; combineGestureState derives the new spacing
// per frame from the cursor delta.
//
// The grips are DOM-measured (children's positions depend on flex
// layout, not on params alone). Measurement is deferred to a
// useLayoutEffect so the read sees post-commit DOM after each
// re-render — the same timing pattern the layout-bounds measurement
// uses (avoid stale measurements after source-driven layout
// changes).

interface GripPosition {
  // Grip's center in design-space, freeform-relative coords.
  centerMain: number;
  crossStart: number;
  crossEnd: number;
}

function GapDragHandles(
  props: HandlesProps & { axis: Axis },
): ReactElement | null {
  const { params, span, startGesture, axis } = props;
  const grips = useMeasuredGripPositions(span, axis);
  const originalSpacing = numberParam(params, 'spacing', 24);

  if (grips.length === 0) return null;

  return createElement(
    'div',
    { style: { display: 'contents' } },
    grips.map((grip, i) => {
      const init: GapDragInit = {
        kind: 'gap-drag',
        axis,
        originalSpacing,
      };
      const style: CSSProperties =
        axis === 'v'
          ? {
              position: 'absolute',
              left: `${(grip.crossStart + grip.crossEnd) / 2 - 18}px`,
              top: `${grip.centerMain - 3}px`,
              width: '36px',
              height: '6px',
              background: 'rgba(0, 102, 255, 0.85)',
              borderRadius: '3px',
              cursor: 'ns-resize',
              pointerEvents: 'auto',
            }
          : {
              position: 'absolute',
              left: `${grip.centerMain - 3}px`,
              top: `${(grip.crossStart + grip.crossEnd) / 2 - 18}px`,
              width: '6px',
              height: '36px',
              background: 'rgba(0, 102, 255, 0.85)',
              borderRadius: '3px',
              cursor: 'ew-resize',
              pointerEvents: 'auto',
            };
      return createElement('div', {
        key: `grip-${i}`,
        className: 'sw-gap-grip',
        style,
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          startGesture(
            {
              kind: 'opaque',
              span,
              init,
              cursor: axis === 'v' ? 'ns-resize' : 'ew-resize',
            },
            event.nativeEvent,
          );
        },
      });
    }),
  );
}

function numberParam(
  params: Record<string, unknown>,
  name: string,
  fallback: number,
): number {
  const v = params[name];
  return typeof v === 'number' ? v : fallback;
}

// Measure each gap's position in design-space, freeform-relative
// coords. Re-runs after every render so the grips track live param
// changes (e.g., during the gap-drag gesture itself, the dragged
// grip's position recomputes as `spacing` updates and the children
// reflow).
function useMeasuredGripPositions(
  span: ShapeSpan,
  axis: Axis,
): GripPosition[] {
  const [grips, setGrips] = useState<GripPosition[]>([]);
  useLayoutEffect(() => {
    const wrapper = document.querySelector(
      `.sw-canvas-stage [data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"]`,
    );
    if (!(wrapper instanceof HTMLElement)) {
      setGrips([]);
      return;
    }
    const flexEl = wrapper.firstElementChild;
    if (!(flexEl instanceof HTMLElement)) {
      setGrips([]);
      return;
    }
    const freeform = wrapper.closest('[data-sw-component="Freeform"]');
    const freeformInner = freeform?.firstElementChild;
    if (!(freeformInner instanceof HTMLElement)) {
      setGrips([]);
      return;
    }
    const canvas = document.querySelector(
      '.sw-canvas-stage .presentation-canvas',
    );
    if (!(canvas instanceof HTMLElement)) {
      setGrips([]);
      return;
    }
    const scale = canvas.getBoundingClientRect().width / 1920;
    if (!Number.isFinite(scale) || scale <= 0) {
      setGrips([]);
      return;
    }
    const freeformRect = freeformInner.getBoundingClientRect();
    const childInners: HTMLElement[] = [];
    for (const w of Array.from(flexEl.children)) {
      if (!(w instanceof HTMLElement)) continue;
      const inner = w.firstElementChild;
      if (inner instanceof HTMLElement) childInners.push(inner);
    }
    if (childInners.length < 2) {
      setGrips([]);
      return;
    }
    const flexRect = flexEl.getBoundingClientRect();
    const crossStart =
      axis === 'v'
        ? (flexRect.left - freeformRect.left) / scale
        : (flexRect.top - freeformRect.top) / scale;
    const crossEnd =
      axis === 'v'
        ? (flexRect.right - freeformRect.left) / scale
        : (flexRect.bottom - freeformRect.top) / scale;
    const next: GripPosition[] = [];
    for (let i = 0; i < childInners.length - 1; i++) {
      const a = childInners[i]!.getBoundingClientRect();
      const b = childInners[i + 1]!.getBoundingClientRect();
      const aEnd = axis === 'v' ? a.bottom : a.right;
      const bStart = axis === 'v' ? b.top : b.left;
      const refOrigin = axis === 'v' ? freeformRect.top : freeformRect.left;
      const centerMain = ((aEnd + bStart) / 2 - refOrigin) / scale;
      next.push({ centerMain, crossStart, crossEnd });
    }
    setGrips((prev) => (gripsEqual(prev, next) ? prev : next));
  });
  return grips;
}

function gripsEqual(a: GripPosition[], b: GripPosition[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (
      ai.centerMain !== bi.centerMain ||
      ai.crossStart !== bi.crossStart ||
      ai.crossEnd !== bi.crossEnd
    ) {
      return false;
    }
  }
  return true;
}
