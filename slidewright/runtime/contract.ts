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
import type { Component as AstComponent } from './ast.js';

// ── Type vocabulary (SLIDEWRIGHT.md / "Slot types and `produces` share
// one vocabulary"). v0 ships this fixed set; the vocabulary is
// extensible in later versions, gated on escape-hatch evidence.

export type SlotTypeName =
  | 'text'           // inline strings, Spans, and registered inline elements
  | 'text-document'  // ordered Paragraph/List blocks; string migration shorthand
  | 'list-item'      // ListItem, accepted only within List.items
  | 'block'          // a tree of layout primitives or composite components
  | 'image'          // image reference (URL or asset path)
  | 'slide'          // top-level slide content
  | 'slide-content'  // Slide.content accepts a block or a slide component
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

  // ── Editor presentation + insertion (optional) ────────────────
  // These fields are consumed by the canvas toolbar / insertion
  // pipeline. Components that omit `insertion` don't appear in the
  // toolbar — they're authored in source only. Builtins (Span,
  // Tokens, Deck, Slide) intentionally don't set these.

  // Toolbar grouping. Sibling components share a section; the
  // string is the section title verbatim. Free-form so deck
  // authors can introduce new categories without touching runtime.
  category?: string;

  // One-line description for tooltips / search.
  description?: string;

  // Insertion factory. Present iff the component is directly
  // insertable from the toolbar. See InsertionContext below for
  // the call shape.
  insertion?: ComponentInsertion;

  // Inline editing ownership is independent of rendering and inspector
  // presentation. Omitted contracts are atomic in the outer text editor.
  inlineEditing?: InlineEditing;
  // Inspector membership is presentation metadata, independent of schema.
  editor?: { inspector: readonly string[] };
}

export type InlineEditing =
  | { mode: 'leaf' }
  | { mode: 'transparent'; contentSlot: string }
  | { mode: 'owned'; mount?: OwnedInlineEditorMount };

export interface OwnedInlineEditorContext {
  component: AstComponent;
  // Replace this occurrence through the element's explicit write-back
  // contract. The outer editor never guesses from its displayed text.
  onChange(component: AstComponent): void;
  exit(direction: -1 | 1): void;
}

export type OwnedInlineEditorMount = (
  container: HTMLElement,
  context: OwnedInlineEditorContext,
) => { destroy(): void; update?(component: AstComponent): void };

// What the editor passes when invoking `insertion.stub`. The stub
// either returns a fresh `Component` AST node ready to splice into
// the target, or `null` to signal the context can't satisfy this
// component (e.g., a Box dragged onto a slot that doesn't expose a
// rect; a slide-content component dropped onto a `block` slot).
// Returning null is the principled way to opt out of a particular
// drop; the toolbar uses it to dim incompatible entries during a
// drag.
export interface InsertionContext {
  // Which toolbar gesture initiated this insertion. Components
  // can branch on the gesture if they support both modes (most
  // don't — they opt into exactly one via `insertion.gestures`).
  gesture: 'drag' | 'modal';
  // The declared slot type at the drop target. Includes `array<…>`
  // forms for array slots.
  targetSlotType: SlotType;
  // Slide-design-space rectangle for the drop. Present when the
  // drop landed on a Freeform (rect from the modal draw or from
  // the drag's release point) — required by shape primitives that
  // need geometry. Absent for layout-stack drops, where the
  // component self-sizes. Always normalized: width/height ≥ 0.
  rect?: { x: number; y: number; width: number; height: number };
  // Raw drag-direction vector — pointerdown landing → release
  // point — without normalization. Present iff `rect` is present
  // for a modal-draw gesture; components that care about direction
  // (Arrow: tail→tip) read these instead of `rect`. For
  // drag-from-toolbar drops onto a Freeform there's no meaningful
  // drag vector, so these may be absent even when `rect` is
  // present (treated as a single point or a default-sized rect).
  dragStart?: { x: number; y: number };
  dragEnd?: { x: number; y: number };
  // Insertion index within an `array<…>` slot. Present for
  // gap-drag drops on array slots; absent for empty-slot drops
  // (which always splice as the slot's first/only fill).
  insertionIndex?: number;
}

// Convenience: does a component that produces `produces` satisfy
// a slot of type `targetSlotType`? True when the slot's type is
// the produced type directly, or `array<that-type>` for list slots.
// Slide.content also accepts ordinary blocks as its slide body.
// Used by `insertion.stub` implementations to gate-out incompatible
// drop targets in one line, and by the toolbar to dim incompatible
// entries during a drag.
export function acceptsTargetSlot(
  produces: SlotTypeName,
  targetSlotType: SlotType,
): boolean {
  const target = targetSlotType.startsWith('array<')
    ? targetSlotType.slice(6, -1)
    : targetSlotType;
  return target === produces ||
    (target === 'slide-content' && (produces === 'block' || produces === 'slide'));
}

