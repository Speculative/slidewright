// Slidewright canvas — shape adapter contract.
//
// Each shape primitive that participates in canvas gestures (drag,
// resize, etc.) declares a ShapeAdapter alongside its component
// definition. The component's file exports both `slidewright`
// (runtime metadata: slot types, params) and `canvas` (this
// interface: how the shape behaves under direct manipulation).
//
// App.tsx is the dispatcher: when a pointerdown lands on a shape,
// App looks up the adapter by `data-sw-component` and plumbs the
// gesture lifecycle (pointermove / pointerup / commit pipeline)
// into the adapter's GestureHandle. The adapter owns its per-frame
// imperative DOM updates and its AST mutation on commit; the
// framework owns the listener lifecycle, gesture mutex, and
// source round-trip.
//
// Scope today: single-select shapes inside a Freeform. Multi-select
// (v0.2.j) and Card-style adapters outside Freeform (later) will
// extend this contract; the current shape is the floor that
// supports the v0.2 reference deck without losing existing
// behavior.

import type { SourceFile } from '../runtime/ast.js';
import type { PreserveSelection } from './ast-edits.js';

// Selection-outline rectangle in the shape's parent's coordinate
// system (today: Freeform-relative design pixels).
export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Source span identifying the shape's AST node. Carried through
// gesture context so onCommit can find the same component in a
// freshly parsed AST.
export interface ShapeSpan {
  start: number;
  end: number;
}

// A shape-specific gesture in progress. The framework calls these
// in response to pointermove / pointerup events; the adapter
// performs imperative DOM updates per frame and mutates the AST on
// commit.
//
// Both callbacks receive deltas in *design space* — the framework
// converts client-pixel deltas using the canvas's current scale
// before invoking the adapter, so adapters never have to think
// about CSS transforms.
export interface GestureHandle {
  // One pointermove. Update the rendered DOM (style.left / line
  // attrs / etc.) however this gesture defines visual feedback.
  onMove(designDx: number, designDy: number): void;
  // Pointerup. Mutate slot fills on the freshly parsed `ast` in
  // place. Return preserveSelection if the shape should remain
  // selected after the source round-trip; null to abort the
  // commit (e.g., target not found, gesture below threshold).
  onCommit(
    ast: SourceFile,
    designDx: number,
    designDy: number,
  ): { preserveSelection?: PreserveSelection } | null;
}

// Context passed to startBodyDrag.
export interface BodyDragContext {
  // The shape's rendered root — `firstElementChild` of the
  // data-sw-component wrapper (the wrapper itself is
  // `display: contents` and has no layout box). Box / TextBox:
  // a positioned div. Arrow: an SVG.
  visualNode: Element;
  // Returns the selection outline div if one exists. Lazy because
  // the React commit that mounts the overlay (selection effect)
  // may not have run by the time startBodyDrag is called —
  // clicking an unselected shape both selects and drags in the
  // same React batched update, but the selection effect runs
  // after pointerdown returns. Adapters call this inside onMove
  // each frame to get the current overlay (or null if selection
  // cleared mid-drag).
  getOverlay: () => HTMLElement | null;
  span: ShapeSpan;
  slideIdx: number;
}

// Context passed to renderHandles.
export interface HandleRenderContext {
  // Always present — renderHandles is only called for selected
  // shapes, and the selection outline mounts before handles.
  overlay: HTMLElement;
  visualNode: Element;
  span: ShapeSpan;
  slideIdx: number;
  // Read the current canvas scale (design pixels → CSS pixels).
  // Adapters call this when starting handle gestures to capture
  // a stable scale for the gesture's lifetime.
  getScale: () => number;
  // Called by the adapter's handle pointerdown handlers to start
  // a gesture. The framework owns the document.pointermove /
  // pointerup loop; the adapter just supplies the handle and the
  // pointerdown event (so the framework can capture clientX/Y as
  // the gesture's start position).
  startHandleDrag: (handle: GestureHandle, event: PointerEvent) => void;
}

// The full canvas-side contract for a shape. All three methods
// are mandatory today — if a future shape needs to opt out of one
// (e.g., Polyline that only supports endpoint handles, no body
// drag), we'll flip the relevant method to optional and special-
// case the absent path in the dispatcher. Until that need shows
// up, mandatory keeps the contract explicit.
export interface ShapeAdapter {
  // Compute the selection bounds for the dashed outline. Returns
  // design-space pixels in the shape's parent's coord system.
  bounds(visualNode: Element): Bounds | null;
  // Start a body-drag gesture. The framework calls this when
  // pointerdown lands on the shape body in select mode.
  startBodyDrag(ctx: BodyDragContext): GestureHandle;
  // Render the shape's selection handles when it becomes selected.
  // Adapter creates / appends DOM elements wherever it wants
  // (typically into ctx.overlay for handles around the bounding
  // rect, or into a freeform-level ancestor for handles at
  // arbitrary positions like Arrow endpoints). Returns a cleanup
  // function the framework runs when selection clears.
  renderHandles(ctx: HandleRenderContext): () => void;
}
