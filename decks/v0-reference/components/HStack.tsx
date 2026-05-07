// v0 reference: a thin HStack layout primitive (mirror of VStack
// with row axis). Lays children out horizontally; `spacing` param
// controls flex gap.
//
// v0.4: HStack participates in the canvas as a selectable +
// inspectable layout (since the tight cut) AND as a reorder
// container — drag a child to a new horizontal position; commit
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

export const canvas = makeStackAdapter({ axis: 'h' });

export default function HStack({ slots, params }: ComponentRenderProps) {
  const spacing = (params.spacing as number | undefined) ?? 24;
  const children = (slots.children as ReactNode[] | undefined) ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: spacing }}>
      {children}
    </div>
  );
}
