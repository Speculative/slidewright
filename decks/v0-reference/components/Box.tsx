// Box shape primitive.
//
// Absolutely-positioned rectangle inside a Freeform parent. Position
// (x, y) and size (width, height) are slide-design-space pixels —
// the Freeform parent fills the slide's 1920x1080 frame, so
// `x: 200, y: 200` is roughly upper-left, `x: 1700, y: 980` is lower-
// right.
//
// Canvas behavior (drag-to-move, 8-handle resize) is declared by the
// `canvas` export below. App.tsx looks up the adapter by
// `data-sw-component` (placed on the loader's wrapping div) and
// dispatches gesture events to it.

import type {
  ComponentMeta,
  ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import type {
  GestureHandle,
  ShapeAdapter,
  ShapeSpan,
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

// Eight handle directions (corners + edge midpoints). Each
// direction's pointerdown starts a resize gesture that holds the
// opposite edges fixed and moves the named edges.
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_SIZE = 1;

interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function boxResize(
  direction: ResizeDirection,
  orig: BoxRect,
  designDx: number,
  designDy: number,
): BoxRect {
  let { left, top, width, height } = orig;
  if (direction.includes('w')) {
    const proposedWidth = orig.width - designDx;
    if (proposedWidth < MIN_SIZE) {
      left = orig.left + orig.width - MIN_SIZE;
      width = MIN_SIZE;
    } else {
      left = orig.left + designDx;
      width = proposedWidth;
    }
  } else if (direction.includes('e')) {
    width = Math.max(MIN_SIZE, orig.width + designDx);
  }
  if (direction.includes('n')) {
    const proposedHeight = orig.height - designDy;
    if (proposedHeight < MIN_SIZE) {
      top = orig.top + orig.height - MIN_SIZE;
      height = MIN_SIZE;
    } else {
      top = orig.top + designDy;
      height = proposedHeight;
    }
  } else if (direction.includes('s')) {
    height = Math.max(MIN_SIZE, orig.height + designDy);
  }
  return { left, top, width, height };
}

export const canvas: ShapeAdapter = {
  bounds(visualNode) {
    if (!(visualNode instanceof HTMLElement)) return null;
    return {
      left: visualNode.offsetLeft,
      top: visualNode.offsetTop,
      width: visualNode.offsetWidth,
      height: visualNode.offsetHeight,
    };
  },

  startBodyDrag(ctx) {
    if (!(ctx.visualNode instanceof HTMLElement)) {
      // Should never happen for Box (always a positioned div).
      // Return a no-op handle so the framework doesn't have to
      // null-check.
      return { onMove: () => {}, onCommit: () => null };
    }
    const visualNode = ctx.visualNode;
    const cs = window.getComputedStyle(visualNode);
    const originalLeft = parseFloat(cs.left) || 0;
    const originalTop = parseFloat(cs.top) || 0;
    const { span, slideIdx, getOverlay } = ctx;

    return {
      onMove(dx, dy) {
        const newLeft = originalLeft + dx;
        const newTop = originalTop + dy;
        visualNode.style.left = `${newLeft}px`;
        visualNode.style.top = `${newTop}px`;
        const overlay = getOverlay();
        if (overlay) {
          overlay.style.left = `${newLeft - 4}px`;
          overlay.style.top = `${newTop - 4}px`;
        }
      },
      onCommit(ast, dx, dy) {
        const target = findComponentAtSpan(ast, span.start, span.end);
        if (!target) return null;
        const xSlot = findNumericSlot(target, 'x');
        const ySlot = findNumericSlot(target, 'y');
        if (xSlot) xSlot.node.value = Math.round(originalLeft + dx);
        if (ySlot) ySlot.node.value = Math.round(originalTop + dy);
        const childIdx = findShapeChildIdx(ast, slideIdx, span);
        return childIdx !== null
          ? { preserveSelection: { slideIdx, childIdx } }
          : {};
      },
    };
  },

  renderHandles(ctx) {
    const { overlay, visualNode, span, slideIdx, startHandleDrag } = ctx;
    if (!(visualNode instanceof HTMLElement)) return () => {};
    const directions: ResizeDirection[] = [
      'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
    ];
    const handles: HTMLElement[] = [];
    for (const dir of directions) {
      const handle = document.createElement('div');
      handle.className = `sw-resize-handle-shape sw-resize-${dir}`;
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        // Stop propagation so ScaledCanvas's pointerdown doesn't
        // also fire (which would re-emit selection / start a body
        // drag on the same gesture).
        event.stopPropagation();
        event.preventDefault();
        startHandleDrag(
          makeBoxResizeHandle(visualNode, overlay, dir, span, slideIdx),
          event,
        );
      });
      overlay.appendChild(handle);
      handles.push(handle);
    }
    return () => {
      for (const h of handles) h.remove();
    };
  },
};

function makeBoxResizeHandle(
  visualNode: HTMLElement,
  overlay: HTMLElement,
  direction: ResizeDirection,
  span: ShapeSpan,
  slideIdx: number,
): GestureHandle {
  const cs = window.getComputedStyle(visualNode);
  const orig: BoxRect = {
    left: parseFloat(cs.left) || 0,
    top: parseFloat(cs.top) || 0,
    width: visualNode.offsetWidth,
    height: visualNode.offsetHeight,
  };
  return {
    onMove(dx, dy) {
      const r = boxResize(direction, orig, dx, dy);
      visualNode.style.left = `${r.left}px`;
      visualNode.style.top = `${r.top}px`;
      visualNode.style.width = `${r.width}px`;
      visualNode.style.height = `${r.height}px`;
      // Overlay sits 4px outside the shape on each side.
      overlay.style.left = `${r.left - 4}px`;
      overlay.style.top = `${r.top - 4}px`;
      overlay.style.width = `${r.width + 8}px`;
      overlay.style.height = `${r.height + 8}px`;
    },
    onCommit(ast, dx, dy) {
      const r = boxResize(direction, orig, dx, dy);
      const target = findComponentAtSpan(ast, span.start, span.end);
      if (!target) return null;
      const xSlot = findNumericSlot(target, 'x');
      const ySlot = findNumericSlot(target, 'y');
      const wSlot = findNumericSlot(target, 'width');
      const hSlot = findNumericSlot(target, 'height');
      if (xSlot) xSlot.node.value = Math.round(r.left);
      if (ySlot) ySlot.node.value = Math.round(r.top);
      if (wSlot) wSlot.node.value = Math.round(r.width);
      if (hSlot) hSlot.node.value = Math.round(r.height);
      const childIdx = findShapeChildIdx(ast, slideIdx, span);
      return childIdx !== null
        ? { preserveSelection: { slideIdx, childIdx } }
        : {};
    },
  };
}

