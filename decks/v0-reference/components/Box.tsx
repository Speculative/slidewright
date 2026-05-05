// Box shape primitive.
//
// Absolutely-positioned rectangle inside a Freeform parent. Position
// (x, y) and size (width, height) are slide-design-space pixels —
// the Freeform parent fills the slide's 1920x1080 frame, so
// `x: 200, y: 200` is roughly upper-left, `x: 1700, y: 980` is lower-
// right.
//
// The drag-to-move gesture (slidewright/canvas/App.tsx) detects Box
// elements via `data-sw-component="Box"` (placed on the loader's
// wrapping div) and mutates the corresponding AST slot fills' values
// before re-emitting.

import type {
  ComponentMeta,
  ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';

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
