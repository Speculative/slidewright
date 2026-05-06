// Arrow shape primitive.
//
// SVG line with arrowhead, drawn from (x1, y1) to (x2, y2) in
// slide-design-space pixels. Each Arrow renders its own SVG layer
// covering the full Freeform — multiple arrows stack as overlapping
// SVGs with `pointer-events: none` so clicks pass through to shapes
// underneath. (When v0.2.i adds endpoint editing, the line itself
// will get pointer-events: visiblePainted.)
//
// Drag-to-move on Arrow isn't supported yet — Arrow doesn't have
// `x` / `y` slot fills, so the drag handler in App skips it. v0.2.i
// will add endpoint-drag handles that move x1/y1 and x2/y2
// independently.

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

  // Compute the arrowhead geometry: a triangle at (x2, y2) rotated
  // to align with the line direction. The line stops at the base
  // of the arrowhead so the stroke doesn't bleed past the tip.
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(12, strokeWidth * 3);
  const halfWidth = head * 0.6;
  const baseX = x2 - head * Math.cos(angle);
  const baseY = y2 - head * Math.sin(angle);
  const lx = -Math.sin(angle) * halfWidth;
  const ly = Math.cos(angle) * halfWidth;
  const px1 = baseX + lx;
  const py1 = baseY + ly;
  const px2 = baseX - lx;
  const py2 = baseY - ly;

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
        x2={baseX}
        y2={baseY}
        stroke={`var(--${color})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={{ pointerEvents: 'none' }}
      />
      {/* Invisible wider hit area — `pointer-events: stroke` makes
        * the entire stroked region catchable regardless of color.
        * Stays transparent so it doesn't dim the visible line. The
        * canvas's selection / drag dispatch (App.tsx → ScaledCanvas
        * → DRAGGABLE_SELECTOR) walks the closest data-sw-component
        * ancestor, which works the same whether the click landed on
        * the visible or hit-area stroke. */}
      <line
        x1={x1}
        y1={y1}
        x2={baseX}
        y2={baseY}
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
        style={{ pointerEvents: 'stroke' }}
        data-arrow-hit="line"
      />
      <polygon
        points={`${x2},${y2} ${px1},${py1} ${px2},${py2}`}
        fill={`var(--${color})`}
        style={{ pointerEvents: 'visiblePainted' }}
      />
    </svg>
  );
}

// ─── Canvas adapter ──────────────────────────────────────────────
//
// Arrow's geometry is fundamentally different from Box / TextBox:
// the visible bits are an SVG line ending at the arrowhead BASE
// plus a polygon (the head) anchored at the actual tip. There's no
// CSS left/top — the shape's "position" lives in slot fills
// x1/y1/x2/y2, and the SVG itself fills the entire Freeform with
// pointer-events:none so it doesn't shadow other shapes.
//
// Body drag: translate all four endpoints by the same delta.
// Imperatively rewrite the line + polygon attrs each frame
// (re-running the arrowhead geometry so the head re-aligns as the
// shape moves through the design space). CSS transform was tried
// in v0.2.i.2 and stuck on the SVG element across React renders,
// so attribute updates are the way.
//
// Endpoint handles: two grips at (x1, y1) and (x2, y2). Dragging
// one moves only that endpoint; the other stays fixed. Mounted
// directly on the freeform (not the overlay) since endpoints can
// be anywhere within the bounding rect, not just on its corners.

interface ArrowEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
}

// Read the arrow's current endpoints + stroke from its rendered
// SVG. Used by both gesture flavors at start-time so each captures
// stable original values.
function readEndpoints(svg: SVGSVGElement): ArrowEndpoints | null {
  const lineEls = Array.from(svg.querySelectorAll('line'));
  const polyEl = svg.querySelector('polygon');
  if (lineEls.length === 0 || !polyEl) return null;
  const firstLine = lineEls[0]!;
  const x1 = parseFloat(firstLine.getAttribute('x1') ?? '0');
  const y1 = parseFloat(firstLine.getAttribute('y1') ?? '0');
  const strokeWidth = parseFloat(
    firstLine.getAttribute('stroke-width') ?? '4',
  );
  // x2/y2 in the line is the arrowhead BASE (so the visible stroke
  // doesn't overlap the head). The actual tip is the polygon's
  // first vertex — `${x2},${y2} ${px1},${py1} ${px2},${py2}`.
  const polyPoints = polyEl.getAttribute('points') ?? '';
  const firstVertex = polyPoints.split(/\s+/)[0] ?? '0,0';
  const [tipXStr, tipYStr] = firstVertex.split(',');
  const x2 = parseFloat(tipXStr ?? '0');
  const y2 = parseFloat(tipYStr ?? '0');
  return { x1, y1, x2, y2, strokeWidth };
}

// Update both line elements (visible + hit-area) and the polygon
// to reflect a new (x1, y1) → (x2, y2) configuration. Used by
// both body drag and endpoint resize during onMove.
function paintEndpoints(
  svg: SVGSVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth: number,
): void {
  const lineEls = Array.from(svg.querySelectorAll('line'));
  const polyEl = svg.querySelector('polygon');
  if (!polyEl) return;
  const head = computeArrowGeometry(x1, y1, x2, y2, strokeWidth);
  for (const l of lineEls) {
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(head.baseX));
    l.setAttribute('y2', String(head.baseY));
  }
  polyEl.setAttribute('points', head.points);
}

export const canvas: ShapeAdapter = {
  bounds(visualNode) {
    if (!(visualNode instanceof SVGSVGElement)) return null;
    const ep = readEndpoints(visualNode);
    if (!ep) return null;
    return {
      left: Math.min(ep.x1, ep.x2),
      top: Math.min(ep.y1, ep.y2),
      width: Math.abs(ep.x2 - ep.x1),
      height: Math.abs(ep.y2 - ep.y1),
    };
  },

  startBodyDrag(ctx) {
    if (!(ctx.visualNode instanceof SVGSVGElement)) {
      return { onMove: () => {}, onCommit: () => null };
    }
    const svg = ctx.visualNode;
    const ep = readEndpoints(svg);
    if (!ep) return { onMove: () => {}, onCommit: () => null };
    const { span, slideIdx, getOverlay } = ctx;

    return {
      onMove(dx, dy) {
        const newX1 = ep.x1 + dx;
        const newY1 = ep.y1 + dy;
        const newX2 = ep.x2 + dx;
        const newY2 = ep.y2 + dy;
        paintEndpoints(svg, newX1, newY1, newX2, newY2, ep.strokeWidth);
        const overlay = getOverlay();
        if (overlay) {
          const minX = Math.min(newX1, newX2);
          const minY = Math.min(newY1, newY2);
          const maxX = Math.max(newX1, newX2);
          const maxY = Math.max(newY1, newY2);
          overlay.style.left = `${minX - 4}px`;
          overlay.style.top = `${minY - 4}px`;
          overlay.style.width = `${maxX - minX + 8}px`;
          overlay.style.height = `${maxY - minY + 8}px`;
        }
        // Endpoint handles, if rendered, follow each endpoint.
        // Order is [tail (1), tip (2)] per renderHandles below.
        const handles = document.querySelectorAll<HTMLElement>(
          '.sw-canvas-stage .sw-arrow-endpoint',
        );
        if (handles.length >= 2) {
          handles[0]!.style.left = `${newX1 - 7}px`;
          handles[0]!.style.top = `${newY1 - 7}px`;
          handles[1]!.style.left = `${newX2 - 7}px`;
          handles[1]!.style.top = `${newY2 - 7}px`;
        }
      },
      onCommit(ast, dx, dy) {
        const target = findComponentAtSpan(ast, span.start, span.end);
        if (!target) return null;
        const dxR = Math.round(dx);
        const dyR = Math.round(dy);
        for (const slotName of ['x1', 'x2'] as const) {
          const slot = findNumericSlot(target, slotName);
          if (slot) slot.node.value = slot.value + dxR;
        }
        for (const slotName of ['y1', 'y2'] as const) {
          const slot = findNumericSlot(target, slotName);
          if (slot) slot.node.value = slot.value + dyR;
        }
        const childIdx = findShapeChildIdx(ast, slideIdx, span);
        return childIdx !== null
          ? { preserveSelection: { slideIdx, childIdx } }
          : {};
      },
    };
  },

  renderHandles(ctx) {
    const { overlay, visualNode, span, slideIdx, startHandleDrag } = ctx;
    if (!(visualNode instanceof SVGSVGElement)) return () => {};
    const ep = readEndpoints(visualNode);
    if (!ep) return () => {};

    // Mount handles on the freeform (sibling to the arrow's SVG)
    // rather than the overlay, since endpoints can sit anywhere in
    // the bounding rect.
    const freeformDiv = overlay.parentElement;
    if (!(freeformDiv instanceof HTMLElement)) return () => {};

    const handles: HTMLElement[] = [];

    const setupEndpoint = (
      endpoint: 1 | 2,
      movingX: number,
      movingY: number,
      fixedX: number,
      fixedY: number,
    ): void => {
      const handle = document.createElement('div');
      handle.className = 'sw-resize-handle-shape sw-arrow-endpoint';
      handle.style.left = `${movingX - 7}px`;
      handle.style.top = `${movingY - 7}px`;
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        startHandleDrag(
          makeArrowEndpointHandle(
            visualNode,
            overlay,
            handle,
            endpoint,
            { x: movingX, y: movingY },
            { x: fixedX, y: fixedY },
            ep.strokeWidth,
            span,
            slideIdx,
          ),
          event,
        );
      });
      freeformDiv.appendChild(handle);
      handles.push(handle);
    };

    setupEndpoint(1, ep.x1, ep.y1, ep.x2, ep.y2);
    setupEndpoint(2, ep.x2, ep.y2, ep.x1, ep.y1);

    return () => {
      for (const h of handles) h.remove();
    };
  },
};

function makeArrowEndpointHandle(
  svg: SVGSVGElement,
  overlay: HTMLElement,
  handle: HTMLElement,
  endpoint: 1 | 2,
  moving: { x: number; y: number },
  fixed: { x: number; y: number },
  strokeWidth: number,
  span: ShapeSpan,
  slideIdx: number,
): GestureHandle {
  return {
    onMove(dx, dy) {
      const newX = moving.x + dx;
      const newY = moving.y + dy;
      const x1 = endpoint === 1 ? newX : fixed.x;
      const y1 = endpoint === 1 ? newY : fixed.y;
      const x2 = endpoint === 1 ? fixed.x : newX;
      const y2 = endpoint === 1 ? fixed.y : newY;
      paintEndpoints(svg, x1, y1, x2, y2, strokeWidth);
      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      const maxX = Math.max(x1, x2);
      const maxY = Math.max(y1, y2);
      overlay.style.left = `${minX - 4}px`;
      overlay.style.top = `${minY - 4}px`;
      overlay.style.width = `${maxX - minX + 8}px`;
      overlay.style.height = `${maxY - minY + 8}px`;
      handle.style.left = `${newX - 7}px`;
      handle.style.top = `${newY - 7}px`;
    },
    onCommit(ast, dx, dy) {
      const target = findComponentAtSpan(ast, span.start, span.end);
      if (!target) return null;
      const newX = Math.round(moving.x + dx);
      const newY = Math.round(moving.y + dy);
      const xName = endpoint === 1 ? 'x1' : 'x2';
      const yName = endpoint === 1 ? 'y1' : 'y2';
      const xSlot = findNumericSlot(target, xName);
      const ySlot = findNumericSlot(target, yName);
      if (xSlot) xSlot.node.value = newX;
      if (ySlot) ySlot.node.value = newY;
      const childIdx = findShapeChildIdx(ast, slideIdx, span);
      return childIdx !== null
        ? { preserveSelection: { slideIdx, childIdx } }
        : {};
    },
  };
}
