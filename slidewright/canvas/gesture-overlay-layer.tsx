// GestureOverlayLayer — mounts each active gesture's
// LayoutAdapter.GestureOverlay during the gesture lifecycle.
//
// Symmetric with SelectionLayer: shares the same portal target via
// `portal-target.ts:useSelectionPortal` (closest Freeform's
// positioned div, falling back to the slide stage for layouts at
// slide-level), reads gesture state, renders the adapter-supplied
// overlay component. Each layout adapter that wants to draw
// ephemeral visuals during its gesture (insertion line for reorder,
// hover indicators, etc.) implements `GestureOverlay`; the framework
// mounts it here when a gesture on that adapter's span is active.
//
// Shapes don't use this — their selection-time visuals are
// `Handles` (mounted by SelectionLayer for the selected shape) and
// their gesture-time visuals come from re-rendering the shape with
// `applyGesture`-adjusted params (per ShapeProjection). Layouts
// have neither: they're flow-laid (no params-based bounds to re-
// render against) and their gestures often involve sibling-relative
// affordances (an insertion line between two children) that need
// their own overlay surface.

import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';

import type { ShapeData } from '../runtime/loader.js';

import { spanKey } from './gesture-context.js';
import type { SourceRange } from './host.js';
import { isLayoutAdapter } from './layout-adapter.js';
import { useSelectionPortal } from './portal-target.js';
import type { ShapeDelta } from './shape-adapter.js';

interface Props {
  // The set of spans an active gesture is operating on. Empty when
  // no gesture is in flight.
  activeSpans: ReadonlyArray<SourceRange>;
  shapes: ReadonlyMap<string, ShapeData>;
  gestureDeltas: ReadonlyMap<string, ShapeDelta>;
}

export function GestureOverlayLayer({
  activeSpans,
  shapes,
  gestureDeltas,
}: Props): ReactElement | null {
  const portalTarget = useSelectionPortal(activeSpans[0]);
  if (activeSpans.length === 0 || !portalTarget) return null;
  const overlays: ReactElement[] = [];
  for (const span of activeSpans) {
    const key = spanKey(span);
    const data = shapes.get(key);
    if (!data) continue;
    const canvas = data.canvas;
    if (!isLayoutAdapter(canvas)) continue;
    const Overlay = canvas.GestureOverlay;
    if (!Overlay) continue;
    const delta = gestureDeltas.get(key);
    // Only mount when there's an opaque per-frame delta — translate
    // / transform are framework-known kinds that don't go through
    // GestureOverlay.
    if (!delta || delta.kind !== 'opaque') continue;
    overlays.push(<Overlay key={key} delta={delta.delta} span={span} />);
  }
  if (overlays.length === 0) return null;
  return createPortal(<>{overlays}</>, portalTarget);
}
