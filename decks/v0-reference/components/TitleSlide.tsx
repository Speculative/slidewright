// v0 reference: TitleSlide custom component, authored against the
// Slidewright contract (SLIDEWRIGHT.md / Wrapper / contract design).
// Mirrors design/sketches/title-slide.md.

import type { ReactNode } from 'react';
import {
  acceptsTargetSlot,
  type ComponentMeta,
  type ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import { makeComponent } from '../../../slidewright/runtime/ast-builders.js';
import type { LayoutAdapter } from '../../../slidewright/canvas/layout-adapter.js';

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
  category: 'Slides',
  description: 'Cover slide with venue / title / presenter.',
  insertion: {
    gestures: ['drag'],
    stub: (ctx) => {
      if (!acceptsTargetSlot('slide', ctx.targetSlotType)) return null;
      // Required slots surface as loader placeholders the user
      // fills via the inspector. Headshot is a string asset path;
      // the user supplies one on first edit.
      return makeComponent('TitleSlide', []);
    },
  },
};

// Selectable + inspectable as a layout — registers TitleSlide in the
// shapes registry so the unified Slide+content panel can resolve its
// meta (the unify path only sees components with a `canvas` export).
export const canvas: LayoutAdapter = { kind: 'layout' };

export default function TitleSlide({ slots, params }: ComponentRenderProps) {
  const accent = (params.accentColor as string | undefined) ?? 'var(--accent)';
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
