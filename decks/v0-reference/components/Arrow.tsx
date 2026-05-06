// Arrow shape primitive.
//
// SVG line with arrowhead, drawn from (x1, y1) to (x2, y2) in
// slide-design-space pixels. Each Arrow renders its own SVG layer
// covering the full Freeform — multiple arrows stack as overlapping
// SVGs with `pointer-events: none` so clicks pass through to shapes
// underneath.
//
// Canvas-side gesture behavior:
//   - body translate: same translate delta moves both endpoints
//   - endpoint move: drag tail (1) or tip (2); other endpoint
//     stays fixed; line + arrowhead recompute every render

import type {
  ComponentMeta,
  ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import type {
  HandlesProps,
  ShapeAdapter,
} from '../../../slidewright/canvas/shape-adapter.js';
import {
  computeArrowGeometry,
  findComponentAtSpan,
  findNumericSlot,
  findShapeChildIdx,
} from '../../../slidewright/canvas/ast-edits.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: {},
  params: {
    x1: { type: 'number', default: 0 },
    y1: { type: 'number', default: 0 },
    x2: { type: 'number', default: 200 },
    y2: { type: 'number', default: 200 },
    color: { type: 'color-token', default: 'fg' },
    strokeWidth: { type: 'number', default: 4 },
  },
  protocols: {},
};

export default function Arrow({ params }: ComponentRenderProps) {
  const x1 = (params.x1 as number | undefined) ?? 0;
  const y1 = (params.y1 as number | undefined) ?? 0;
  const x2 = (params.x2 as number | undefined) ?? 200;
  const y2 = (params.y2 as number | undefined) ?? 200;
  const color = (params.color as string | undefined) ?? 'fg';
  const strokeWidth = (params.strokeWidth as number | undefined) ?? 4;
  const head = computeArrowGeometry(x1, y1, x2, y2, strokeWidth);
  // Hit-area stroke width — keeps thin arrows comfortably
  // clickable. Matches the visible stroke for already-thick arrows.
  const hitWidth = Math.max(strokeWidth, 24);

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {/* Visible stroke. Pointer events disabled — the hit-area
        * line below catches clicks within a wider region so thin
        * arrows are still grabbable. */}
      <line
        x1={x1}
        y1={y1}
        x2={head.baseX}
        y2={head.baseY}
        stroke={`var(--${color})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={{ pointerEvents: 'none' }}
      />
      {/* Invisible wider hit area — pointer-events: stroke makes
        * the entire stroked region catchable regardless of color. */}
      <line
        x1={x1}
        y1={y1}
        x2={head.baseX}
        y2={head.baseY}
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
        style={{ pointerEvents: 'stroke' }}
        data-arrow-hit="line"
      />
      <polygon
        points={head.points}
        fill={`var(--${color})`}
        style={{ pointerEvents: 'visiblePainted' }}
      />
    </svg>
  );
}

// ─── Canvas adapter ──────────────────────────────────────────────

interface ArrowEndpoints {
  x1: number; y1: number; x2: number; y2: number;
  strokeWidth: number;
}

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

function paramsToEndpoints(params: Record<string, unknown>): ArrowEndpoints {
  return {
    x1: num(params, 'x1', 0),
    y1: num(params, 'y1', 0),
    x2: num(params, 'x2', 200),
    y2: num(params, 'y2', 200),
    strokeWidth: num(params, 'strokeWidth', 4),
  };
}

export const canvas: ShapeAdapter = {
  calculateBounds(params) {
    const e = paramsToEndpoints(params);
    return {
      left: Math.min(e.x1, e.x2),
      top: Math.min(e.y1, e.y2),
      width: Math.abs(e.x2 - e.x1),
      height: Math.abs(e.y2 - e.y1),
    };
  },

  applyGesture(params, delta) {
    if (delta.kind === 'translate') {
      return {
        ...params,
        x1: num(params, 'x1', 0) + delta.dx,
        y1: num(params, 'y1', 0) + delta.dy,
        x2: num(params, 'x2', 200) + delta.dx,
        y2: num(params, 'y2', 200) + delta.dy,
      };
    }
    if (delta.kind === 'arrow-endpoint') {
      const newX = delta.originalX + delta.dx;
      const newY = delta.originalY + delta.dy;
      if (delta.endpoint === 1) {
        return { ...params, x1: newX, y1: newY };
      }
      return { ...params, x2: newX, y2: newY };
    }
    return params;
  },

  Handles({ params, span, startGesture }: HandlesProps) {
    const e = paramsToEndpoints(params);
    return (
      <>
        <div
          className="sw-resize-handle-shape sw-arrow-endpoint"
          style={{ left: `${e.x1 - 7}px`, top: `${e.y1 - 7}px` }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.preventDefault();
            startGesture(
              {
                kind: 'arrow-endpoint',
                endpoint: 1,
                originalX: e.x1,
                originalY: e.y1,
                fixedX: e.x2,
                fixedY: e.y2,
              },
              event.nativeEvent,
            );
          }}
        />
        <div
          className="sw-resize-handle-shape sw-arrow-endpoint"
          style={{ left: `${e.x2 - 7}px`, top: `${e.y2 - 7}px` }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.preventDefault();
            startGesture(
              {
                kind: 'arrow-endpoint',
                endpoint: 2,
                originalX: e.x2,
                originalY: e.y2,
                fixedX: e.x1,
                fixedY: e.y1,
              },
              event.nativeEvent,
            );
          }}
        />
      </>
    );
    void span;
  },

  commit(ast, span, delta, slideIdx) {
    const target = findComponentAtSpan(ast, span.start, span.end);
    if (!target) return null;
    if (delta.kind === 'translate') {
      const dxR = Math.round(delta.dx);
      const dyR = Math.round(delta.dy);
      for (const slotName of ['x1', 'x2'] as const) {
        const slot = findNumericSlot(target, slotName);
        if (slot) slot.node.value = slot.value + dxR;
      }
      for (const slotName of ['y1', 'y2'] as const) {
        const slot = findNumericSlot(target, slotName);
        if (slot) slot.node.value = slot.value + dyR;
      }
    } else if (delta.kind === 'arrow-endpoint') {
      const newX = Math.round(delta.originalX + delta.dx);
      const newY = Math.round(delta.originalY + delta.dy);
      const xName = delta.endpoint === 1 ? 'x1' : 'x2';
      const yName = delta.endpoint === 1 ? 'y1' : 'y2';
      const xSlot = findNumericSlot(target, xName);
      const ySlot = findNumericSlot(target, yName);
      if (xSlot) xSlot.node.value = newX;
      if (ySlot) ySlot.node.value = newY;
    } else {
      return null;
    }
    const childIdx = findShapeChildIdx(ast, slideIdx, span);
    return childIdx !== null
      ? { preserveSelection: { slideIdx, childIdx } }
      : {};
  },
};
