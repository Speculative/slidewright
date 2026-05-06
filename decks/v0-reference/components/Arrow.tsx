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
