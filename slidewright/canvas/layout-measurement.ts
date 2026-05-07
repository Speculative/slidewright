// ResizeObserver-driven layout measurement.
//
// Layouts (HStack, VStack, future Grid) are flow-laid by their
// parent — params don't determine bounds. The framework has to
// DOM-measure them. This module is the single primitive every
// consumer goes through; per-consumer `useLayoutEffect` + setState
// pattern is gone.
//
// Replaces the v0.4 ad-hoc measurement helpers (`measureLayoutBounds`
// in selection-layer, `useMeasuredGripPositions` in stack-adapter,
// the inline DOM walks in `captureReorderInit`). Each of those had
// independent reactivity bugs from the same root — timing of the
// DOM read, missing deps that prevented re-measurement during
// gestures, early-return paths creating new identities and looping.
// The fix is structural: subscribe to layout shifts via
// ResizeObserver once, push updates into React state with an
// equality bailout, consumers pull from state.
//
// API:
//   - `measureLayoutSnapshot(span)` — one-shot imperative read,
//     usable from non-render contexts (e.g., gesture-start handlers).
//     Returns null if any required element is missing.
//   - `useLayoutMeasurement(span)` — reactive hook. Subscribes to
//     the layout, reference frame, canvas (scale), and each child
//     via ResizeObserver. Re-measures on any size change and on
//     mount; returns the latest snapshot.
//
// Snapshot fields: see `LayoutSnapshot` below.

import { useEffect, useState } from 'react';

import { findPortalAncestor } from './portal-target.js';
import type { Bounds, ShapeSpan } from './shape-adapter.js';

const DESIGN_W = 1920;

export interface LayoutSnapshot {
  // The layout's flex container element — `wrapper.firstElementChild`.
  // The wrapper itself is `display: contents` (loader convention) so
  // its `getBoundingClientRect` is empty; the flex container is the
  // first element with a meaningful box.
  layoutEl: HTMLElement;
  // Portal target — the same positioned ancestor selection visuals
  // and gesture overlays portal into. Bounds below are in design-
  // space coords relative to this element.
  referenceFrame: HTMLElement;
  // CSS-pixel → design-pixel ratio (e.g., 0.5 means design pixels
  // are half-size on screen). Recomputed each measurement so window-
  // resize / scale changes get picked up.
  scale: number;
  // Layout's own bounds (design-space, reference-frame-relative).
  layout: Bounds;
  // Each direct child's bounds (design-space, reference-frame-
  // relative). Order matches `Array.from(layoutEl.children)`.
  children: Bounds[];
  // Reference frame's screen-coord origin. Consumers that need to
  // convert client-coords (event.clientX/Y) to design-space at
  // gesture-start use these.
  referenceClientLeft: number;
  referenceClientTop: number;
}

// One-shot read. Returns null when any required element is missing
// (e.g., wrapper not in DOM, no canvas mounted).
export function measureLayoutSnapshot(
  span: ShapeSpan,
): LayoutSnapshot | null {
  const wrapper = document.querySelector(
    `.sw-canvas-stage [data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"]`,
  );
  if (!(wrapper instanceof HTMLElement)) return null;
  const layoutEl = wrapper.firstElementChild;
  if (!(layoutEl instanceof HTMLElement)) return null;
  const referenceFrame = findPortalAncestor(wrapper);
  if (!referenceFrame) return null;
  const canvas = document.querySelector(
    '.sw-canvas-stage .presentation-canvas',
  );
  if (!(canvas instanceof HTMLElement)) return null;
  const scale = canvas.getBoundingClientRect().width / DESIGN_W;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const refRect = referenceFrame.getBoundingClientRect();
  const layoutRect = layoutEl.getBoundingClientRect();
  const layout: Bounds = {
    left: (layoutRect.left - refRect.left) / scale,
    top: (layoutRect.top - refRect.top) / scale,
    width: layoutRect.width / scale,
    height: layoutRect.height / scale,
  };

  // Children may be wrapped by a slot wrapper (data-sw-slot-name)
  // between the flex container and the actual component wrappers
  // — slot instrumentation adds one such layer for list slots.
  // Walk through it to find the component wrappers that are the
  // visual flex items.
  const childWrappers = flexChildWrappers(layoutEl);
  const children: Bounds[] = [];
  for (const w of childWrappers) {
    const inner = w.firstElementChild;
    if (!(inner instanceof HTMLElement)) continue;
    const r = inner.getBoundingClientRect();
    children.push({
      left: (r.left - refRect.left) / scale,
      top: (r.top - refRect.top) / scale,
      width: r.width / scale,
      height: r.height / scale,
    });
  }

  return {
    layoutEl,
    referenceFrame,
    scale,
    layout,
    children,
    referenceClientLeft: refRect.left,
    referenceClientTop: refRect.top,
  };
}

