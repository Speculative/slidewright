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

import type {
  ComponentMeta,
  ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
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

export const canvas = makeRectAdapter({ width: 200, height: 200 });
