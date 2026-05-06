// Shared adapter for HTML-rectangle shapes (Box, TextBox, future
// shapes that look like a positioned rect with x / y / width /
// height slot fills). Both translate and corner-handle resize
// follow the same logic; only the default size varies between
// shapes.
//
// Usage:
//   // In Box.tsx:
//   export const canvas = makeRectAdapter({ width: 200, height: 200 });

import { createElement, type ReactElement } from 'react';

import {
  findComponentAtSpan,
  findNumericSlot,
  findShapeChildIdx,
} from './ast-edits.js';
import type {
  BoxResizeDirection,
  HandlesProps,
  ShapeAdapter,
} from './shape-adapter.js';

const RESIZE_DIRECTIONS: BoxResizeDirection[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

const MIN_SIZE = 1;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function resizeRect(
  direction: BoxResizeDirection,
  orig: Rect,
  dx: number,
  dy: number,
): Rect {
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

function num(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

function paramsToRect(
  params: Record<string, unknown>,
  defaults: { width: number; height: number },
): Rect {
  return {
    x: num(params, 'x', 0),
    y: num(params, 'y', 0),
    width: num(params, 'width', defaults.width),
    height: num(params, 'height', defaults.height),
  };
}

// Compute a handle's freeform-relative position for a given
// direction and rect. Handles are 14×14 (centered on the
// corner / edge midpoint, hence the -7).
function handleAt(
  dir: BoxResizeDirection,
  r: Rect,
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

function RectHandles({
  params,
  startGesture,
  defaults,
}: HandlesProps & { defaults: { width: number; height: number } }): ReactElement {
  const orig = paramsToRect(params, defaults);
  return createElement(
    'div',
    { style: { display: 'contents' } },
    RESIZE_DIRECTIONS.map((dir) => {
      const pos = handleAt(dir, orig);
      return createElement('div', {
        key: dir,
        className: `sw-resize-handle-shape sw-resize-${dir}`,
        style: { left: `${pos.left}px`, top: `${pos.top}px` },
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          startGesture(
            { kind: 'box-resize', direction: dir, original: orig },
            event.nativeEvent,
          );
        },
      });
    }),
  );
}

export function makeRectAdapter(defaults: { width: number; height: number }): ShapeAdapter {
  return {
    boundsFromParams(params) {
      const r = paramsToRect(params, defaults);
      return { left: r.x, top: r.y, width: r.width, height: r.height };
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
        const r = resizeRect(delta.direction, delta.original, delta.dx, delta.dy);
        return { ...params, x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return params;
    },

    Handles(props) {
      return RectHandles({ ...props, defaults });
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
        const r = resizeRect(delta.direction, delta.original, delta.dx, delta.dy);
        const xSlot = findNumericSlot(target, 'x');
        const ySlot = findNumericSlot(target, 'y');
        const wSlot = findNumericSlot(target, 'width');
        const hSlot = findNumericSlot(target, 'height');
        if (xSlot) xSlot.node.value = Math.round(r.x);
        if (ySlot) ySlot.node.value = Math.round(r.y);
        if (wSlot) wSlot.node.value = Math.round(r.width);
        if (hSlot) hSlot.node.value = Math.round(r.height);
      } else {
        return null;
      }
      const childIdx = findShapeChildIdx(ast, slideIdx, span);
      return childIdx !== null
        ? { preserveSelection: { slideIdx, childIdx } }
        : {};
    },
  };
}
