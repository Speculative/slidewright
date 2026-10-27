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
// Single-context selections keep their local frame. Hierarchy selections
// spanning contexts use the slide canvas, with bounds converted by the
// selection layer before combining them.

import { useLayoutEffect, useState } from 'react';

import type { SourceRange } from './host.js';

// Walk up from `el` to find the closest portal ancestor: prefer
// the closest Freeform's positioned div; fall back to the slide
// stage (`.presentation-canvas`) if there's no Freeform ancestor.
// Pure DOM walk — usable from non-React code (e.g., gesture-start
// handlers in adapters).
export function findPortalAncestor(el: Element): HTMLElement | null {
  // A Group's own bounds are in its parent's coordinates; descendants use
  // the Group's positioned div as their local frame.
  const anchor = el.matches('[data-sw-component="Group"]') ? el.parentElement : el;
  const freeform = anchor?.closest('[data-sw-component="Freeform"], [data-sw-component="Group"]');
  const inner = freeform?.firstElementChild;
  if (inner instanceof HTMLElement) return inner;
  const stage = document.querySelector(
    '.sw-canvas-stage .presentation-canvas',
  );
  return stage instanceof HTMLElement ? stage : null;
}

// Find a common portal target for selection visuals. Mixed positioning
// contexts use the slide canvas; their bounds must be converted into it.
// Looks up the span's wrapper and walks up via findPortalAncestor.
// Returns null while no selection / no canvas mounted.
export function useSelectionPortal(
  spans?: SourceRange | readonly SourceRange[],
): HTMLElement | null {
  const targets = !spans ? [] : 'start' in spans ? [spans] : spans;
  const targetsKey = targets.map(span => `${span.start}-${span.end}`).join(',');
  const [state, setState] = useState<{ el: HTMLElement | null; key: string; wrappers: (Element | null)[] }>({ el: null, key: '', wrappers: [] });
  useLayoutEffect(() => {
    if (!targets.length) {
      setState(prior => prior.el === null && prior.key === '' ? prior : { el: null, key: '', wrappers: [] });
      return;
    }
    // The selection's span lives on either a component wrapper
    // (`data-sw-span-*`) or a slot wrapper (`data-sw-slot-span-*`).
    // Try both — whichever matches gives a wrapper to walk up
    // from for the portal-ancestor lookup.
    const wrappers = targets.map(span =>
        document.querySelector(
          `.sw-canvas-stage [data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"]`,
        ) ??
        document.querySelector(
          `.sw-canvas-stage [data-sw-slot-span-start="${span.start}"][data-sw-slot-span-end="${span.end}"]`,
        ));
    const portals = wrappers.map(wrapper => wrapper ? findPortalAncestor(wrapper) : null);
    const first = portals[0];
    const canvas = document.querySelector('.sw-canvas-stage .presentation-canvas');
    const el = portals.every(portal => portal === first)
      ? first ?? null
      : canvas instanceof HTMLElement ? canvas : null;
    // A mapped span can change while the positioned portal stays identical.
    // Publish that lookup after DOM commit so consumers retry source-marker
    // reads they performed against the preceding revision. Also detect replaced
    // wrappers/portals when registry or source changes retain the same offsets.
    setState(prior => prior.el === el && prior.key === targetsKey &&
      prior.wrappers.length === wrappers.length && prior.wrappers.every((wrapper, i) => wrapper === wrappers[i])
      ? prior : { el, key: targetsKey, wrappers });
  });
  return state.el;
}
