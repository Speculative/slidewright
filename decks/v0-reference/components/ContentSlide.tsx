// v0 reference: ContentSlide custom component. Eyebrow + title + intro
// + a body block. Inspired by design/sketches/three-obstacles.md but
// kept narrow for v0.0 (no card-row composite, no shared column width
// constraint — those depend on cell-model computed defaults landing in
// v0.2+).

import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import type { LayoutAdapter } from '../../../slidewright/canvas/layout-adapter.js';

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

// Selectable + inspectable as a layout — exposes the optional slot
// rows to the inspector. Necessary for the omit-toggle UX to reach
// `eyebrow` / `intro` / `body`, since ContentSlide itself needs to
// be the property-panel's subject.
export const canvas: LayoutAdapter = { kind: 'layout' };

export default function ContentSlide({ slots, slotsState }: ComponentRenderProps) {
  const eyebrow = slots.eyebrow as ReactNode | undefined;
  const title = slots.title as ReactNode;
  const intro = slots.intro as ReactNode | undefined;
  const body = slots.body as ReactNode | undefined;

  // `slotState === 'omit'` is the user's explicit "this slot is
  // intentionally empty" sigil — we drop the wrapper div entirely
  // so omitted slots don't reserve vertical / horizontal space.
  // `'missing'` keeps the wrapper around the loader's placeholder
  // so the user has somewhere to click to author into the slot.
  const showEyebrow = slotsState.eyebrow !== 'omit';
  const showIntro = slotsState.intro !== 'omit';
  const showBody = slotsState.body !== 'omit';

  return (
    <>
      {showEyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <div className="slide-title">{title}</div>
      {showIntro ? (
        <div style={{ fontSize: 32, marginBottom: 48 }}>{intro}</div>
      ) : null}
      {showBody ? body : null}
    </>
  );
}
