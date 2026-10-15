import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import type { ShapeAdapter } from '../../../slidewright/canvas/shape-adapter.js';

// Groups establish a local positioning context without changing their members.
// Resize members after drilling in; the group itself supports translation.
export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: { children: { type: 'array<block>', required: false } },
  params: {
    x: { type: 'number', default: 0 },
    y: { type: 'number', default: 0 },
    width: { type: 'number', default: 1 },
    height: { type: 'number', default: 1 },
  },
  protocols: {},
  editor: { inspector: ['x', 'y'] },
};

const rect = makeRectAdapter({ width: 1, height: 1 });
export const canvas: ShapeAdapter = {
  ...rect,
  supportsTransform: false,
  Handles: () => null,
  applyGesture: (params: Record<string, unknown>, delta: Parameters<typeof rect.applyGesture>[1]) =>
    delta.kind === 'translate' ? rect.applyGesture(params, delta) : params,
  commit: (...args: Parameters<typeof rect.commit>) => args[2].kind === 'translate' ? rect.commit(...args) : null,
};

export default function Group({ params, slots }: ComponentRenderProps) {
  return <div style={{ position: 'absolute', left: Number(params.x), top: Number(params.y),
    width: Number(params.width), height: Number(params.height) }}>
    {slots.children as ReactNode}
  </div>;
}
