// LayoutAdapter — canvas-side contract for layout components.
//
// Layouts (HStack, VStack, future Grid / ZStack) participate in the
// canvas as selectable + inspectable components. Their position and
// bounds are determined by parent flow — not by params alone — so
// they can't satisfy `ShapeAdapter.calculateBounds(params)`. The
// `kind: 'layout'` discriminator gets them into the loader's shapes
// registry alongside ShapeAdapter entries; consumers branch on
// `kind` at the use site (selection-layer DOM-measures their bounds
// rather than calling calculateBounds).
//
// All gesture-related methods are **optional** so a layout adapter
// can be just `{ kind: 'layout' }` for selection + inspector only
// (the v0.4 tight cut). Adapters opt into reorder / gap-drag /
// future insertion gestures by implementing the relevant subset.
//
// ─── Gesture model ───────────────────────────────────────────────
//
// Layouts have two distinct entry points into the gesture system:
//
//   1. `interceptChildDrag(childSpan, event)` — pointerdown on a
//      child of this layout. If the layout returns non-null, the
//      framework treats the result as an opaque init for a layout-
//      owned gesture (the parent's span carries the gesture, not the
//      child's). Reorder uses this: drag a child → the parent stack
//      handles the gesture. Returning null falls through to today's
//      body-drag dispatch.
//
//   2. `Handles` — selection-time grips rendered by the framework
//      when this layout is selected. Same pattern as ShapeAdapter's
//      Handles. Pointerdown on a grip emits `{ kind: 'opaque',
//      span, init }`. Gap-drag uses this: small grips between
//      children commit changes to `spacing`.
//
// Both routes feed the same opaque-delta channel:
//   buildGestureState(init) → combineGestureState(state, dx, dy)
//   per frame → applyGesture (live preview) → commit (mutate AST).
//
// `GestureOverlay` is an optional React component the framework
// mounts during an active gesture on this layout. It reads the
// per-frame delta from gesture context and renders ephemeral
// overlay visuals (e.g., the insertion line during reorder). Lives
// in the adapter (not the user-authored layout component) so host-
// agnostic rendering paths (presentation mode, SSR) stay free of
// canvas-only React.

import type { ComponentType } from 'react';

import type { SourceFile } from '../runtime/ast.js';
import type { PreserveSelection } from './ast-edits.js';
import type { HandlesProps, ShapeSpan } from './shape-adapter.js';

export interface LayoutAdapter {
  kind: 'layout';

  // ─── Optional gesture entry points ─────────────────────────────

  // Pointerdown on a child of this layout. Return a non-null opaque
  // init blob to take ownership of the drag (framework routes it
  // through this adapter's buildGestureState → combineGestureState
  // → applyGesture → commit). Return null to let the framework's
  // existing dispatch run (body-drag for shapes, etc.).
  interceptChildDrag?(
    childSpan: ShapeSpan,
    event: PointerEvent,
  ): unknown | null;

  // Selection-time handle grips (e.g., gap-drag grips between
  // children). Same contract as ShapeAdapter.Handles — pointerdown
  // emits `{ kind: 'opaque', span, init }` via startGesture.
  Handles?: ComponentType<HandlesProps>;

  // ─── Optional opaque-delta plumbing ────────────────────────────

  // Capture stable per-gesture state from a Handles-emitted init or
  // an interceptChildDrag init.
  buildGestureState?(init: unknown): unknown;

  // Per-frame: combine captured state with cursor delta to produce
  // the opaque delta for rendering and commit.
  combineGestureState?(
    state: unknown,
    dx: number,
    dy: number,
  ): unknown;

  // Live preview during a gesture. For gestures that change layout
  // params (e.g., gap-drag updating `spacing`), return adjusted
  // params. For gestures with no live param change (e.g., reorder
  // with insertion-indicator UX), return params unchanged.
  applyGesture?(
    params: Record<string, unknown>,
    delta: unknown,
  ): Record<string, unknown>;

  // Commit at gesture end. Mutates the AST in place. The span is
  // this layout's own span (not the dragged child's, even for
  // gestures that started via interceptChildDrag) — commits that
  // reorder children rewrite the layout's own children-list slot.
  commit?(
    ast: SourceFile,
    span: ShapeSpan,
    delta: unknown,
    slideIdx: number,
  ): { preserveSelection?: PreserveSelection } | null;

  // ─── Optional gesture overlay ──────────────────────────────────

  // React component mounted by the framework during an active
  // gesture on this layout. Reads the per-frame delta from gesture
  // context and renders ephemeral overlay visuals (insertion line
  // for reorder, drag affordance previews, etc.). Portaled into
  // the same target as selection visuals.
  GestureOverlay?: ComponentType<{ delta: unknown; span: ShapeSpan }>;
}

// Type guard. Use at any site that pulls `data.canvas` from the
// shapes registry to discriminate shape vs. layout entries.
export function isLayoutAdapter(canvas: unknown): canvas is LayoutAdapter {
  return (
    typeof canvas === 'object' &&
    canvas !== null &&
    (canvas as { kind?: unknown }).kind === 'layout'
  );
}
