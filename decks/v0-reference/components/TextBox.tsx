// TextBox shape primitive.
//
// Absolutely-positioned text container inside a Freeform parent.
// Position (x, y) and size (width, height) are slide-design-space
// pixels — same coordinate system as Box. Content is a text slot
// (single string or styled run), edited via the v0.2.a in-place
// text-edit gesture (double-click).
//
// New text boxes default to a "Text" placeholder so the editable
// span has visible content for the user to double-click. Future
// polish: auto-enter edit mode on creation and drop the
// placeholder.

import type { ReactNode } from 'react';
import type {
  ComponentMeta,
  ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';

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
};

export default function TextBox({ slots, params }: ComponentRenderProps) {
  const x = (params.x as number | undefined) ?? 0;
  const y = (params.y as number | undefined) ?? 0;
  const width = (params.width as number | undefined) ?? 320;
  const height = (params.height as number | undefined) ?? 120;
  const fontSize = (params.fontSize as number | undefined) ?? 32;
  const color = (params.color as string | undefined) ?? 'fg';
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
        color: `var(--${color})`,
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
        // No background by default — text floats over the slide.
        // Adding fill is a future polish (would need another param).
      }}
    >
      {content}
    </div>
  );
}
