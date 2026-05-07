// v0 reference: a thin VStack layout primitive (the layout primitives
// from SLIDEWRIGHT.md / Primitives are part of v0, but a full set is
// out of scope for v0.0; we ship just enough for the reference deck.
// HStack/ZStack/Grid land as needed when slides demand them).
//
// v0.4 tight cut: VStack participates in the canvas as a selectable
// + inspectable layout. The `canvas: LayoutAdapter` export with just
// the `kind` discriminator gets it into the loader's shapes
// registry; gesture-related methods (Handles, interceptChildDrag,
// etc.) are added in follow-up cuts.

import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import type { LayoutAdapter } from '../../../slidewright/canvas/layout-adapter.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: {
    children: { type: 'array<block>', required: false },
  },
  params: {
    spacing: { type: 'number', default: 24 },
  },
  protocols: {},
};

export const canvas: LayoutAdapter = { kind: 'layout' };

export default function VStack({ slots, params }: ComponentRenderProps) {
  const spacing = (params.spacing as number | undefined) ?? 24;
  const children = (slots.children as ReactNode[] | undefined) ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing }}>
      {children}
    </div>
  );
}
