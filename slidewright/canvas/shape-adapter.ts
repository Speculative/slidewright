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
// Gesture-kind taxonomy:
//
//   - **Translate** (`{ kind: 'translate', dx, dy }`) — universal.
//     Body drag and group body drag dispatch the same translate
//     delta to every selected shape.
//   - **Transform** (`{ kind: 'transform', sx, sy, tx, ty }`) —
//     universal axis-aligned 2D affine. Group resize derives one
//     transform per frame from the captured group bbox + cursor
//     delta and dispatches it to every member. Rotation extends the
//     payload to a 2x3 matrix when it lands.
//   - **Opaque** (`{ kind: 'opaque', delta: unknown }`) — per-
//     adapter bespoke gesture. The framework plumbs `unknown`
//     through; the adapter casts to its own internal delta type.
//     Box / TextBox use this for box-resize; Arrow uses it for
//     endpoint moves; future adapters (bezier control points,
//     etc.) carry their own typed deltas behind the same opaque
//     channel.
//
// Adapter responsibilities:
//   - `applyGesture(params, delta)` — pure function. Given the
//     shape's source-driven params and a per-shape ShapeDelta from
//     the framework, return new params that include the gesture's
//     effect. Adapters dispatch on `delta.kind`; for the `opaque`
//     arm they cast `delta.delta` to their internal type.
//   - `calculateBounds(params)` — pure function. Compute the
//     shape's selection-bounds rectangle from its params. Used by
//     framework's selection-outline / group-bbox renderers (which
//     are now React components, not DOM-walking effects).
//   - `Handles` — React component. Renders the shape's selection
//     handles (Box / TextBox: 8 corner / edge resize handles;
//     Arrow: 2 endpoint grips). Each handle's pointerdown calls
//     the framework's `startGesture` callback with an opaque
//     HandleGestureInit blob carrying the adapter's internal init
//     payload. The framework hands the payload back to the same
//     adapter's `buildGestureState`.
//   - `buildGestureState(init)` / `combineGestureState(state, dx,
//     dy)` — opaque-delta plumbing for the adapter's own bespoke
//     gestures. `buildGestureState` runs once at gesture start
//     and captures whatever the adapter wants to remember for the
//     gesture's duration (e.g., source rect, original endpoint).
//     `combineGestureState` runs per pointermove and combines that
//     captured state with the live cursor delta to produce the
//     per-frame opaque delta. The framework treats both as
//     `unknown`; only the adapter knows their internal shape.
//   - `commit(ast, span, finalDelta, slideIdx)` — mutate the AST
//     given the final ShapeDelta. Returns optional preserveSelection
//     so the host round-trip restores selection on the post-emit
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
// During a gesture, the framework computes a per-shape ShapeDelta
// and passes it (via React context) to each affected shape's
// ShapeProjection wrapper. The wrapper calls
// `adapter.applyGesture(params, delta)` and renders the shape with
// the result.
//
// Two kinds are framework-known universals (translate, transform);
// everything else flows through `opaque`, where the adapter owns
// the payload type internally.

// Translate the shape by (dx, dy) in design space. Body drag for
// a single shape and group body drag both produce this — for
// group drag, every selected shape gets the same translate
// delta.
export interface TranslateDelta {
  kind: 'translate';
  dx: number;
  dy: number;
}

// Generic axis-aligned 2D transform: x' = sx*x + tx, y' = sy*y + ty.
// Width / height of axis-aligned shapes scale by sx / sy. Used by
// group resize today; rotation generalizes the payload to a 2x3
// matrix when it lands.
export interface TransformDelta {
  kind: 'transform';
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

// Adapter-bespoke gesture. The framework treats `delta` as opaque
// — it's whatever shape the adapter's `combineGestureState` returns,
// and the adapter's `applyGesture` / `commit` know how to cast it.
export interface OpaqueDelta {
  kind: 'opaque';
  delta: unknown;
}

export type ShapeDelta = TranslateDelta | TransformDelta | OpaqueDelta;

// ─── Handles component contract ──────────────────────────────────

// Callback an adapter's Handles component invokes when one of its
// handles initiates a gesture. The framework owns the rest of the
// gesture lifecycle (pointermove / pointerup, source commit).
//
// Two init kinds: framework-known `group-resize` (emitted by the
// group-handle layer in SelectionLayer, not by per-shape adapters)
// and adapter-emitted `opaque` carrying the shape's span plus the
// adapter's internal init payload (which the framework hands back
// to `adapter.buildGestureState`).
export type StartGesture = (
  init: HandleGestureInit,
  event: PointerEvent,
) => void;

export type HandleGestureInit =
  | {
      // Group resize. Captured at gesture-start: the union bbox of
      // every selected shape and which corner / edge the user
      // grabbed. The framework derives a transform per frame from
      // this + pointer delta and dispatches the same transform to
      // every member.
      kind: 'group-resize';
      direction: BoxResizeDirection;
      originalBox: { x: number; y: number; width: number; height: number };
      // Spans of the shapes participating. The framework uses this
      // to seed per-shape templates without re-deriving membership.
      members: ReadonlyArray<{ start: number; end: number }>;
    }
  | {
      // Per-adapter bespoke gesture. The Handles component carries
      // its shape's span plus an internal init payload (e.g.,
      // `{ kind: 'box-resize', direction, original }` or
      // `{ kind: 'arrow-endpoint', endpoint, originalX, originalY,
      // fixedX, fixedY }`). The framework looks up the adapter via
      // the span and calls adapter.buildGestureState(init).
      //
      // Optional `cursor` lets the adapter request a CSS cursor
      // (e.g., 'ns-resize' for gap-drag) that the framework pins
      // on document.body for the gesture's duration. The grip's own
      // CSS cursor only applies while the cursor is over the grip
      // — once the gesture starts, the cursor floats free of the
      // grip and would otherwise revert to default.
      kind: 'opaque';
      span: ShapeSpan;
      init: unknown;
      cursor?: string;
    };

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
  // (e.g., translate on a future flow-laid shape, or an opaque
  // delta for a different adapter's gesture), return params
  // unchanged. Pure; called every render during an active gesture.
  applyGesture(
    params: Record<string, unknown>,
    delta: ShapeDelta,
  ): Record<string, unknown>;

  // ─── Opaque-delta plumbing for adapter-bespoke gestures ────────
  //
  // When an adapter's Handles emits `{ kind: 'opaque', span, init
  // }`, the framework calls `adapter.buildGestureState(init)` to
  // capture stable per-gesture state, and
  // `adapter.combineGestureState(state, dx, dy)` per pointermove
  // to derive the per-frame opaque delta (which the framework then
  // wraps as `{ kind: 'opaque', delta: ... }` and feeds to
  // applyGesture / commit).
  //
  // Both signatures are `unknown` because the framework never
  // inspects the contents — only the adapter does. Adapters that
  // emit no opaque inits can return null / no-op from these.

  // Convert a Handles-emitted init to a stable per-gesture state
  // captured at gesture-start. The captured state is immutable for
  // the gesture's duration; per-frame deltas come from
  // `combineGestureState`.
  buildGestureState(init: unknown): unknown;

  // Per-frame: combine the captured gesture state with the cursor
  // delta (in design-space pixels) to produce an opaque delta.
  // Returned value flows to `applyGesture` (rendering) and at
  // gesture-end to `commit`.
  combineGestureState(
    state: unknown,
    dx: number,
    dy: number,
  ): unknown;

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
