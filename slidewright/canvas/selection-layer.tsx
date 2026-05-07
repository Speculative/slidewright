// Selection-layer React component. Renders all selection visuals
// (per-shape outlines, group bounding box, resize handles) as a
// pure function of selection + gesture state. Replaces the old
// imperative selection effect that did `document.createElement` +
// per-frame style mutations during gestures.
//
// Architecture:
//   - For each selected shape, look up its ShapeData (params,
//     adapter, slideIdx) from the loader-built registry.
//   - Apply the active gesture's per-shape delta via
//     adapter.applyGesture, then compute bounds via
//     adapter.calculateBounds. The result tracks the shape's
//     gesture-adjusted position automatically — no separate
//     "update outline during drag" logic.
//   - Render visuals via a React portal into the active slide's
//     Freeform DOM. The Freeform is the positioning context (its
//     inner div is `position: relative`); the portal makes the
//     overlay's `left` / `top` Freeform-relative without coupling
//     selection rendering to where the SelectionLayer itself sits
//     in the React tree.
//
// Multi-select scope: all selected shapes share a Freeform (per
// SLIDEWRIGHT.md / Editor / multi-select scoping rule). One DOM
// lookup for the Freeform, then everything portals into it.

import { Fragment, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

import type { ShapeData } from '../runtime/loader.js';

import { spanKey } from './gesture-context.js';
import type { SourceRange } from './host.js';
import { isLayoutAdapter, type LayoutAdapter } from './layout-adapter.js';
import type {
  BoxResizeDirection,
  Bounds,
  ShapeAdapter,
  ShapeDelta,
  ShapeSpan,
  StartGesture,
} from './shape-adapter.js';

const DESIGN_W = 1920;

const GROUP_DIRECTIONS: BoxResizeDirection[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

interface SelectionLayerProps {
  selected: SourceRange[];
  shapes: ReadonlyMap<string, ShapeData>;
  gestureDeltas: ReadonlyMap<string, ShapeDelta>;
  // Whether to render handles. Currently false during creation
  // tools (so handle pointerdowns don't shadow the create gesture)
  // and while a gesture is already in flight (handles re-render
  // each frame at the live position; mounting them on top of an
  // active gesture confuses pointer capture).
  renderHandles: boolean;
  startGesture: StartGesture;
}

// Selectable items split into two kinds:
//   - 'shape' — has a ShapeAdapter; bounds come from
//     adapter.calculateBounds(params); supports Handles + group
//     resize.
//   - 'layout' — HStack / VStack and future flow-laid containers.
//     Bounds DOM-measured from the loader's wrapper. Handles are
//     optional (gap-drag grips when implemented); excluded from
//     group-resize handle rendering.
type SelectionItem =
  | {
      kind: 'shape';
      span: SourceRange;
      key: string;
      adapter: ShapeAdapter;
      params: Record<string, unknown>;
      bounds: Bounds;
    }
  | {
      kind: 'layout';
      span: SourceRange;
      key: string;
      adapter: LayoutAdapter;
      params: Record<string, unknown>;
      bounds: Bounds;
    };

export function SelectionLayer({
  selected,
  shapes,
  gestureDeltas,
  renderHandles,
  startGesture,
}: SelectionLayerProps): ReactElement | null {
  const portalTarget = useFreeformDiv(selected[0]);
  // Layout bounds come from DOM measurement, not from params. Doing
  // it inline in render reads the DOM *before* React's commit phase
  // flushes layout-affecting source changes (e.g., a stack's
  // `spacing` edit), so the outline lags one render behind. Measure
  // in a layout effect after commit (before paint) and stash in
  // state — render reads the stashed values.
  const layoutBounds = useMeasuredLayoutBounds(
    selected,
    shapes,
    gestureDeltas,
    portalTarget,
  );

  if (selected.length === 0) return null;

  const items: SelectionItem[] = [];
  for (const span of selected) {
    const key = spanKey(span);
    const data = shapes.get(key);
    if (!data) continue;
    if (isLayoutAdapter(data.canvas)) {
      const bounds = layoutBounds.get(key);
      if (!bounds) continue;
      // Live preview during a gap-drag (or any layout-adapter
      // gesture that mutates this layout's params): apply the
      // gesture delta so Handles read updated params.
      const delta = gestureDeltas.get(key);
      const params =
        delta && data.canvas.applyGesture
          ? data.canvas.applyGesture(data.params, delta)
          : data.params;
      items.push({
        kind: 'layout',
        span,
        key,
        adapter: data.canvas,
        params,
        bounds,
      });
      continue;
    }
    const adapter = data.canvas as ShapeAdapter;
    const delta = gestureDeltas.get(key);
    const params = delta ? adapter.applyGesture(data.params, delta) : data.params;
    const bounds = adapter.calculateBounds(params);
    if (!bounds) continue;
    items.push({ kind: 'shape', span, key, adapter, params, bounds });
  }

  if (items.length === 0 || !portalTarget) return null;

  const allShapes = items.every((i) => i.kind === 'shape');

  // Group bounding box — the union of per-shape bounds, with a
  // small outset margin so it visually contains the inner outlines.
  // Only when 2+ selected shapes contribute; single-select skips.
  // `groupCore` is the raw union (no outset), used for the resize-
  // handle math so handles sit on the actual edges rather than the
  // outset frame.
  let groupBox: Bounds | null = null;
  let groupCore: Bounds | null = null;
  if (items.length > 1) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const i of items) {
      if (i.bounds.left < left) left = i.bounds.left;
      if (i.bounds.top < top) top = i.bounds.top;
      if (i.bounds.left + i.bounds.width > right) right = i.bounds.left + i.bounds.width;
      if (i.bounds.top + i.bounds.height > bottom) bottom = i.bounds.top + i.bounds.height;
    }
    groupCore = {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
    groupBox = {
      left: left - 8,
      top: top - 8,
      width: right - left + 16,
      height: bottom - top + 16,
    };
  }

  // Handles render for any single-selected item with a Handles
  // component (shape: required; layout: optional). Group handles
  // (rigid-body resize) only fire on shape selections.
  const showHandles = items.length === 1 && renderHandles;
  const showGroupHandles = items.length > 1 && renderHandles && groupCore && allShapes;

  return createPortal(
    <>
      {items.map((item) => (
        <Fragment key={item.key}>
          <div
            className="sw-selection-outline"
            data-sw-overlay-for-start={item.span.start}
            data-sw-overlay-for-end={item.span.end}
            style={{
              position: 'absolute',
              left: `${item.bounds.left - 4}px`,
              top: `${item.bounds.top - 4}px`,
              width: `${item.bounds.width + 8}px`,
              height: `${item.bounds.height + 8}px`,
              pointerEvents: 'none',
            }}
          />
          {showHandles && item.kind === 'shape' && (
            <item.adapter.Handles
              params={item.params}
              span={item.span as ShapeSpan}
              startGesture={startGesture}
            />
          )}
          {showHandles && item.kind === 'layout' && item.adapter.Handles && (
            <item.adapter.Handles
              params={item.params}
              span={item.span as ShapeSpan}
              startGesture={startGesture}
            />
          )}
        </Fragment>
      ))}
      {groupBox && (
        <div
          className="sw-selection-group"
          style={{
            position: 'absolute',
            left: `${groupBox.left}px`,
            top: `${groupBox.top}px`,
            width: `${groupBox.width}px`,
            height: `${groupBox.height}px`,
            pointerEvents: 'none',
          }}
        />
      )}
      {showGroupHandles && groupCore && (
        <GroupHandles
          core={groupCore}
          members={items.map((i) => i.span)}
          startGesture={startGesture}
        />
      )}
    </>,
    portalTarget,
  );
}

interface GroupHandlesProps {
  // Group bbox in freeform-relative design coords (no outset).
  core: Bounds;
  members: ReadonlyArray<SourceRange>;
  startGesture: StartGesture;
}

function GroupHandles({
  core,
  members,
  startGesture,
}: GroupHandlesProps): ReactElement {
  const r = {
    x: core.left,
    y: core.top,
    width: core.width,
    height: core.height,
  };
  return (
    <>
      {GROUP_DIRECTIONS.map((dir) => {
        const pos = handleAt(dir, r);
        return (
          <div
            key={dir}
            className={`sw-resize-handle-shape sw-resize-${dir}`}
            style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.preventDefault();
              startGesture(
                {
                  kind: 'group-resize',
                  direction: dir,
                  originalBox: r,
                  members,
                },
                event.nativeEvent,
              );
            }}
          />
        );
      })}
    </>
  );
}

