// v0 reference: a small composite. A colored card with a two-column
// label/heading + body layout. Used by the three-obstacles content slide
// in the reference deck.

import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: {
    eyebrow: { type: 'text', required: true },
    heading: { type: 'text', required: true },
    body: { type: 'text', required: true },
  },
  params: {
    color: { type: 'color-token', default: 'purple' },
  },
  protocols: {},
};

export default function CardRow({ slots, params }: ComponentRenderProps) {
  const color = (params.color as string | undefined) ?? 'purple';
  const eyebrow = slots.eyebrow as ReactNode;
  const heading = slots.heading as ReactNode;
  const body = slots.body as ReactNode;
  return (
    <div
      className={`card ${color}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '35rem 1fr',
        gap: 48,
        alignItems: 'center',
      }}
    >
      <div>
        <div className="label">{eyebrow}</div>
        <h3 style={{ marginBottom: 0 }}>{heading}</h3>
      </div>
      <div className="body">{body}</div>
    </div>
  );
}
