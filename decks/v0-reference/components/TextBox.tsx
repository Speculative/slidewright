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

import type { ReactNode } from 'react';
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
//
// TextBox is a div like Box (same x/y/width/height slots, same
// drag and resize semantics). The adapter is structurally
// identical — different component name in onCommit's
// findComponentAtSpan, that's it. Future: factor into a shared
// "rectangle adapter" if a third HTML-based shape lands.

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_SIZE = 1;

interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function rectResize(
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
        event.stopPropagation();
        event.preventDefault();
        startHandleDrag(
          makeRectResizeHandle(visualNode, overlay, dir, span, slideIdx),
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

function makeRectResizeHandle(
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
      const r = rectResize(direction, orig, dx, dy);
      visualNode.style.left = `${r.left}px`;
      visualNode.style.top = `${r.top}px`;
      visualNode.style.width = `${r.width}px`;
      visualNode.style.height = `${r.height}px`;
      overlay.style.left = `${r.left - 4}px`;
      overlay.style.top = `${r.top - 4}px`;
      overlay.style.width = `${r.width + 8}px`;
      overlay.style.height = `${r.height + 8}px`;
    },
    onCommit(ast, dx, dy) {
      const r = rectResize(direction, orig, dx, dy);
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
