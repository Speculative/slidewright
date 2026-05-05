// v0 reference: TitleSlide custom component, authored against the
// Slidewright contract (SLIDEWRIGHT.md / Wrapper / contract design).
// Mirrors design/sketches/title-slide.md.

import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';

export const slidewright: ComponentMeta = {
  produces: 'slide',
  slots: {
    venue: { type: 'text', required: true },
    title: { type: 'text', required: true },
    subtitle: { type: 'text', required: false },
    presenter: { type: 'text', required: true },
    affiliation: { type: 'text', required: true },
    headshot: { type: 'image', required: true },
  },
  params: {
    accentColor: { type: 'color-token', default: 'accent' },
  },
  protocols: {},
};

export default function TitleSlide({ slots, params }: ComponentRenderProps) {
  const accentToken = (params.accentColor as string | undefined) ?? 'accent';
  const accent = `var(--${accentToken})`;
  const venue = slots.venue as ReactNode;
  const title = slots.title as ReactNode;
  const subtitle = slots.subtitle as ReactNode | undefined;
  const presenter = slots.presenter as ReactNode;
  const affiliation = slots.affiliation as ReactNode;
  const headshot = slots.headshot as string;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%',
      }}
    >
      <div className="eyebrow" style={{ color: accent }}>
        {venue}
      </div>

      <div>
        <div className="accent-rule" style={{ background: accent }} />
        <div className="title-xl">{title}</div>
        {subtitle ? (
          <div
            style={{
              marginTop: 48,
              fontSize: 36,
              maxWidth: 1500,
              color: 'var(--muted)',
            }}
          >
            <em>{subtitle}</em>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          fontFamily: 'var(--font-mono)',
          fontSize: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img
            src={headshot}
            alt=""
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              objectFit: 'cover',
            }}
          />
          <span>
            {presenter} <span style={{ color: accent }}>·</span> {affiliation}
          </span>
        </div>
      </div>
    </div>
  );
}
