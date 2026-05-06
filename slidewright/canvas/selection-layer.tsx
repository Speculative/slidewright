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

import { Fragment, useEffect, useState } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

import type { ShapeData } from '../runtime/loader.js';

import { spanKey } from './gesture-context.js';
import type { SourceRange } from './host.js';
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

interface SelectionItem {
  span: SourceRange;
  key: string;
  adapter: ShapeAdapter;
  params: Record<string, unknown>;
  bounds: Bounds;
}

export function SelectionLayer({
  selected,
  shapes,
  gestureDeltas,
  renderHandles,
  startGesture,
}: SelectionLayerProps): ReactElement | null {
  const portalTarget = useFreeformDiv(selected[0]);

  if (selected.length === 0) return null;

  const items: SelectionItem[] = [];
  for (const span of selected) {
    const key = spanKey(span);
    const data = shapes.get(key);
    if (!data) continue;
    const adapter = data.canvas as ShapeAdapter;
    const delta = gestureDeltas.get(key);
    const params = delta ? adapter.applyGesture(data.params, delta) : data.params;
    const bounds = adapter.calculateBounds(params);
    if (!bounds) continue;
    items.push({ span, key, adapter, params, bounds });
  }

  if (items.length === 0 || !portalTarget) return null;

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

  const showHandles = items.length === 1 && renderHandles;
  const showGroupHandles = items.length > 1 && renderHandles && groupCore;

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
          {showHandles && (
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
