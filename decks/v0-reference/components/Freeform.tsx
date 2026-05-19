// Freeform layout primitive.
//
// Positions children absolutely within the slide's design space. Each
// child is itself responsible for its own positioning (position:
// absolute + top/left); Freeform is just a positioning context with
// position: relative + slide-sized bounds. Per SLIDEWRIGHT.md /
// Primitives, this is the v0 layout primitive for diagram-flavored
// slides where authors place shapes by coordinate rather than by
// stack/grid layout.

import type { ReactNode } from 'react';
import {
  acceptsTargetSlot,
  type ComponentMeta,
  type ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';
import { makeComponent } from '../../../slidewright/runtime/ast-builders.js';
import type { LayoutAdapter } from '../../../slidewright/canvas/layout-adapter.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: {
    children: { type: 'array<block>', required: false },
  },
  params: {},
  protocols: {},
  category: 'Layouts',
  description: 'Absolutely-positioned canvas for free-form diagrams.',
  insertion: {
    gestures: ['drag'],
    stub: (ctx) => {
      if (!acceptsTargetSlot('block', ctx.targetSlotType)) return null;
      return makeComponent('Freeform', []);
    },
  },
};

// Bare layout adapter — makes Freeform selectable in the canvas
// + inspectable in the hierarchy without opting into any gesture
// surface (no reorder, no gap-drag, no own resize handles). Its
// children's adapters handle drag / resize independently.
//
// chainMode: 'transparent' — clicks on a child component (Box,
// TextBox, Arrow) select the child, not the Freeform. Freeform is
// reachable via the hierarchy panel or by clicking on its own
// empty area. Matches the v0 mental model where Freeform is a
// transparent positioning context, not a thing-to-select.
export const canvas: LayoutAdapter = {
  kind: 'layout',
  chainMode: 'transparent',
};

export default function Freeform({ slots }: ComponentRenderProps) {
  const children = (slots.children as ReactNode[] | undefined) ?? [];
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
      }}
    >
      {children}
    </div>
  );
}
