// v0 reference: ContentSlide custom component. Eyebrow + title + intro
// + a body block. Inspired by design/sketches/three-obstacles.md but
// kept narrow for v0.0 (no card-row composite, no shared column width
// constraint — those depend on cell-model computed defaults landing in
// v0.2+).

import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';

export const slidewright: ComponentMeta = {
  produces: 'slide',
  slots: {
    eyebrow: { type: 'text', required: false },
    title: { type: 'text', required: true },
    intro: { type: 'text', required: false },
    body: { type: 'block', required: false },
  },
  params: {},
  protocols: {},
};

export default function ContentSlide({ slots }: ComponentRenderProps) {
  const eyebrow = slots.eyebrow as ReactNode | undefined;
  const title = slots.title as ReactNode;
  const intro = slots.intro as ReactNode | undefined;
  const body = slots.body as ReactNode | undefined;

  return (
    <>
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <div className="slide-title">{title}</div>
      {intro ? (
        <div style={{ fontSize: 32, marginBottom: 48 }}>{intro}</div>
      ) : null}
      {body}
    </>
  );
}
