// Box shape primitive.
//
// Absolutely-positioned rectangle inside a Freeform parent. Position
// (x, y) and size (width, height) are slide-design-space pixels —
// the Freeform parent fills the slide's 1920x1080 frame, so
// `x: 200, y: 200` is roughly upper-left, `x: 1700, y: 980` is lower-
// right.
//
// Canvas behavior (drag-to-move, 8-handle resize) is declared by the
// `canvas` export below. The adapter is *purely declarative*: it
// answers questions about the shape's bounds, applies a gesture
// delta to its params, renders its handles, and commits the gesture
// to the AST. No imperative DOM mutation — the loader's
// ShapeProjection wrapper consumes gesture context and re-renders
// the shape with adjusted params every frame during a gesture.

import type {
  ComponentMeta,
  ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import type {
  BoxResizeDirection,
  HandlesProps,
  ShapeAdapter,
  ShapeDelta,
} from '../../../slidewright/canvas/shape-adapter.js';
import {
  findComponentAtSpan,
  findNumericSlot,
  findShapeChildIdx,
} from '../../../slidewright/canvas/ast-edits.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: {},
  params: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    width: { type: 'number', default: 200 },
    height: { type: 'number', default: 200 },
    fill: { type: 'color-token', default: 'accent' },
  },
  protocols: {},
};

export default function Box({ params }: ComponentRenderProps) {
  const x = (params.x as number | undefined) ?? 0;
  const y = (params.y as number | undefined) ?? 0;
  const width = (params.width as number | undefined) ?? 200;
  const height = (params.height as number | undefined) ?? 200;
  const fill = (params.fill as string | undefined) ?? 'accent';
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        background: `var(--${fill})`,
        border: '4px solid var(--fg, #000)',
        boxSizing: 'border-box',
      }}
    />
  );
}

// ─── Canvas adapter ──────────────────────────────────────────────

const RESIZE_DIRECTIONS: BoxResizeDirection[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

const MIN_SIZE = 1;

interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Box-style corner / edge resize math. Given a starting box and a
// delta, return the new box. Clamps at MIN_SIZE so dragging past
// the opposite edge doesn't flip the box.
function resizeBox(
  direction: BoxResizeDirection,
  orig: BoxRect,
  dx: number,
  dy: number,
): BoxRect {
  let { x, y, width, height } = orig;
  if (direction.includes('w')) {
    const proposed = orig.width - dx;
    if (proposed < MIN_SIZE) {
      x = orig.x + orig.width - MIN_SIZE;
      width = MIN_SIZE;
    } else {
      x = orig.x + dx;
      width = proposed;
    }
  } else if (direction.includes('e')) {
    width = Math.max(MIN_SIZE, orig.width + dx);
  }
  if (direction.includes('n')) {
    const proposed = orig.height - dy;
    if (proposed < MIN_SIZE) {
      y = orig.y + orig.height - MIN_SIZE;
      height = MIN_SIZE;
    } else {
      y = orig.y + dy;
      height = proposed;
    }
  } else if (direction.includes('s')) {
    height = Math.max(MIN_SIZE, orig.height + dy);
  }
  return { x, y, width, height };
}

// Read a numeric param defensively. Source-driven values are
// already validated to be numbers by the loader, but adapters
// shouldn't crash on malformed input.
function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

function paramsToBox(params: Record<string, unknown>): BoxRect {
  return {
    x: num(params, 'x', 0),
    y: num(params, 'y', 0),
    width: num(params, 'width', 200),
    height: num(params, 'height', 200),
  };
}

export const canvas: ShapeAdapter = {
  boundsFromParams(params) {
    const b = paramsToBox(params);
    return { left: b.x, top: b.y, width: b.width, height: b.height };
  },

  applyGesture(params, delta) {
    if (delta.kind === 'translate') {
      return {
        ...params,
        x: num(params, 'x', 0) + delta.dx,
        y: num(params, 'y', 0) + delta.dy,
      };
    }
    if (delta.kind === 'box-resize') {
      const r = resizeBox(delta.direction, delta.original, delta.dx, delta.dy);
      return { ...params, x: r.x, y: r.y, width: r.width, height: r.height };
    }
    // arrow-endpoint and any future delta kinds aren't applicable
    // to Box — pass through.
    return params;
  },

  Handles({ params, span, startGesture }: HandlesProps) {
    const orig = paramsToBox(params);
    // Handles render as freeform-relative children of the
    // SelectionLayer's portal — so each handle's own (left, top)
    // must include the shape's design-space position. The CSS
    // class supplies background / border / cursor only.
    const handleAt = (dir: BoxResizeDirection): { left: number; top: number } => {
      switch (dir) {
        case 'nw': return { left: orig.x - 7, top: orig.y - 7 };
        case 'n':  return { left: orig.x + orig.width / 2 - 7, top: orig.y - 7 };
        case 'ne': return { left: orig.x + orig.width - 7, top: orig.y - 7 };
        case 'e':  return { left: orig.x + orig.width - 7, top: orig.y + orig.height / 2 - 7 };
        case 'se': return { left: orig.x + orig.width - 7, top: orig.y + orig.height - 7 };
        case 's':  return { left: orig.x + orig.width / 2 - 7, top: orig.y + orig.height - 7 };
        case 'sw': return { left: orig.x - 7, top: orig.y + orig.height - 7 };
        case 'w':  return { left: orig.x - 7, top: orig.y + orig.height / 2 - 7 };
      }
    };
    return (
      <>
        {RESIZE_DIRECTIONS.map((dir) => {
          const pos = handleAt(dir);
          return (
            <div
              key={dir}
              className={`sw-resize-handle-shape sw-resize-${dir}`}
              style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                event.preventDefault();
                startGesture(
                  { kind: 'box-resize', direction: dir, original: orig },
                  event.nativeEvent,
                );
              }}
            />
          );
        })}
      </>
    );
    void span;
  },

  commit(ast, span, delta, slideIdx) {
    const target = findComponentAtSpan(ast, span.start, span.end);
    if (!target) return null;
    if (delta.kind === 'translate') {
      const xSlot = findNumericSlot(target, 'x');
      const ySlot = findNumericSlot(target, 'y');
      if (xSlot) xSlot.node.value = Math.round(xSlot.value + delta.dx);
      if (ySlot) ySlot.node.value = Math.round(ySlot.value + delta.dy);
    } else if (delta.kind === 'box-resize') {
      const r = resizeBox(delta.direction, delta.original, delta.dx, delta.dy);
      const xSlot = findNumericSlot(target, 'x');
      const ySlot = findNumericSlot(target, 'y');
      const wSlot = findNumericSlot(target, 'width');
      const hSlot = findNumericSlot(target, 'height');
      if (xSlot) xSlot.node.value = Math.round(r.x);
      if (ySlot) ySlot.node.value = Math.round(r.y);
      if (wSlot) wSlot.node.value = Math.round(r.width);
      if (hSlot) hSlot.node.value = Math.round(r.height);
    } else {
      // Unknown delta — abort.
      return null;
    }
    const childIdx = findShapeChildIdx(ast, slideIdx, span);
    return childIdx !== null
      ? { preserveSelection: { slideIdx, childIdx } }
      : {};
  },
};
