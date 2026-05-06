// v0 reference: a thin HStack layout primitive (mirror of VStack
// with row axis). Lays children out horizontally; `spacing` param
// controls flex gap.
//
// v0.4 tight cut: HStack participates in the canvas as a selectable
// + inspectable layout. The `canvas: LayoutMeta` export gets it into
// the loader's shapes registry; gestures / handles deferred.

import type { ReactNode } from 'react';
import type { ComponentMeta, ComponentRenderProps } from '../../../slidewright/runtime/contract.js';
import type { LayoutMeta } from '../../../slidewright/canvas/layout-meta.js';

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

export const canvas: LayoutMeta = { kind: 'layout' };

export default function HStack({ slots, params }: ComponentRenderProps) {
  const spacing = (params.spacing as number | undefined) ?? 24;
  const children = (slots.children as ReactNode[] | undefined) ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: spacing }}>
      {children}
    </div>
  );
}
