import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';
import type { ShapeAdapter } from '../../../slidewright/canvas/shape-adapter.js';
import { isLayoutAdapter } from '../../../slidewright/canvas/layout-adapter.js';

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
  bindChildren: children => ({
    ...canvas,
    calculateBounds: params => {
      const bounds = children.flatMap(child => {
        if (isLayoutAdapter(child.canvas)) return [];
        const bounds = (child.canvas as ShapeAdapter).calculateBounds(child.params);
        return bounds ? [bounds] : [];
      });
      if (!bounds.length) return rect.calculateBounds(params);
      const left = Math.min(...bounds.map(b => b.left));
      const top = Math.min(...bounds.map(b => b.top));
      return {
        left: Number(params.x) + left,
        top: Number(params.y) + top,
        width: Math.max(...bounds.map(b => b.left + b.width)) - left,
        height: Math.max(...bounds.map(b => b.top + b.height)) - top,
      };
    },
  }),
  applyGesture: (params: Record<string, unknown>, delta: Parameters<typeof rect.applyGesture>[1]) =>
    delta.kind === 'translate' ? rect.applyGesture(params, delta) : params,
  commit: (...args: Parameters<typeof rect.commit>) => args[2].kind === 'translate' ? rect.commit(...args) : null,
};

export default function Group({ params, slots }: ComponentRenderProps) {
  // This is a positioning origin, not an independently sized frame.
  return <div style={{ position: 'absolute', left: Number(params.x), top: Number(params.y) }}>
    {slots.children as ReactNode}
  </div>;
}
