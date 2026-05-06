// Slidewright canvas — shape adapter contract.
//
// Each shape primitive that participates in canvas gestures (drag,
// resize, etc.) declares a ShapeAdapter alongside its component
// definition. The component's file exports both `slidewright`
// (runtime metadata: slot types, params) and `canvas` (this
// interface: how the shape behaves under direct manipulation).
//
// The architecture is React-native: gesture state lives in App's
// React state, the loader wraps each shape with a ShapeProjection
// that consumes gesture context, and the adapter's `applyGesture`
// declaratively transforms params → adjusted-params for the
// in-progress gesture. No imperative DOM mutation during drag —
// React re-renders shapes (and selection visuals, handles, group
// bbox) every frame as gesture state advances.
//
// Adapter responsibilities:
//   - `applyGesture(params, delta)` — pure function. Given the
//     shape's source-driven params and a per-shape delta supplied
//     by the framework, return new params that include the
//     gesture's effect. Deltas are typed by gesture kind; the
//     adapter handles only the kinds that apply to its shape and
//     returns params unchanged for the rest.
//   - `calculateBounds(params)` — pure function. Compute the
//     shape's selection-bounds rectangle from its params. Used by
//     framework's selection-outline / group-bbox renderers (which
//     are now React components, not DOM-walking effects).
//   - `Handles` — React component. Renders the shape's selection
//     handles (Box / TextBox: 8 corner / edge resize handles;
//     Arrow: 2 endpoint grips). Each handle's pointerdown calls
//     the framework's `startGesture` callback with a typed gesture
//     descriptor. Returns null when handles aren't applicable.
//   - `commit(ast, span, finalDelta)` — mutate the AST given the
//     final gesture delta. Returns optional preserveSelection so
//     the host round-trip restores selection on the post-emit
//     source.

import type { SourceFile } from '../runtime/ast.js';
import type { ReactElement } from 'react';
import type { PreserveSelection } from './ast-edits.js';

// Selection-outline rectangle in the shape's parent's coordinate
// system (today: Freeform-relative design pixels).
export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Source span identifying the shape's AST node.
export interface ShapeSpan {
  start: number;
  end: number;
}

// Resize handle direction for box-style 8-handle resize.
export type BoxResizeDirection =
  | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// ─── Per-shape gesture deltas ────────────────────────────────────
//
// During a gesture, the framework computes a per-shape delta and
// passes it (via React context) to each affected shape's
// ShapeProjection wrapper. The wrapper calls
// `adapter.applyGesture(params, delta)` and renders the shape with
// the result. Deltas are typed so adapters can pattern-match:

// Translate the shape by (dx, dy) in design space. Body drag for
// a single shape and group body drag both produce this — for
// group drag, every selected shape gets the same translate
// delta.
export interface TranslateDelta {
  kind: 'translate';
  dx: number;
  dy: number;
}

// Box-style corner / edge resize. The opposite edges stay fixed;
// the named direction's edges move by (dx, dy). `original` is
// captured at gesture-start so commit can mutate slot fills off a
// stable starting box rather than reading from already-mutated
// in-progress state.
export interface BoxResizeDelta {
  kind: 'box-resize';
  direction: BoxResizeDirection;
  original: { x: number; y: number; width: number; height: number };
  dx: number;
  dy: number;
}

// Arrow endpoint move — drag one of the two endpoints; the other
// stays fixed. `endpoint` is 1 (tail / x1, y1) or 2 (tip /
// x2, y2). `originalX` / `originalY` are the moving endpoint's
// position at gesture-start; `fixedX` / `fixedY` are the other
// endpoint (stays put). Adapter computes new endpoint coords from
// (original + dx, original + dy).
export interface ArrowEndpointDelta {
  kind: 'arrow-endpoint';
  endpoint: 1 | 2;
  originalX: number;
  originalY: number;
  fixedX: number;
  fixedY: number;
  dx: number;
  dy: number;
}

export type ShapeDelta = TranslateDelta | BoxResizeDelta | ArrowEndpointDelta;

// ─── Handles component contract ──────────────────────────────────

// Callback an adapter's Handles component invokes when one of its
// handles initiates a gesture. The framework owns the rest of the
// gesture lifecycle (pointermove / pointerup, source commit).
//
// `kind` distinguishes box-resize from arrow-endpoint. The
// `original` shape captures values needed at gesture commit time
// (the framework forwards these to adapter.commit via the gesture
// state).
export type StartGesture = (
  init: HandleGestureInit,
  event: PointerEvent,
) => void;

export type HandleGestureInit =
  | { kind: 'box-resize'; direction: BoxResizeDirection; original: { x: number; y: number; width: number; height: number } }
  | { kind: 'arrow-endpoint'; endpoint: 1 | 2; originalX: number; originalY: number; fixedX: number; fixedY: number };

export interface HandlesProps {
  // Shape's CURRENT params (gesture-adjusted if applicable, so
  // handles position themselves correctly during a resize gesture
  // — they track the live preview by virtue of reading the same
  // adjusted params the shape uses).
  params: Record<string, unknown>;
  span: ShapeSpan;
  startGesture: StartGesture;
}

// ─── Adapter contract ────────────────────────────────────────────

export interface ShapeAdapter {
  // Compute the selection-outline bounds from the shape's params
  // (gesture-adjusted if applicable). Used by selection
  // rendering. Returns null if the shape doesn't have a meaningful
  // bounding box (shouldn't happen for current shapes).
  calculateBounds(params: Record<string, unknown>): Bounds | null;

  // Apply a per-shape gesture delta to the shape's params.
  // Returns adjusted params. For deltas the shape doesn't recognize
  // (e.g., box-resize on Arrow), return params unchanged. Pure;
  // called every render during an active gesture.
  applyGesture(
    params: Record<string, unknown>,
    delta: ShapeDelta,
  ): Record<string, unknown>;

  // React component rendering the shape's selection handles. Null
  // when no handles apply (e.g., during multi-select). Mounted by
  // the framework inside the Freeform's positioned div.
  Handles: (props: HandlesProps) => ReactElement | null;

  // Mutate the AST in place to commit the gesture's final state.
  // Returns optional preserveSelection for post-emit selection
  // restoration; null aborts the commit.
  commit(
    ast: SourceFile,
    span: ShapeSpan,
    delta: ShapeDelta,
    slideIdx: number,
  ): { preserveSelection?: PreserveSelection } | null;
}
