// v0 reference: a thin VStack layout primitive (the layout primitives
// from SLIDEWRIGHT.md / Primitives are part of v0, but a full set is
// out of scope for v0.0; we ship just enough for the reference deck.
// HStack/ZStack/Grid land as needed when slides demand them).
//
// v0.4: VStack participates in the canvas as a selectable +
// inspectable layout (since the tight cut) AND as a reorder
// container — drag a child to a new vertical position; commit
// rewrites the parent's `children` slot.

import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import { makeStackAdapter } from '../../../slidewright/canvas/stack-adapter.js';

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

export const canvas = makeStackAdapter({ axis: 'v' });

export default function VStack({ slots, params }: ComponentRenderProps) {
  const spacing = (params.spacing as number | undefined) ?? 24;
  const children = (slots.children as ReactNode[] | undefined) ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing }}>
      {children}
    </div>
  );
}
