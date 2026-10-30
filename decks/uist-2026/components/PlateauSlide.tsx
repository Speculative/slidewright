import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import type { LayoutAdapter } from '../../../slidewright/canvas/layout-adapter.js';
// Full-slide positioning context keeps authored object coordinates independent
// of host chrome/safe-area padding. All children remain normal canvas objects.
export const slidewright: ComponentMeta = { produces: 'slide', slots: { content: { type: 'block', required: true } }, params: { branding: { type: 'boolean', default: false } } };
export const canvas: LayoutAdapter = { kind: 'layout', chainMode: 'transparent' };
export default function PlateauSlide({ slots, params }: ComponentRenderProps) {
  return <div data-sw-plateau-slide data-sw-branding={params.branding ? 'light' : undefined} style={{ position: 'absolute', inset: 0, background: 'white', color: 'var(--uist-ink, #111)', fontFamily: 'var(--font-body, sans-serif)' }}>{slots.content as ReactNode}</div>;
}
