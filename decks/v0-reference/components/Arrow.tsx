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

import {
  acceptsTargetSlot,
  type ComponentMeta,
  type ComponentRenderProps,
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
import {
  makeComponent,
  numberLit,
  slotFill,
} from '../../../slidewright/runtime/ast-builders.js';

export function lineMetadata(name: 'Line' | 'Arrow'): ComponentMeta {
  return {
    produces: 'block',
    slots: {},
    params: {
      x1: { type: 'number', default: 0 },
      y1: { type: 'number', default: 0 },
      x2: { type: 'number', default: 200 },
      y2: { type: 'number', default: 200 },
      color: { type: 'color-token', default: 'fg' },
      strokeWidth: { type: 'number', default: 4 },
      startHead: { type: 'string', default: 'none', choices: ['none', 'arrow', 'circle'] },
      endHead: { type: 'string', default: name === 'Arrow' ? 'arrow' : 'none', choices: ['none', 'arrow', 'circle'] },
    },
    protocols: {},
    category: 'Shapes',
    description: 'Line between two points with configurable heads at either end.',
    insertion: {
      gestures: ['modal'],
      shortcut: name === 'Arrow' ? 'Shift+E' : 'E',
      modalPreview: 'line',
      stub: (ctx) => {
        if (!acceptsTargetSlot('block', ctx.targetSlotType)) return null;
        // Arrow reads the unnormalized drag vector so the tail lands
        // at the pointerdown point and the tip at the release point
        // — direction matters for the arrowhead. Falls back to the
        // normalized rect's diagonal if dragStart/dragEnd weren't
        // supplied (e.g., a drag-from-toolbar drop with no draw
        // gesture); falls back to null if neither is present.
        if (ctx.dragStart && ctx.dragEnd) {
          return makeComponent(name, [
            slotFill('x1', numberLit(Math.round(ctx.dragStart.x))),
            slotFill('y1', numberLit(Math.round(ctx.dragStart.y))),
            slotFill('x2', numberLit(Math.round(ctx.dragEnd.x))),
            slotFill('y2', numberLit(Math.round(ctx.dragEnd.y))),
          ]);
        }
        if (!ctx.rect) return null;
        const { x, y, width, height } = ctx.rect;
        return makeComponent(name, [
          slotFill('x1', numberLit(Math.round(x))),
          slotFill('y1', numberLit(Math.round(y))),
          slotFill('x2', numberLit(Math.round(x + width))),
          slotFill('y2', numberLit(Math.round(y + height))),
        ]);
      },
    },
  };
}

export const slidewright = lineMetadata('Arrow');

export default function Arrow({ params }: ComponentRenderProps) {
  const x1 = (params.x1 as number | undefined) ?? 0;
  const y1 = (params.y1 as number | undefined) ?? 0;
  const x2 = (params.x2 as number | undefined) ?? 200;
  const y2 = (params.y2 as number | undefined) ?? 200;
  const color = (params.color as string | undefined) ?? 'var(--fg)';
  const strokeWidth = (params.strokeWidth as number | undefined) ?? 4;
  const startHead = params.startHead ?? 'none';
  const endHead = params.endHead ?? 'arrow';
  const start = computeArrowGeometry(x2, y2, x1, y1, strokeWidth);
  const end = computeArrowGeometry(x1, y1, x2, y2, strokeWidth);
  const radius = Math.max(6, strokeWidth * 1.5);
  const headAt = (kind: unknown, x: number, y: number, points: string, key: string) => {
    if (kind === 'arrow') {
      return <polygon key={key} data-line-head={key} points={points}
        fill={color} style={{ pointerEvents: 'visiblePainted' }} />;
    }
    if (kind === 'circle') {
      return <circle key={key} data-line-head={key} cx={x} cy={y} r={radius}
        fill={color} style={{ pointerEvents: 'visiblePainted' }} />;
    }
    return null;
  };
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
        x1={startHead === 'arrow' ? start.baseX : x1}
        y1={startHead === 'arrow' ? start.baseY : y1}
        x2={endHead === 'arrow' ? end.baseX : x2}
        y2={endHead === 'arrow' ? end.baseY : y2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={{ pointerEvents: 'none' }}
      />
      {/* Invisible wider hit area — pointer-events: stroke makes
        * the entire stroked region catchable regardless of color. */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
        style={{ pointerEvents: 'stroke' }}
        data-arrow-hit="line"
      />
      {headAt(startHead, x1, y1, start.points, 'start')}
      {headAt(endHead, x2, y2, end.points, 'end')}
    </svg>
  );
}

// ─── Canvas adapter ──────────────────────────────────────────────

interface ArrowEndpoints {
  x1: number; y1: number; x2: number; y2: number;
  strokeWidth: number;
}

// Arrow-adapter's internal opaque-channel types. The bespoke
// gesture for arrows is `arrow-endpoint` — drag tail (1) or tip
// (2); the other endpoint stays fixed.
interface ArrowInit {
  kind: 'arrow-endpoint';
  endpoint: 1 | 2;
  originalX: number;
  originalY: number;
  fixedX: number;
  fixedY: number;
}

interface ArrowGestureState {
  kind: 'arrow-endpoint';
  endpoint: 1 | 2;
  originalX: number;
  originalY: number;
  fixedX: number;
  fixedY: number;
}

interface ArrowDelta {
  kind: 'arrow-endpoint';
  endpoint: 1 | 2;
  originalX: number;
  originalY: number;
  fixedX: number;
  fixedY: number;
  dx: number;
  dy: number;
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
    if (delta.kind === 'transform') {
      // Both endpoints transform under the same matrix, so an arrow
      // inside a group resize scales / shifts as a rigid body.
      return {
        ...params,
        x1: delta.sx * num(params, 'x1', 0) + delta.tx,
        y1: delta.sy * num(params, 'y1', 0) + delta.ty,
        x2: delta.sx * num(params, 'x2', 200) + delta.tx,
        y2: delta.sy * num(params, 'y2', 200) + delta.ty,
      };
    }
    const inner = delta.delta as ArrowDelta | null;
    if (inner && inner.kind === 'arrow-endpoint') {
      const newX = inner.originalX + inner.dx;
      const newY = inner.originalY + inner.dy;
      if (inner.endpoint === 1) {
        return { ...params, x1: newX, y1: newY };
      }
      return { ...params, x2: newX, y2: newY };
    }
    return params;
  },

  buildGestureState(init) {
    const cast = init as ArrowInit | null;
    if (!cast || cast.kind !== 'arrow-endpoint') return null;
    const state: ArrowGestureState = {
      kind: 'arrow-endpoint',
      endpoint: cast.endpoint,
      originalX: cast.originalX,
      originalY: cast.originalY,
      fixedX: cast.fixedX,
      fixedY: cast.fixedY,
    };
    return state;
  },

  combineGestureState(state, dx, dy) {
    const cast = state as ArrowGestureState | null;
    if (!cast || cast.kind !== 'arrow-endpoint') return null;
    const out: ArrowDelta = {
      kind: 'arrow-endpoint',
      endpoint: cast.endpoint,
      originalX: cast.originalX,
      originalY: cast.originalY,
      fixedX: cast.fixedX,
      fixedY: cast.fixedY,
      dx,
      dy,
    };
    return out;
  },

  Handles({ params, span, startGesture }: HandlesProps) {
    const e = paramsToEndpoints(params);
    const init1: ArrowInit = {
      kind: 'arrow-endpoint',
      endpoint: 1,
      originalX: e.x1,
      originalY: e.y1,
      fixedX: e.x2,
      fixedY: e.y2,
    };
    const init2: ArrowInit = {
      kind: 'arrow-endpoint',
      endpoint: 2,
      originalX: e.x2,
      originalY: e.y2,
      fixedX: e.x1,
      fixedY: e.y1,
    };
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
              { kind: 'opaque', span, init: init1 },
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
              { kind: 'opaque', span, init: init2 },
              event.nativeEvent,
            );
          }}
        />
      </>
    );
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
    } else if (delta.kind === 'transform') {
      const x1Slot = findNumericSlot(target, 'x1');
      const y1Slot = findNumericSlot(target, 'y1');
      const x2Slot = findNumericSlot(target, 'x2');
      const y2Slot = findNumericSlot(target, 'y2');
      if (x1Slot) x1Slot.node.value = Math.round(delta.sx * x1Slot.value + delta.tx);
      if (y1Slot) y1Slot.node.value = Math.round(delta.sy * y1Slot.value + delta.ty);
      if (x2Slot) x2Slot.node.value = Math.round(delta.sx * x2Slot.value + delta.tx);
      if (y2Slot) y2Slot.node.value = Math.round(delta.sy * y2Slot.value + delta.ty);
    } else {
      const inner = delta.delta as ArrowDelta | null;
      if (!inner || inner.kind !== 'arrow-endpoint') return null;
      const newX = Math.round(inner.originalX + inner.dx);
      const newY = Math.round(inner.originalY + inner.dy);
      const xName = inner.endpoint === 1 ? 'x1' : 'x2';
      const yName = inner.endpoint === 1 ? 'y1' : 'y2';
      const xSlot = findNumericSlot(target, xName);
      const ySlot = findNumericSlot(target, yName);
      if (xSlot) xSlot.node.value = newX;
      if (ySlot) ySlot.node.value = newY;
    }
    const childIdx = findShapeChildIdx(ast, slideIdx, span);
    return childIdx !== null
      ? { preserveSelection: { slideIdx, childIdx } }
      : {};
  },
};
