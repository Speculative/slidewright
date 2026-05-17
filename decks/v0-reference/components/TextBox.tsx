// TextBox shape primitive.
//
// Absolutely-positioned text container inside a Freeform parent.
// Position (x, y) and size (width, height) are slide-design-space
// pixels — same coordinate system as Box. Content is a text slot
// (single string or styled run), edited via the v0.2.a in-place
// text-edit gesture (double-click).
//
// Canvas behavior identical to Box (translate + 8-handle resize)
// — both share the rect-adapter helper. New text boxes default to
// a "Text" placeholder so the editable span has visible content
// for the user to double-click.

import type { ReactNode } from 'react';
import {
  acceptsTargetSlot,
  type ComponentMeta,
  type ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import {
  makeComponent,
  numberLit,
  slotFill,
  stringLit,
} from '../../../slidewright/runtime/ast-builders.js';
import { makeRectAdapter } from '../../../slidewright/canvas/rect-adapter.js';

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
  category: 'Shapes',
  description: 'Absolutely-positioned text region.',
  insertion: {
    gestures: ['modal'],
    stub: (ctx) => {
      if (!ctx.rect) return null;
      if (!acceptsTargetSlot('block', ctx.targetSlotType)) return null;
      const { x, y, width, height } = ctx.rect;
      // Seed `content: "Text"` so the rendered region has something
      // for the user to double-click into edit mode on. Empty
      // content would render an invisible region (no glyphs to
      // hit).
      return makeComponent('TextBox', [
        slotFill('x', numberLit(Math.round(x))),
        slotFill('y', numberLit(Math.round(y))),
        slotFill('width', numberLit(Math.round(width))),
        slotFill('height', numberLit(Math.round(height))),
        slotFill('content', stringLit('Text')),
      ]);
    },
  },
};

export default function TextBox({ slots, params }: ComponentRenderProps) {
  const x = (params.x as number | undefined) ?? 0;
  const y = (params.y as number | undefined) ?? 0;
  const width = (params.width as number | undefined) ?? 320;
  const height = (params.height as number | undefined) ?? 120;
  const fontSize = (params.fontSize as number | undefined) ?? 32;
  const color = (params.color as string | undefined) ?? 'var(--fg)';
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
        color: color,
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
      }}
    >
      {content}
    </div>
  );
}

export const canvas = makeRectAdapter({ width: 320, height: 120 });
