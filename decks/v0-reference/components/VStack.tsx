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
import {
  acceptsTargetSlot,
  type ComponentMeta,
  type ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import { makeComponent } from '../../../slidewright/runtime/ast-builders.js';
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
  category: 'Layouts',
  description: 'Vertical stack with configurable spacing.',
  insertion: {
    gestures: ['drag'],
    stub: (ctx) => {
      if (!acceptsTargetSlot('block', ctx.targetSlotType)) return null;
      // Empty body — the loader emits a placeholder for `children`
      // (array<block>) so the user can drop more components into
      // the new stack right after creation. No `spacing:` either;
      // the schema default (24) applies.
      return makeComponent('VStack', []);
    },
  },
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