// Reactive hook. ResizeObserver-driven; re-measures on any observed
// size change. Returns null until first measurement succeeds (e.g.,
// while elements aren't yet mounted).
export function useLayoutMeasurement(
  span: ShapeSpan,
): LayoutSnapshot | null {
  const [snapshot, setSnapshot] = useState<LayoutSnapshot | null>(null);

  useEffect(() => {
    const remeasure = (): void => {
      const next = measureLayoutSnapshot(span);
      setSnapshot((prev) => (snapshotsEqual(prev, next) ? prev : next));
    };
    remeasure();

    // Subscribe to layout, reference frame, canvas (for scale
    // changes), and each rendered child. ResizeObserver fires on
    // size changes; re-measure picks up positions too (children's
    // positions can shift via flex `gap` updates that change the
    // layout element's size, which fires the observer on layoutEl).
    const wrapper = document.querySelector(
      `.sw-canvas-stage [data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"]`,
    );
    if (!wrapper) return;
    const layoutEl = wrapper.firstElementChild;
    if (!(layoutEl instanceof HTMLElement)) return;
    const referenceFrame = findPortalAncestor(wrapper);
    if (!referenceFrame) return;
    const canvas = document.querySelector(
      '.sw-canvas-stage .presentation-canvas',
    );
    if (!(canvas instanceof HTMLElement)) return;

    const observer = new ResizeObserver(remeasure);
    observer.observe(layoutEl);
    observer.observe(referenceFrame);
    observer.observe(canvas);
    for (const w of Array.from(layoutEl.children)) {
      if (!(w instanceof HTMLElement)) continue;
      const inner = w.firstElementChild;
      if (inner instanceof HTMLElement) observer.observe(inner);
    }
    return () => observer.disconnect();
  }, [span.start, span.end]);

  return snapshot;
}

// Walk past slot wrappers (data-sw-slot-name) between the flex
// container and its visual children. With slot instrumentation,
// the children-slot for HStack/VStack adds one layer of slot
// wrapper between the user's flex div and the per-child component
// wrappers. The slot wrapper is `display: contents` so flex still
// treats the actual component wrappers as flex items, but DOM-wise
// `flexEl.children` is just the slot wrapper. This helper returns
// the component-wrapper-level children.
export function flexChildWrappers(flexEl: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of Array.from(flexEl.children)) {
    if (!(child instanceof HTMLElement)) continue;
    // If this is a slot wrapper, descend into it.
    if (child.hasAttribute('data-sw-slot-name')) {
      for (const inner of Array.from(child.children)) {
        if (inner instanceof HTMLElement) out.push(inner);
      }
    } else {
      out.push(child);
    }
  }
  return out;
}

function snapshotsEqual(
  a: LayoutSnapshot | null,
  b: LayoutSnapshot | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.layoutEl !== b.layoutEl) return false;
  if (a.referenceFrame !== b.referenceFrame) return false;
  if (a.scale !== b.scale) return false;
  if (!boundsEqual(a.layout, b.layout)) return false;
  if (a.children.length !== b.children.length) return false;
  for (let i = 0; i < a.children.length; i++) {
    if (!boundsEqual(a.children[i]!, b.children[i]!)) return false;
  }
  if (a.referenceClientLeft !== b.referenceClientLeft) return false;
  if (a.referenceClientTop !== b.referenceClientTop) return false;
  return true;
}

function boundsEqual(a: Bounds, b: Bounds): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}