// Same handle math as rect-adapter's; duplicated rather than shared
// since this one is freeform-relative and that one is rect-relative
// (pivot is the rect's own origin, not the group's union).
function handleAt(
  dir: BoxResizeDirection,
  r: { x: number; y: number; width: number; height: number },
): { left: number; top: number } {
  switch (dir) {
    case 'nw': return { left: r.x - 7, top: r.y - 7 };
    case 'n':  return { left: r.x + r.width / 2 - 7, top: r.y - 7 };
    case 'ne': return { left: r.x + r.width - 7, top: r.y - 7 };
    case 'e':  return { left: r.x + r.width - 7, top: r.y + r.height / 2 - 7 };
    case 'se': return { left: r.x + r.width - 7, top: r.y + r.height - 7 };
    case 's':  return { left: r.x + r.width / 2 - 7, top: r.y + r.height - 7 };
    case 'sw': return { left: r.x - 7, top: r.y + r.height - 7 };
    case 'w':  return { left: r.x - 7, top: r.y + r.height / 2 - 7 };
  }
}

// Re-measures every selected layout after each commit-phase DOM
// flush, returning a Map from spanKey to Freeform-relative design
// bounds. Runs in `useLayoutEffect` so it sees the post-commit DOM
// (a render-phase measurement would read pre-flush bounds and lag
// one render behind any source edit that shifts the layout — e.g.,
// editing a VStack's `spacing` in the inspector). The double-render
// flushed here is contained: layouts are rare in any selection, and
// the equality check below skips the second render when the
// measurement didn't move (the common case). Per-gesture-frame
// re-measurement (via gestureDeltas in the deps) is needed so the
// outline tracks live param changes — e.g., gap-drag growing the
// VStack's height as `spacing` increases.
function useMeasuredLayoutBounds(
  selected: SourceRange[],
  shapes: ReadonlyMap<string, ShapeData>,
  gestureDeltas: ReadonlyMap<string, ShapeDelta>,
  portalTarget: HTMLElement | null,
): ReadonlyMap<string, Bounds> {
  const [layoutBounds, setLayoutBounds] = useState<ReadonlyMap<string, Bounds>>(
    EMPTY_BOUNDS,
  );
  useLayoutEffect(() => {
    if (!portalTarget) {
      setLayoutBounds(EMPTY_BOUNDS);
      return;
    }
    const next = new Map<string, Bounds>();
    for (const span of selected) {
      const key = spanKey(span);
      const data = shapes.get(key);
      if (!data || !isLayoutAdapter(data.canvas)) continue;
      const bounds = measureLayoutBounds(span, portalTarget);
      if (bounds) next.set(key, bounds);
    }
    // Only setState when the measurement actually changed — saves a
    // re-render on every source commit / gesture frame that didn't
    // move a layout.
    setLayoutBounds((prev) => (boundsMapsEqual(prev, next) ? prev : next));
  }, [selected, shapes, gestureDeltas, portalTarget]);
  return layoutBounds;
}