export interface ComponentInsertion {
  // Which toolbar gestures expose this component:
  //   'modal' — click toolbar → modal cursor → drag-rect on Freeform.
  //   'drag'  — pointerdown on toolbar entry starts a drag; release
  //             on a valid drop target commits.
  // A component may opt into both; freeform shape primitives
  // ship as ['modal'] (matches design-tool muscle memory),
  // layouts as ['drag'].
  gestures: ('drag' | 'modal')[];

  // Build the AST node to splice. The runtime layer doesn't
  // assume any particular AST shape — the stub returns whatever
  // is appropriate (typically a `Component` invocation, but
  // `null` to refuse).
  stub: (ctx: InsertionContext) => AstComponent | null;

  // Shape of the live preview overlay drawn during a modal-draw
  // gesture. 'rect' draws the dashed bounding rectangle (Box,
  // TextBox, layouts); 'line' draws a dashed line from
  // dragStart to dragEnd (Arrow). Defaults to 'rect' when
  // unspecified. Ignored for components that don't opt into the
  // modal gesture.
  modalPreview?: 'rect' | 'line';
}

// Whether a slot was filled, missing entirely, or explicitly
// omitted via the `omit` sigil. Components can branch on this to
// distinguish "user said this slot is intentionally empty" (omit)
// from "user hasn't filled it yet" (missing — the editor surfaces
// a placeholder for renderable slot types). Both `missing` and
// `omit` arrive in `slots[name]` as undefined or as the loader's
// placeholder ReactNode; reading state is the principled way to
// tell them apart for structural rendering decisions.
export type SlotState = 'filled' | 'missing' | 'omit';

// What the editor passes to the default React export. Slot values are
// already resolved against the runtime — text slots arrive as React
// nodes, block slots as React children, image slots as strings, etc.
// (SLIDEWRIGHT.md / "Resolved values at the React boundary").
export interface ComponentRenderProps {
  slots: Record<string, ResolvedSlotValue>;
  params: Record<string, unknown>;
  // Per-slot fill state — components opt in by reading specific
  // names. Components that ignore this keep working unchanged.
  slotsState: Record<string, SlotState>;
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
// in the renderer (e.g., inline text structures don't go through regular
// registry dispatch because text-value resolution treats them as data).
export const PARAGRAPH_FIELDS = ['spaceBefore', 'spaceAfter', 'align', 'lineHeight', 'indent', 'firstLineIndent'] as const;
const paragraphParams: Record<string, ParamSchema> = {
  spaceBefore: { type: 'number', default: 0 },
  spaceAfter: { type: 'number', default: 0 },
  align: { type: 'string' },
  lineHeight: { type: 'number' },
  indent: { type: 'number', default: 0 },
  firstLineIndent: { type: 'number', default: 0 },
};

export const BUILTIN_META: Record<string, ComponentMeta> = {
  Span: {
    editor: { inspector: [] },
    produces: 'text',
    slots: {
      content: { type: 'text', required: true },
    },
    params: {
      color: { type: 'color-token' },
      font: { type: 'font-token' },
      size: { type: 'number' },
      weight: { type: 'string' },
      letterSpacing: { type: 'number' },
      strokeWidth: { type: 'number' },
      strokeColor: { type: 'color-token' },
      italic: { type: 'boolean' },
      underline: { type: 'boolean' },
      strikethrough: { type: 'boolean' },
      href: { type: 'string' },
    },
  },
  List: {
    produces: 'text-document',
    slots: {
      items: { type: 'array<list-item>', required: true },
    },
    params: {
      style: { type: 'string', default: 'disc' },
      start: { type: 'number', default: 1 },
    },
  },
  ListItem: {
    produces: 'list-item',
    slots: {
      content: { type: 'text', required: true },
      children: { type: 'text-document', required: false },
    },
    params: paragraphParams,
  },
  Paragraph: {
    produces: 'text-document',
    slots: { content: { type: 'text', required: true } },
    params: paragraphParams,
  },
  Deck: {
    produces: 'slide', // not exactly — but Deck is the source-file root,
                       // so its `produces` isn't used. Reserve `slide`.
    slots: {
      slides: { type: 'array<slide>', required: true },
      // Source-declared color tokens. The fill, when present, must be
      // a `Tokens { ... }` invocation; the loader special-cases this
      // slot rather than going through `renderBlockValue` so the
      // Tokens body's open-schema fills don't have to match any
      // declared slots (Tokens lets the user invent token names).
      tokens: { type: 'block', required: false },
    },
    params: {
      name: { type: 'string' },
      subtitle: { type: 'string' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
  },
  // Token-bag — fills are arbitrary user-named color values added to
  // the deck scope. Never rendered; only meaningful as the value of
  // `Deck.tokens`. `produces: 'block'` satisfies that slot's type
  // check; the loader processes it specially (no schema validation
  // on its fills, no render dispatch).
  Tokens: {
    produces: 'block',
    slots: {},
    params: {},
  },
  Slide: {
    produces: 'slide',
    slots: {
      content: { type: 'slide-content', required: true },
      notes: { type: 'text', required: false },
    },
    params: {
      label: { type: 'string' },
      chromeless: { type: 'boolean', default: false },
      chapter: { type: 'string' },
    },
  },
};
