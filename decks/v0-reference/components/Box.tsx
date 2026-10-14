// Box shape primitive.
//
// Absolutely-positioned rectangle inside a Freeform parent. Position
// (x, y) and size (width, height) are slide-design-space pixels —
// the Freeform parent fills the slide's 1920x1080 frame.
//
// Canvas behavior (drag-to-move, 8-handle resize) comes from the
// shared rect-adapter. The adapter is purely declarative: the
// loader's ShapeProjection wrapper consumes a gesture context and
// re-renders the Box with adjusted params every frame during a
// gesture; no imperative DOM mutation here.

import {
  acceptsTargetSlot,
  type ComponentMeta,
  type ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import {
  makeComponent,
  numberLit,
  slotFill,
} from '../../../slidewright/runtime/ast-builders.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: {},
  params: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    width: { type: 'number', default: 200 },
    height: { type: 'number', default: 200 },
    fill: { type: 'color-token', default: 'accent' },
    borderWidth: { type: 'number', default: 4 },
    borderColor: { type: 'color-token', default: 'fg' },
    radius: { type: 'number', default: 0 },
  },
  protocols: {},
  category: 'Shapes',
  description: 'Absolutely-positioned rectangle.',
  insertion: {
    // Modal-only: matches the muscle memory of design tools where
    // shape primitives are drawn by drag-rect rather than dropped.
    gestures: ['modal'],
    stub: (ctx) => {
      if (!ctx.rect) return null;
      if (!acceptsTargetSlot('block', ctx.targetSlotType)) return null;
      const { x, y, width, height } = ctx.rect;
      // No `fill:` — the schema default (`accent`) kicks in, so the
      // stub stays deck-agnostic (no assumption that `accent` is a
      // declared token name; the loader's default-wrapping path
      // handles missing tokens via `var(--accent)`).
      return makeComponent('Box', [
        slotFill('x', numberLit(Math.round(x))),
        slotFill('y', numberLit(Math.round(y))),
        slotFill('width', numberLit(Math.round(width))),
        slotFill('height', numberLit(Math.round(height))),
      ]);
    },
  },
};

export default function Box({ params }: ComponentRenderProps) {
  const x = (params.x as number | undefined) ?? 0;
  const y = (params.y as number | undefined) ?? 0;
  const width = (params.width as number | undefined) ?? 200;
  const height = (params.height as number | undefined) ?? 200;
  // CSS color string — `var(--accent)` for token fills, `oklch(...)`
  // for color literals, or any string verbatim. Resolved by the
  // loader; consumed directly.
  const fill = (params.fill as string | undefined) ?? 'var(--accent)';
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        background: fill,
        border: `${Math.max(0, Number(params.borderWidth ?? 4))}px solid ${params.borderColor ?? 'var(--fg, #000)'}`,
        borderRadius: Math.max(0, Number(params.radius ?? 0)),
        boxSizing: 'border-box',
      }}
    />
  );
}

export const canvas = makeRectAdapter({ width: 200, height: 200 });