const EMPTY_BOUNDS: ReadonlyMap<string, Bounds> = new Map();

function boundsMapsEqual(
  a: ReadonlyMap<string, Bounds>,
  b: ReadonlyMap<string, Bounds>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, va] of a) {
    const vb = b.get(key);
    if (!vb) return false;
    if (
      va.left !== vb.left ||
      va.top !== vb.top ||
      va.width !== vb.width ||
      va.height !== vb.height
    ) {
      return false;
    }
  }
  return true;
}

// DOM-measure a layout's bounds, expressed in the portal target's
// coord system (Freeform-relative design pixels). The loader's
// wrapper for each component invocation is `display: contents`,
// which means it has no box of its own — its `getBoundingClientRect`
// returns zero. We measure the wrapper's first element child instead,
// which is the layout's rendered root (the flex container for HStack
// / VStack).
//
// Returns null if the wrapper, its first child, or the
// `.presentation-canvas` (used to compute scale) is missing — caller
// should drop the item from the selection visuals.
function measureLayoutBounds(
  span: SourceRange,
  portalTarget: HTMLElement,
): Bounds | null {
  const wrapper = document.querySelector(
    `.sw-canvas-stage [data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"]`,
  );
  if (!(wrapper instanceof HTMLElement)) return null;
  const inner = wrapper.firstElementChild;
  if (!(inner instanceof HTMLElement)) return null;
  const canvas = document.querySelector(
    '.sw-canvas-stage .presentation-canvas',
  );
  if (!(canvas instanceof HTMLElement)) return null;
  const scale = canvas.getBoundingClientRect().width / DESIGN_W;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const innerRect = inner.getBoundingClientRect();
  const portalRect = portalTarget.getBoundingClientRect();
  return {
    left: (innerRect.left - portalRect.left) / scale,
    top: (innerRect.top - portalRect.top) / scale,
    width: innerRect.width / scale,
    height: innerRect.height / scale,
  };
}

// Looks up the active slide's Freeform DOM. Returns null until the
// slide has rendered (first render of a fresh source). Subscribes
// to layout effects so the lookup retries after React commits the
// slide tree.
function useFreeformDiv(firstSpan?: SourceRange): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!firstSpan) {
      setEl(null);
      return;
    }
    // Find the selected shape's wrapper in the active canvas, walk
    // up to the closest Freeform's inner div (the positioned one,
    // first child of the wrapper). One lookup per selection /
    // source change — not per gesture frame.
    const wrapper = document.querySelector(
      `.sw-canvas-stage [data-sw-span-start="${firstSpan.start}"][data-sw-span-end="${firstSpan.end}"]`,
    );
    const freeform = wrapper?.closest('[data-sw-component="Freeform"]');
    const inner = freeform?.firstElementChild;
    setEl(inner instanceof HTMLElement ? inner : null);
  }, [firstSpan?.start, firstSpan?.end]);
  return el;
}
