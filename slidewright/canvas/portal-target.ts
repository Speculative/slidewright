// Portal-target lookup for selection visuals + gesture overlays.
//
// Selection visuals (outlines, group bbox, handles) and gesture
// overlays (insertion lines, etc.) are absolutely positioned and
// portal into a single positioned ancestor. The choice of ancestor
// is the coord system everything inside the portal renders in.
//
// Two cases:
//   - **Inside a Freeform.** Shapes (Box / TextBox / Arrow with
//     `position: absolute` x/y/width/height in design space) and
//     layouts that live inside a Freeform get portaled into the
//     Freeform's positioned div. Coords are Freeform-relative;
//     `adapter.calculateBounds(params)` returns Freeform-relative
//     bounds directly; layout DOM measurements (against the same
//     portal target) are also Freeform-relative.
//   - **At slide-level (no Freeform ancestor).** A VStack / HStack
//     placed directly in a slide's body slot has no Freeform
//     ancestor. Portal into the slide stage (`.presentation-canvas`)
//     instead — `position: relative`, sized to the deck's design
//     dimensions. Layout measurements against the stage give
//     stage-relative bounds.
//
// The conditional fallback keeps existing Freeform-anchored paths
// identical (no shape changes; no layout-inside-Freeform changes)
// while extending support to layouts at slide-level. Cross-context
// coord comparison (e.g., distance between a stage-level layout
// and a Freeform-internal shape) isn't directly meaningful since
// no v0.4 feature consumes that — both render at correct slide-
// design positions, which is what matters for visuals.

import { useEffect, useState } from 'react';

import type { SourceRange } from './host.js';

// Find the portal target for selection visuals on `firstSpan`.
// Walks up from the span's wrapper: prefer the closest Freeform's
// positioned div; fall back to the slide stage (`.presentation-
// canvas`) if there's no Freeform ancestor. Returns null while no
// selection / no canvas mounted.
export function useSelectionPortal(
  firstSpan?: SourceRange,
): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!firstSpan) {
      setEl(null);
      return;
    }
    const wrapper = document.querySelector(
      `.sw-canvas-stage [data-sw-span-start="${firstSpan.start}"][data-sw-span-end="${firstSpan.end}"]`,
    );
    // Freeform-anchored path (existing): closest Freeform's
    // positioned div.
    const freeform = wrapper?.closest('[data-sw-component="Freeform"]');
    const freeformInner = freeform?.firstElementChild;
    if (freeformInner instanceof HTMLElement) {
      setEl(freeformInner);
      return;
    }
    // Slide-stage fallback: `.presentation-canvas` is `position:
    // relative` and stable across slide navigation.
    const stage = document.querySelector(
      '.sw-canvas-stage .presentation-canvas',
    );
    setEl(stage instanceof HTMLElement ? stage : null);
  }, [firstSpan?.start, firstSpan?.end]);
  return el;
}
