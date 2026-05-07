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
//   - Render visuals via a React portal. The portal target is
//     either the closest Freeform's positioned div (for shape
//     selections + layouts inside Freeforms) or the slide stage
//     `.presentation-canvas` (for layouts at slide-level with no
//     Freeform ancestor). See `portal-target.ts:useSelectionPortal`
//     for the conditional lookup.
//
// Multi-select scope: all selected shapes share one positioning
// context (per SLIDEWRIGHT.md / Editor / multi-select scoping
// rule), so one portal lookup suffices for the whole selection.

import { Fragment, useEffect, useState } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

import type { ShapeData } from '../runtime/loader.js';

import { spanKey } from './gesture-context.js';
import type { SourceRange } from './host.js';
import { isLayoutAdapter, type LayoutAdapter } from './layout-adapter.js';
import { measureLayoutSnapshot } from './layout-measurement.js';
import {
  findPortalAncestor,
  useSelectionPortal,
} from './portal-target.js';
import type { SelectionTarget } from './selection-target.js';
import type {
  BoxResizeDirection,
  Bounds,
  ShapeAdapter,
  ShapeDelta,
  ShapeSpan,
  StartGesture,
} from './shape-adapter.js';

const GROUP_DIRECTIONS: BoxResizeDirection[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

interface SelectionLayerProps {
  selected: SelectionTarget[];
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

// Selectable items split into three kinds:
//   - 'shape' — has a ShapeAdapter; bounds come from
//     adapter.calculateBounds(params); supports Handles + group
//     resize.
//   - 'layout' — HStack / VStack and future flow-laid containers.
//     Bounds DOM-measured from the loader's wrapper. Handles are
//     optional (gap-drag grips when implemented); excluded from
//     group-resize handle rendering.
//   - 'slot' — a named slot fill on a component (e.g.,
//     CardRow.body). Bounds DOM-measured from the slot wrapper's
//     content via Range API. No Handles, no group resize.
//     Visually distinct (teal dashed border + slot name label).
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
    }
  | {
      kind: 'slot';
      span: SourceRange;
      parentSpan: SourceRange;
      slotName: string;
      key: string;
      bounds: Bounds;
    };

export function SelectionLayer({
  selected,
  shapes,
  gestureDeltas,
  renderHandles,
  startGesture,
}: SelectionLayerProps): ReactElement | null {
  const portalTarget = useSelectionPortal(selected[0]?.span);
  // Layout bounds come from DOM measurement, not from params. Doing
  // it inline in render reads the DOM *before* React's commit phase
  // flushes layout-affecting source changes (e.g., a stack's
  // `spacing` edit), so the outline lags one render behind. Measure
  // in a layout effect after commit (before paint) and stash in
  // state — render reads the stashed values.
  const layoutBounds = useMeasuredLayoutBounds(selected, shapes, portalTarget);
  const slotBounds = useMeasuredSlotBounds(selected, portalTarget);

  if (selected.length === 0) return null;

  const items: SelectionItem[] = [];
  for (const target of selected) {
    if (target.kind === 'slot') {
      const key = slotKey(target);
      const bounds = slotBounds.get(key);
      if (!bounds) continue;
      items.push({
        kind: 'slot',
        span: target.span,
        parentSpan: target.parentSpan,
        slotName: target.slotName,
        key,
        bounds,
      });
      continue;
    }
    const span = target.span;
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
            className={
              item.kind === 'slot'
                ? 'sw-selection-outline sw-selection-slot'
                : 'sw-selection-outline'
            }
            data-sw-overlay-for-start={item.span.start}
            data-sw-overlay-for-end={item.span.end}
            style={{
              position: 'absolute',
              left: `${item.bounds.left - 4}px`,
              top: `${item.bounds.top - 4}px`,
              width: `${item.bounds.width + 8}px`,
              height: `${item.bounds.height + 8}px`,
              pointerEvents: 'none',
              ...(item.kind === 'slot'
                ? {
                    border: '2px dashed rgba(0, 200, 200, 0.95)',
                    borderRadius: '3px',
                  }
                : null),
            }}
          />
          {item.kind === 'slot' && (
            <div
              className="sw-selection-slot-label"
              style={{
                position: 'absolute',
                left: `${item.bounds.left - 4}px`,
                top: `${item.bounds.top - 24}px`,
                background: 'rgba(0, 200, 200, 0.95)',
                color: '#fff',
                fontSize: '14px',
                fontFamily: 'system-ui, sans-serif',
                padding: '2px 8px',
                borderRadius: '3px 3px 0 0',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {item.slotName}
            </div>
          )}
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

// ResizeObserver-driven layout-bounds tracking. Subscribes to each
// selected layout (and the canvas, for scale changes); on any size
// change, re-measure all selected layouts via measureLayoutSnapshot.
// Replaces the v0.4 useLayoutEffect + manual deps pattern that had
// recurring reactivity bugs (missed deps for gesture-driven layout
// shifts, infinite loops from early-return identity churn). The
// observer fires on layout commits regardless of which React state
// triggered them, so consumers don't have to enumerate state inputs.
function useMeasuredLayoutBounds(
  selected: SelectionTarget[],
  shapes: ReadonlyMap<string, ShapeData>,
  portalTarget: HTMLElement | null,
): ReadonlyMap<string, Bounds> {
  const [layoutBounds, setLayoutBounds] = useState<ReadonlyMap<string, Bounds>>(
    EMPTY_BOUNDS,
  );
  useEffect(() => {
    if (!portalTarget) {
      setLayoutBounds((prev) => (prev.size === 0 ? prev : EMPTY_BOUNDS));
      return;
    }
    const remeasure = (): void => {
      const next = new Map<string, Bounds>();
      for (const target of selected) {
        if (target.kind !== 'component') continue;
        const span = target.span;
        const key = spanKey(span);
        const data = shapes.get(key);
        if (!data || !isLayoutAdapter(data.canvas)) continue;
        const snap = measureLayoutSnapshot(span);
        if (snap) next.set(key, snap.layout);
      }
      setLayoutBounds((prev) => (boundsMapsEqual(prev, next) ? prev : next));
    };
    remeasure();

    const observer = new ResizeObserver(remeasure);
    const canvas = document.querySelector(
      '.sw-canvas-stage .presentation-canvas',
    );
    if (canvas instanceof HTMLElement) observer.observe(canvas);
    for (const target of selected) {
      if (target.kind !== 'component') continue;
      const span = target.span;
      const key = spanKey(span);
      const data = shapes.get(key);
      if (!data || !isLayoutAdapter(data.canvas)) continue;
      const wrapper = document.querySelector(
        `.sw-canvas-stage [data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"]`,
      );
      if (!wrapper) continue;
      const layoutEl = wrapper.firstElementChild;
      if (layoutEl instanceof HTMLElement) observer.observe(layoutEl);
      const ref = findPortalAncestor(wrapper);
      if (ref) observer.observe(ref);
    }
    return () => observer.disconnect();
  }, [selected, shapes, portalTarget]);
  return layoutBounds;
}

// Slot bounds — measured via Range API on the slot wrapper's
// children. Slot wrappers are `display: contents` (no box of
// their own); the bounding rect is the union of their rendered
// content. ResizeObserver subscribes to the parent component's
// rendered root (its size changes when slot content reflows).
function useMeasuredSlotBounds(
  selected: SelectionTarget[],
  portalTarget: HTMLElement | null,
): ReadonlyMap<string, Bounds> {
  const [slotBounds, setSlotBounds] = useState<ReadonlyMap<string, Bounds>>(
    EMPTY_BOUNDS,
  );
  useEffect(() => {
    if (!portalTarget) {
      setSlotBounds((prev) => (prev.size === 0 ? prev : EMPTY_BOUNDS));
      return;
    }
    const remeasure = (): void => {
      const next = new Map<string, Bounds>();
      for (const target of selected) {
        if (target.kind !== 'slot') continue;
        const bounds = measureSlotBounds(target, portalTarget);
        if (bounds) next.set(slotKey(target), bounds);
      }
      setSlotBounds((prev) => (boundsMapsEqual(prev, next) ? prev : next));
    };
    remeasure();

    const observer = new ResizeObserver(remeasure);
    const canvas = document.querySelector(
      '.sw-canvas-stage .presentation-canvas',
    );
    if (canvas instanceof HTMLElement) observer.observe(canvas);
    for (const target of selected) {
      if (target.kind !== 'slot') continue;
      // Subscribe to the parent component's rendered root — when
      // its layout changes (children reflow, spacing edit, etc.),
      // the slot's bounds shift too.
      const parentEl = document.querySelector(
        `.sw-canvas-stage [data-sw-span-start="${target.parentSpan.start}"][data-sw-span-end="${target.parentSpan.end}"]`,
      );
      const inner = parentEl?.firstElementChild;
      if (inner instanceof HTMLElement) observer.observe(inner);
    }
    return () => observer.disconnect();
  }, [selected, portalTarget]);
  return slotBounds;
}

function slotKey(target: { parentSpan: SourceRange; slotName: string }): string {
  return `${target.parentSpan.start}-${target.parentSpan.end}-${target.slotName}`;
}

// DOM-measure a slot's bounds via Range API. The slot wrapper is
// `display: contents`; getBoundingClientRect on it returns 0,0,0,0.
// A Range over the wrapper's contents gives the union bounding box
// of all the rendered children — text runs, components, etc.
function measureSlotBounds(
  target: { span: SourceRange; parentSpan: SourceRange; slotName: string },
  portalTarget: HTMLElement,
): Bounds | null {
  const slotEl = document.querySelector(
    `.sw-canvas-stage [data-sw-slot-span-start="${target.span.start}"][data-sw-slot-span-end="${target.span.end}"][data-sw-slot-name="${target.slotName}"]`,
  );
  if (!(slotEl instanceof HTMLElement)) return null;
  const canvas = document.querySelector(
    '.sw-canvas-stage .presentation-canvas',
  );
  if (!(canvas instanceof HTMLElement)) return null;
  const scale = canvas.getBoundingClientRect().width / 1920;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const range = document.createRange();
  range.selectNodeContents(slotEl);
  const rect = range.getBoundingClientRect();
  range.detach?.();
  // Empty / collapsed slots render as 0×0 rects — drop them so the
  // outline doesn't appear at the parent's origin (placeholder
  // rendering for empty slots is the next milestone's task).
  if (rect.width === 0 && rect.height === 0) return null;
  const portalRect = portalTarget.getBoundingClientRect();
  return {
    left: (rect.left - portalRect.left) / scale,
    top: (rect.top - portalRect.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
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

