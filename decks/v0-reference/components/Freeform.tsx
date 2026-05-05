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
import type {
  ComponentMeta,
  ComponentRenderProps,
} from '../../../slidewright/runtime/contract.js';

export const slidewright: ComponentMeta = {
  produces: 'block',
  slots: {
    children: { type: 'array<block>', required: false },
  },
  params: {},
  protocols: {},
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
