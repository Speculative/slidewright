// TextBox shape primitive.
//
// Absolutely-positioned text container inside a Freeform parent.
// Position (x, y) and size (width, height) are slide-design-space
// pixels — same coordinate system as Box. Content is a text slot
// (single string or styled run), edited via the v0.2.a in-place
// text-edit gesture (double-click).
//
// New text boxes default to a "Text" placeholder so the editable
// span has visible content for the user to double-click. Future
// polish: auto-enter edit mode on creation and drop the
// placeholder.
//
// Canvas-side gesture behavior: same shape as Box (8-handle
// resize, body translate). The adapter is structurally identical
// — different component name in commit's findComponentAtSpan, that's
// it. Future: factor into a shared "rect adapter" utility if a
// third HTML-rectangle shape lands.

import type { ReactNode } from 'react';
import type {
  ComponentMeta,
  ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import type {
  BoxResizeDirection,
  HandlesProps,
  ShapeAdapter,
} from '../../../slidewright/canvas/shape-adapter.js';
import {
  findComponentAtSpan,
  findNumericSlot,
  findShapeChildIdx,
} from '../../../slidewright/canvas/ast-edits.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: {
    content: { type: 'text', required: false },
  },
  params: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    width: { type: 'number', default: 320 },
    height: { type: 'number', default: 120 },
    fontSize: { type: 'number', default: 32 },
    color: { type: 'color-token', default: 'fg' },
  },
  protocols: {},
};

export default function TextBox({ slots, params }: ComponentRenderProps) {
  const x = (params.x as number | undefined) ?? 0;
  const y = (params.y as number | undefined) ?? 0;
  const width = (params.width as number | undefined) ?? 320;
  const height = (params.height as number | undefined) ?? 120;
  const fontSize = (params.fontSize as number | undefined) ?? 32;
  const color = (params.color as string | undefined) ?? 'fg';
  const content = slots.content as ReactNode | undefined;
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        padding: '8px',
        boxSizing: 'border-box',
        fontSize: `${fontSize}px`,
        lineHeight: 1.25,
        color: `var(--${color})`,
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
        // No background by default — text floats over the slide.
        // Adding fill is a future polish (would need another param).
      }}
    >
      {content}
    </div>
  );
}

// ─── Canvas adapter ──────────────────────────────────────────────

const RESIZE_DIRECTIONS: BoxResizeDirection[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

const MIN_SIZE = 1;

interface Rect { x: number; y: number; width: number; height: number }

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

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

function paramsToRect(params: Record<string, unknown>): Rect {
  return {
    x: num(params, 'x', 0),
    y: num(params, 'y', 0),
    width: num(params, 'width', 320),
    height: num(params, 'height', 120),
  };
}

export const canvas: ShapeAdapter = {
  boundsFromParams(params) {
    const r = paramsToRect(params);
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

  Handles({ params, span, startGesture }: HandlesProps) {
    const orig = paramsToRect(params);
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
