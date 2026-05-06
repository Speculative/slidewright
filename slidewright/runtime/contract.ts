// Slide-component contract — the typed shape every Slidewright component
// declares. Per SLIDEWRIGHT.md / Wrapper / contract design (v0-light).
//
// A `.tsx` component module exports:
//   - a `slidewright` const of type `ComponentMeta`
//   - a default React function taking `{ slots, params }`
//
// The loader/validator (loader.ts) consumes ComponentMeta to validate
// DSL slot fillings and dispatch resolved props to the default export.

import type { ReactNode, ComponentType } from 'react';

// ── Type vocabulary (SLIDEWRIGHT.md / "Slot types and `produces` share
// one vocabulary"). v0 ships this fixed set; the vocabulary is
// extensible in later versions, gated on escape-hatch evidence.

export type SlotTypeName =
  | 'text'           // string or (string | Span)+ runs
  | 'block'          // a tree of layout primitives or composite components
  | 'image'          // image reference (URL or asset path)
  | 'slide'          // top-level slide content
  | 'string'
  | 'number'
  | 'boolean'
  | 'color-token'
  | 'spacing-token'
  | 'font-token';

// Container types are encoded as strings of the form `array<T>`. v0
// keeps this parser-light; later we'll likely lift to a structured form.
export type SlotType = SlotTypeName | `array<${SlotTypeName}>`;

export interface SlotSchema {
  type: SlotType;
  required?: boolean;
}

export interface ParamSchema {
  type: SlotType;
  default?: unknown;
}

export interface ComponentMeta {
  produces: SlotTypeName;
  slots: Record<string, SlotSchema>;
  params?: Record<string, ParamSchema>;
  // Reserved for v0; populating is non-breaking.
  protocols?: Record<string, unknown>;
}

// What the editor passes to the default React export. Slot values are
// already resolved against the runtime — text slots arrive as React
// nodes, block slots as React children, image slots as strings, etc.
// (SLIDEWRIGHT.md / "Resolved values at the React boundary").
export interface ComponentRenderProps {
  slots: Record<string, ResolvedSlotValue>;
  params: Record<string, unknown>;
}

export type ResolvedSlotValue =
  | string
  | number
  | boolean
  | null
  | ReactNode
  | ResolvedSlotValue[];

export type SlideComponent = ComponentType<ComponentRenderProps>;

// One module load — the consumer hands these to the loader.
export interface LoadedComponent {
  meta: ComponentMeta;
  render: SlideComponent;
  // Optional canvas-side behavior: drag, resize, selection
  // handles. Components without this can still render but aren't
  // directly manipulable. Type is kept opaque (`unknown`) at the
  // runtime layer so the runtime stays canvas-agnostic; the
  // canvas (slidewright/canvas/App.tsx) casts to the real
  // ShapeAdapter shape.
  canvas?: unknown;
}

// Component registry. The deck's `index.tsx` builds this from its
// `import * as Foo from './components/Foo';` clauses; the loader keys
// invocations by name.
export type ComponentRegistry = Record<string, LoadedComponent>;

// Helper: build a LoadedComponent from a module's namespace import.
// A module is expected to export `slidewright` (metadata) and `default`
// (the React component). It may optionally export `canvas` (the
// canvas adapter — opaque to the runtime, consumed by the canvas).
export function loadComponent(
  mod: {
    slidewright?: ComponentMeta;
    default?: SlideComponent;
    canvas?: unknown;
  },
  name: string,
): LoadedComponent {
  if (!mod.slidewright) {
    throw new Error(
      `component module \`${name}\` is missing the \`slidewright\` metadata export`,
    );
  }
  if (!mod.default) {
    throw new Error(
      `component module \`${name}\` is missing a default React export`,
    );
  }
  return { meta: mod.slidewright, render: mod.default, canvas: mod.canvas };
}

// Convenience: build a registry from a name → module map.
export function buildRegistry(
  modules: Record<string, {
    slidewright?: ComponentMeta;
    default?: SlideComponent;
    canvas?: unknown;
  }>,
): ComponentRegistry {
  const out: ComponentRegistry = {};
  for (const [name, mod] of Object.entries(modules)) {
    out[name] = loadComponent(mod, name);
  }
  return out;
}

// Built-in components have meta but their render path is special-cased
// in the renderer (e.g., `Span` doesn't go through the regular dispatch
// because text-run resolution treats it as data).
export const BUILTIN_META: Record<string, ComponentMeta> = {
  Span: {
    produces: 'text',
    slots: {
      content: { type: 'text', required: true },
    },
    params: {
      color: { type: 'color-token' },
      font: { type: 'font-token' },
      weight: { type: 'string' },
      italic: { type: 'boolean' },
    },
  },
  Deck: {
    produces: 'slide', // not exactly — but Deck is the source-file root,
                       // so its `produces` isn't used. Reserve `slide`.
    slots: {
      slides: { type: 'array<slide>', required: true },
    },
    params: {
      name: { type: 'string' },
      subtitle: { type: 'string' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
  },
};
