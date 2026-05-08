// Slidewright loader: parse + validate + render a `.sw` source string
// into React elements ready to drop into the existing scaffold's
// <Presentation> runtime.
//
// v0.0 architecture (per SLIDEWRIGHT.md / v0.0):
//   - parse: hand-rolled recursive descent (parser.ts)
//   - validate: slot schema enforcement against ComponentRegistry
//   - resolve: (handle, context)-keyed cell store; literals only
//   - render: walk AST, dispatch each slide-producing component to its
//     React function with resolved {slots, params}
//
// Built-in components (`Deck`, `Slide`, `Span`) are special-cased; all
// other invocations go through the registry.

import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';
import { Slide as SlideFrameRaw } from '../../src/Slide.jsx';

// src/Slide.jsx is JS; typing it loosely here keeps the loader honest
// without forcing premature TS conversion of the existing scaffold.
type SlideFrameProps = {
  key?: number | string;
  idx?: number;
  label?: string;
  notes?: string;
  chromeless?: boolean;
  children?: ReactNode;
};
const SlideFrame = SlideFrameRaw as unknown as (props: SlideFrameProps) => ReactElement;
import type {
  Component,
  ListLit,
  SlotFill,
  SourceFile,
  StringLit,
  Value,
} from './ast.js';
import { CellStore, EMPTY_CONTEXT } from './cells.js';
import {
  BUILTIN_META,
  type ComponentMeta,
  type ComponentRegistry,
  type ComponentRenderProps,
  type SlideComponent,
  type SlotType,
} from './contract.js';
import {
  type Diagnostic,
  type DiagnosticKind,
} from './diagnostics.js';
import { parse } from './parser.js';
import { lookup, type Scope } from './scope.js';

export interface LoadDeckInput {
  source: string;
  file: string;
  components: ComponentRegistry;
  scope?: Scope;
  // Optional override for how each component invocation is wrapped
  // before being returned. Default wraps in a `<div data-sw-
  // component=...>` for selection sync. The canvas overrides this
  // to wrap with a React component that consumes gesture context
  // (so shapes re-render with gesture-adjusted params during a
  // gesture). Other consumers (CLI validate, SSR smoke tests) use
  // the default and never see gesture state.
  wrapShape?: WrapShape;
}

export type WrapShape = (input: WrapShapeInput) => ReactElement;

export interface WrapShapeInput {
  comp: Component;
  // Component-registry entry. Carries the React render function
  // (`loaded.render`) and the optional `canvas` adapter the
  // wrapper consumes.
  loaded: { render: SlideComponent; meta: ComponentMeta; canvas?: unknown };
  slots: Record<string, unknown>;
  params: Record<string, unknown>;
  // Stable key for the React render — already computed from the
  // component's source span by the loader.
  cellKey: string;
}

export interface DeckMeta {
  name: string;
  subtitle: string;
  width: number;
  height: number;
}

export interface LoadDeckResult {
  meta: DeckMeta;
  slides: ReactElement[];
  diagnostics: Diagnostic[];
  // Registry of shapes that declare a canvas adapter. Keyed by
  // `${span.start}-${span.end}`. Used by canvas-side selection /
  // gesture rendering to compute bounds and dispatch gestures
  // without re-walking the AST or the DOM.
  //
  // The runtime layer doesn't know what a ShapeAdapter is, so the
  // entry's `canvas` field is typed as `unknown`. Canvas casts.
  shapes: ReadonlyMap<string, ShapeData>;
}

export interface ShapeData {
  comp: Component;
  // The component-registry entry's `canvas` export, opaque here.
  // Only present when the component declared one (so the registry
  // is naturally filtered to gesture-able shapes).
  canvas: unknown;
  // Resolved params for the shape — the same map the loader hands
  // to its React render. Adapters use these as the source-driven
  // baseline that gestures transform.
  params: Record<string, unknown>;
  // Which slide this shape lives in (0-based). Adapter commits use
  // it for childIdx-based selection preservation.
  slideIdx: number;
  // Index in the parent freeform's `children` list at load time.
  // Used by external-edit reconciliation: re-find the same shape
  // in the new source by (slideIdx + childIdx + componentName)
  // even though spans have shifted. Falls over for restructuring
  // edits (insertions / deletions / reorders) — that's a known
  // limitation for v0.3; proper stable IDs in source are the
  // long-term answer (per SLIDEWRIGHT.md / IDs in source).
  // -1 if the shape isn't a direct child of a Freeform.
  childIdx: number;
}

const DEFAULT_META: DeckMeta = {
  name: '',
  subtitle: '',
  width: 1920,
  height: 1080,
};

export function loadDeck(input: LoadDeckInput): LoadDeckResult {
  const { ast, diagnostics } = parse(input.source, input.file);
  const ctx: LoadCtx = {
    file: input.file,
    components: input.components,
    scope: input.scope ?? { bindings: {} },
    diagnostics,
    cellStore: new CellStore(),
    cellSeq: 0,
    wrapShape: input.wrapShape ?? defaultWrapShape,
    shapes: new Map(),
    currentSlideIdx: -1,
  };

  // Find the top-level Deck invocation. We accept exactly one for v0.0.
  const deck = findDeck(ast, ctx);
  if (!deck) {
    return { meta: DEFAULT_META, slides: [], diagnostics, shapes: ctx.shapes };
  }

  const meta = renderDeckMeta(deck, ctx);
  const slides = renderDeckSlides(deck, ctx);
  // After rendering, populate each shape's childIdx — its position
  // in its parent Freeform's `children` list. Computed after
  // rendering so the registry is fully populated; used by external-
  // edit reconciliation to re-find the same shape after a source
  // change has shifted spans. -1 for shapes whose parent isn't a
  // Freeform (no current shapes hit this; future outside-Freeform
  // adapters will need a different identity scheme — see
  // SLIDEWRIGHT.md / Known design concerns).
  for (const data of ctx.shapes.values()) {
    data.childIdx = computeChildIdxInFreeform(ast, data);
  }
  return { meta, slides, diagnostics, shapes: ctx.shapes };
}

function computeChildIdxInFreeform(
  ast: SourceFile,
  data: ShapeData,
): number {
  const deck = ast.items[0];
  if (!deck || deck.name !== 'Deck') return -1;
  const slidesFill = deck.fills.find((f) => f.name === 'slides');
  if (!slidesFill || slidesFill.value.kind !== 'list') return -1;
  const slide = slidesFill.value.items[data.slideIdx];
  if (!slide || slide.kind !== 'component' || slide.name !== 'Slide') return -1;
  const contentFill = slide.fills.find((f) => f.name === 'content');
  if (
    !contentFill ||
    contentFill.value.kind !== 'component' ||
    contentFill.value.name !== 'Freeform'
  ) {
    return -1;
  }
  const childrenFill = contentFill.value.fills.find(
    (f) => f.name === 'children',
  );
  if (!childrenFill || childrenFill.value.kind !== 'list') return -1;
  const targetStart = data.comp.span.start.offset;
  const targetEnd = data.comp.span.end.offset;
  for (let i = 0; i < childrenFill.value.items.length; i++) {
    const item = childrenFill.value.items[i];
    if (
      item &&
      item.kind === 'component' &&
      item.span.start.offset === targetStart &&
      item.span.end.offset === targetEnd
    ) {
      return i;
    }
  }
  return -1;
}

interface LoadCtx {
  file: string;
  components: ComponentRegistry;
  scope: Scope;
  diagnostics: Diagnostic[];
  cellStore: CellStore;
  cellSeq: number;
  wrapShape: WrapShape;
  shapes: Map<string, ShapeData>;
  // The slide index currently being rendered. Set by
  // renderDeckSlides as it iterates; used to tag each shape with
  // its parent slide for canvas-side commit logic.
  currentSlideIdx: number;
}

// Default wrap: a span-only marker div for selection sync. No
// gesture awareness — the canvas overrides via input.wrapShape.
function defaultWrapShape(input: WrapShapeInput): ReactElement {
  return createElement(
    'div',
    {
      key: `wrap-${input.comp.span.start.offset}`,
      'data-sw-component': input.comp.name,
      'data-sw-span-start': input.comp.span.start.offset,
      'data-sw-span-end': input.comp.span.end.offset,
      style: { display: 'contents' },
    },
    createElement(input.loaded.render, {
      slots: input.slots as ComponentRenderProps['slots'],
      params: input.params,
      key: input.cellKey,
    }),
  );
}

function nextCellId(ctx: LoadCtx, hint: string): string {
  ctx.cellSeq += 1;
  return `${hint}#${ctx.cellSeq}`;
}

function emit(
  ctx: LoadCtx,
  kind: DiagnosticKind,
  span: { start: { line: number; column: number; offset: number }; end: { line: number; column: number; offset: number } },
  message: string,
  hint?: string,
): void {
  // missing-required-slot is part of the normal editing workflow —
  // when a user is constructing a slide, optional fills land later
  // than required ones, and momentarily-incomplete source shouldn't
  // surface as an error. Demoted to 'warning' so the canvas
  // diagnostics panel doesn't flag it (the panel filters on
  // severity === 'error') and the commit pipeline doesn't abort
  // dependent gestures. Type mismatches, unknown components, and
  // syntax errors stay 'error'.
  const severity = kind === 'missing-required-slot' ? 'warning' : 'error';
  ctx.diagnostics.push({
    kind,
    severity,
    message,
    hint,
    span,
    file: ctx.file,
  });
}

function findDeck(ast: SourceFile, ctx: LoadCtx): Component | null {
  const decks = ast.items.filter((c) => c.name === 'Deck');
  if (decks.length === 0) {
    if (ast.items.length > 0) {
      emit(
        ctx,
        'unknown-component',
        ast.items[0]!.span,
        'expected a top-level `Deck { ... }` invocation',
        'a Slidewright source file must begin with `Deck { ... }`',
      );
    }
    return null;
  }
  if (decks.length > 1) {
    emit(
      ctx,
      'parse',
      decks[1]!.span,
      'multiple `Deck` invocations in a single file are not supported',
    );
  }
  return decks[0]!;
}

function renderDeckMeta(deck: Component, ctx: LoadCtx): DeckMeta {
  const meta = { ...DEFAULT_META };
  const fills = byName(deck.fills);
  const name = readString(fills.get('name'), ctx);
  const subtitle = readString(fills.get('subtitle'), ctx);
  const width = readNumber(fills.get('width'), ctx);
  const height = readNumber(fills.get('height'), ctx);
  if (name !== undefined) meta.name = name;
  if (subtitle !== undefined) meta.subtitle = subtitle;
  if (width !== undefined) meta.width = width;
  if (height !== undefined) meta.height = height;
  return meta;
}

function renderDeckSlides(deck: Component, ctx: LoadCtx): ReactElement[] {
  // Validate Deck against its built-in meta.
  validateAgainstMeta(deck, BUILTIN_META.Deck!, ctx);

  const fills = byName(deck.fills);
  const slidesFill = fills.get('slides');
  if (!slidesFill) return [];
  if (slidesFill.value.kind !== 'list') {
    emit(
      ctx,
      'slot-type-mismatch',
      slidesFill.value.span,
      'expected `slides` to be a list',
      'the slides slot is `array<slide>`; use `[...]`',
    );
    return [];
  }
  const out: ReactElement[] = [];
  let idx = 0;
  for (const item of slidesFill.value.items) {
    if (item.kind !== 'component') {
      emit(
        ctx,
        'slot-type-mismatch',
        item.span,
        'expected a slide-producing component invocation',
      );
      continue;
    }
    ctx.currentSlideIdx = idx;
    const el = renderSlide(item, ctx, idx);
    if (el) out.push(el);
    idx += 1;
  }
  return out;
}

function renderSlide(comp: Component, ctx: LoadCtx, idx: number): ReactElement | null {
  // The top-level slide invocation can be either:
  //   - a Slide built-in (frame + content), or
  //   - a custom slide component (we wrap it ourselves).
  if (comp.name === 'Slide') {
    return renderBuiltinSlide(comp, ctx, idx);
  }
  // Custom slide component: validate it produces 'slide', wrap in Slide.
  const loaded = ctx.components[comp.name];
  if (!loaded) {
    emit(
      ctx,
      'unknown-component',
      comp.span,
      `unknown component \`${comp.name}\``,
      'register the component in the deck index, or use a built-in',
    );
    return null;
  }
  if (loaded.meta.produces !== 'slide') {
    emit(
      ctx,
      'slot-type-mismatch',
      comp.span,
      `\`${comp.name}\` produces \`${loaded.meta.produces}\` but a slide is expected`,
    );
    return null;
  }
  const inner = renderComponent(comp, ctx);
  if (!inner) return null;
  return wrapWithSpan(
    comp,
    createElement(SlideFrame, { key: idx, idx: idx + 1, label: comp.name, children: inner }),
  );
}

function renderBuiltinSlide(comp: Component, ctx: LoadCtx, idx: number): ReactElement | null {
  const fills = byName(comp.fills);
  validateNoUnknown(comp, ['content', 'label', 'notes', 'chromeless'], ctx);
  const contentFill = fills.get('content');
  if (!contentFill) {
    emit(
      ctx,
      'missing-required-slot',
      comp.span,
      'Slide is missing required `content` slot',
    );
    return null;
  }
  const label = readString(fills.get('label'), ctx);
  const notes = readText(fills.get('notes'), ctx);
  const chromeless = readBoolean(fills.get('chromeless'), ctx);
  const content = renderBlockValue(contentFill.value, ctx);
  return wrapWithSpan(
    comp,
    createElement(SlideFrame, {
      key: idx,
      idx: idx + 1,
      label: label ?? '',
      notes: typeof notes === 'string' ? notes : '',
      chromeless: chromeless ?? false,
      children: content,
    }),
  );
}

// ── Selection-sync instrumentation ─────────────────────────────────────
//
// Wraps a rendered component invocation in a marker div that carries
// the source-span offsets. `display: contents` keeps the wrapper out of
// the layout tree (children participate in the parent's layout), but
// the wrapper is still visible to the DOM event system and to
// element.closest() — so a click anywhere inside the rendered slide
// can walk up to the nearest wrapping component and read its source
// range. Used by ScaledCanvas's click handler to drive selection sync
// (canvas.tsx → host.sendSelection → extension reveals the range).
function wrapWithSpan(comp: Component, element: ReactNode): ReactElement {
  return createElement(
    'div',
    {
      key: `wrap-${comp.span.start.offset}`,
      'data-sw-component': comp.name,
      'data-sw-span-start': comp.span.start.offset,
      'data-sw-span-end': comp.span.end.offset,
      style: { display: 'contents' },
    },
    element,
  );
}

// Wraps a resolved string value in an inline span carrying the source
// offsets of the original StringLit. Lets the canvas's edit gesture
// (v0.2+) target individual string literals — closest('[data-sw-text-
// span-start]') from the click target. Skipped for triple-quoted
// (multiline) strings since their edit UX needs richer handling
// (indentation, line-wrap) than the single-line input overlay covers.
function wrapEditableString(
  lit: StringLit,
  resolved: string,
  key?: number,
): ReactNode {
  if (lit.multiline) return resolved;
  return createElement(
    'span',
    {
      key: key,
      'data-sw-text-span-start': lit.span.start.offset,
      'data-sw-text-span-end': lit.span.end.offset,
    },
    resolved,
  );
}

// ── Component dispatch ─────────────────────────────────────────────────

function renderComponent(comp: Component, ctx: LoadCtx): ReactNode {
  // Built-in: Span (handled inside text-run resolution; if it shows up
  // as a standalone block here, render as a plain span)
  if (comp.name === 'Span') {
    return renderSpanAsNode(comp, ctx);
  }

  const loaded = ctx.components[comp.name];
  if (!loaded) {
    emit(
      ctx,
      'unknown-component',
      comp.span,
      `unknown component \`${comp.name}\``,
      'register the component in the deck index',
    );
    return null;
  }

  validateAgainstMeta(comp, loaded.meta, ctx);

  // Build resolved {slots, params}.
  const slots: Record<string, unknown> = {};
  const params: Record<string, unknown> = {};

  const fills = byName(comp.fills);
  for (const [slotName, schema] of Object.entries(loaded.meta.slots)) {
    const fill = fills.get(slotName);
    if (!fill) {
      // Empty slot — no fill in source. For renderable slot types
      // we inject a placeholder ReactNode the user can click into
      // (selection lands on a `kind: 'empty-slot'` target). Phase A
      // is always-on placeholders; Phase B adds an explicit-empty
      // sigil that suppresses them. Non-renderable slot types
      // (image, scalars) stay undefined — the component template
      // and the inspector handle their absence.
      if (isRenderableSlotType(schema.type)) {
        slots[slotName] = createEmptySlotPlaceholder(
          slotName,
          schema.type,
          comp.span.start.offset,
          comp.span.end.offset,
        );
      }
      continue;
    }
    const resolved = resolveSlotValue(schema.type, fill.value, ctx);
    // Wrap renderable slot values (text / block / slide / array<X>
    // of those) with a `data-sw-slot-name` span so the canvas can
    // dispatch clicks to the slot. Other slot types (image as URL,
    // scalars) aren't React-renderable as wrapping children, so
    // they pass through unwrapped — selection on them is deferred
    // (image needs a different identification approach; scalars
    // are conceptually params, edited via inspector).
    if (isRenderableSlotType(schema.type)) {
      slots[slotName] = createElement(
        'span',
        {
          'data-sw-slot-name': slotName,
          'data-sw-slot-span-start': fill.span.start.offset,
          'data-sw-slot-span-end': fill.span.end.offset,
          style: { display: 'contents' },
          key: `slot-${slotName}-${fill.span.start.offset}`,
        },
        resolved as ReactNode,
      );
    } else {
      slots[slotName] = resolved;
    }
  }

  for (const [paramName, schema] of Object.entries(loaded.meta.params ?? {})) {
    const fill = fills.get(paramName);
    if (fill) {
      params[paramName] = resolveSlotValue(schema.type, fill.value, ctx);
    } else if (schema.default !== undefined) {
      params[paramName] = schema.default;
    }
  }

  // Implicit children: if the body has implicitChildren and the meta
  // declares a `children` slot, fill it.
  if (
    comp.implicitChildren.length > 0 &&
    loaded.meta.slots['children'] !== undefined
  ) {
    slots['children'] = comp.implicitChildren.map((c) => renderComponent(c, ctx));
  } else if (comp.implicitChildren.length > 0) {
    emit(
      ctx,
      'invalid-implicit-children',
      comp.bodySpan,
      `\`${comp.name}\` does not declare a \`children\` slot but its body contains bare component invocations`,
      'declare a `children` slot in the component meta, or use explicit `children: [...]`',
    );
  }

  // Register shapes with canvas adapters in the registry the
  // canvas reads for selection / gesture rendering.
  if (loaded.canvas !== undefined && ctx.currentSlideIdx >= 0) {
    const key = `${comp.span.start.offset}-${comp.span.end.offset}`;
    ctx.shapes.set(key, {
      comp,
      canvas: loaded.canvas,
      params,
      slideIdx: ctx.currentSlideIdx,
      childIdx: -1, // populated post-rendering by computeChildIdxInFreeform
    });
  }

  return ctx.wrapShape({
    comp,
    loaded,
    slots,
    params,
    cellKey: cellKey(comp),
  });
}

function renderSpanAsNode(comp: Component, ctx: LoadCtx): ReactNode {
  const fills = byName(comp.fills);
  const content = fills.get('content');
  const color = readNameOrString(fills.get('color'), ctx);
  const font = readNameOrString(fills.get('font'), ctx);
  const weight = readNameOrString(fills.get('weight'), ctx);
  const italic = readBoolean(fills.get('italic'), ctx);
  const inner = content ? resolveTextValue(content.value, ctx) : null;
  const style: Record<string, string> = {};
  if (color) style.color = `var(--${color})`;
  if (font) style.fontFamily = `var(--font-${font})`;
  if (weight) style.fontWeight = weight;
  if (italic) style.fontStyle = 'italic';
  return createElement(
    'span',
    {
      style,
      key: cellKey(comp),
      'data-sw-component': 'Span',
      'data-sw-span-start': comp.span.start.offset,
      'data-sw-span-end': comp.span.end.offset,
    },
    inner,
  );
}

// Empty-slot placeholder. Phase A: always-on for any renderable
// empty slot. Visual signals "here's where content goes" without
// claiming significant layout — text slots render inline ghost
// text matching the parent's typography; block / slide slots
// render a fixed-size dashed box with the slot name. The element
// carries the same selection attrs filled slots use plus
// `data-sw-slot-empty="true"` and the parent's span (since there's
// no own SlotFill span — see SelectionTarget's `empty-slot` kind).
function createEmptySlotPlaceholder(
  slotName: string,
  slotType: SlotType,
  parentStart: number,
  parentEnd: number,
): ReactNode {
  const inner = slotType.startsWith('array<')
    ? (slotType.slice(6, -1) as SlotType)
    : slotType;
  const isText = inner === 'text';
  // The slot wrapper is `display: contents` so the parent's
  // typography / flex still applies to the placeholder visual
  // inside. The visual element below the wrapper carries the
  // styling.
  const dashedBorder = '1px dashed rgba(15, 118, 110, 0.55)';
  const crosshatch =
    'repeating-linear-gradient(45deg, transparent 0 8px, rgba(15, 118, 110, 0.06) 8px 9px)';
  const visual = isText
    ? createElement(
        'span',
        {
          style: {
            display: 'inline-block',
            padding: '2px 6px',
            border: dashedBorder,
            background: crosshatch,
            color: 'rgba(15, 118, 110, 0.7)',
            fontStyle: 'italic',
            fontFamily: 'var(--font-body)',
            borderRadius: 2,
          },
        },
        `${slotName}…`,
      )
    : createElement(
        'div',
        {
          style: {
            width: 200,
            height: 60,
            border: dashedBorder,
            background: crosshatch,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(15, 118, 110, 0.7)',
            fontStyle: 'italic',
            fontFamily: 'var(--font-body)',
            fontSize: 18,
          },
        },
        slotName,
      );
  return createElement(
    'span',
    {
      'data-sw-slot-name': slotName,
      'data-sw-slot-empty': 'true',
      'data-sw-slot-parent-start': parentStart,
      'data-sw-slot-parent-end': parentEnd,
      'data-sw-slot-type': slotType,
      style: { display: 'contents' },
      key: `slot-empty-${slotName}-${parentStart}`,
    },
    visual,
  );
}

// Is this slot type rendered as React content (so wrapping it in
// a slot span is meaningful for click dispatch)? Text / block /
// slide and arrays of those resolve to ReactNodes we can wrap.
// Image, scalars, and tokens resolve to non-React values (URL
// strings, numbers, etc.) — wrapping them would break the user
// component's expectation that `slots.headshot` is a string, etc.
function isRenderableSlotType(type: SlotType): boolean {
  const inner = type.startsWith('array<')
    ? (type.slice(6, -1) as SlotType)
    : type;
  return inner === 'text' || inner === 'block' || inner === 'slide';
}

// ── Value resolution by slot type ──────────────────────────────────────

function resolveSlotValue(type: SlotType, value: Value, ctx: LoadCtx): unknown {
  if (type.startsWith('array<')) {
    const inner = type.slice(6, -1) as SlotType;
    if (value.kind !== 'list') {
      emit(
        ctx,
        'slot-type-mismatch',
        value.span,
        `expected a list for \`${type}\``,
      );
      return [];
    }
    return value.items.map((v) => resolveSlotValue(inner, v, ctx));
  }
  switch (type) {
    case 'text':
      return resolveTextValue(value, ctx);
    case 'block':
      return renderBlockValue(value, ctx);
    case 'image':
      return resolveImageValue(value, ctx);
    case 'slide':
      // Resolved as a React element via the slide-rendering path.
      if (value.kind !== 'component') {
        emit(ctx, 'slot-type-mismatch', value.span, 'expected a slide component');
        return null;
      }
      return renderSlide(value, ctx, 0);
    case 'string':
      return readString({ kind: 'slot_fill', name: '', value, span: value.span }, ctx) ?? null;
    case 'number':
      return readNumber({ kind: 'slot_fill', name: '', value, span: value.span }, ctx) ?? null;
    case 'boolean':
      return readBoolean({ kind: 'slot_fill', name: '', value, span: value.span }, ctx) ?? null;
    case 'color-token':
    case 'spacing-token':
    case 'font-token':
      return readNameOrString({ kind: 'slot_fill', name: '', value, span: value.span }, ctx) ?? null;
    default:
      emit(ctx, 'slot-type-mismatch', value.span, `unknown slot type: \`${type}\``);
      return null;
  }
}

function resolveTextValue(value: Value, ctx: LoadCtx): ReactNode {
  // text accepts: a string, a list of (string | Span | name_ref-resolving-to-string).
  if (value.kind === 'string') {
    const lit = ctx.cellStore.registerLiteral(nextCellId(ctx, 'text'), value.value);
    const resolved = ctx.cellStore.resolve<string>(lit, EMPTY_CONTEXT);
    return wrapEditableString(value, resolved);
  }
  if (value.kind === 'list') {
    const parts: ReactNode[] = value.items.map((v, i) => {
      if (v.kind === 'string') {
        return wrapEditableString(v, v.value, i);
      }
      if (v.kind === 'component' && v.name === 'Span') {
        return renderSpanAsNode(v, ctx);
      }
      if (v.kind === 'name_ref') {
        const resolved = lookup(ctx.scope, v.name);
        if (resolved === undefined) {
          emit(
            ctx,
            'unknown-reference',
            v.span,
            `unknown name \`${v.name}\``,
            'add it to the deck scope or import it in the deck index',
          );
          return '';
        }
        return String(resolved);
      }
      emit(
        ctx,
        'slot-type-mismatch',
        v.span,
        'text run items must be strings or `Span { ... }`',
      );
      return '';
    });
    return createElement(Fragment, { key: cellKey(value) }, ...parts.map((p, i) => createElement(Fragment, { key: i }, p)));
  }
  if (value.kind === 'name_ref') {
    const resolved = lookup(ctx.scope, value.name);
    if (resolved === undefined) {
      emit(ctx, 'unknown-reference', value.span, `unknown name \`${value.name}\``);
      return null;
    }
    return String(resolved);
  }
  emit(ctx, 'slot-type-mismatch', value.span, `expected text, got ${value.kind}`);
  return null;
}

function renderBlockValue(value: Value, ctx: LoadCtx): ReactNode {
  if (value.kind !== 'component') {
    emit(
      ctx,
      'slot-type-mismatch',
      value.span,
      'expected a component invocation for a block slot',
    );
    return null;
  }
  return renderComponent(value, ctx);
}

function resolveImageValue(value: Value, ctx: LoadCtx): string | null {
  if (value.kind === 'string') return value.value;
  if (value.kind === 'name_ref') {
    const resolved = lookup(ctx.scope, value.name);
    if (resolved === undefined) {
      emit(
        ctx,
        'unknown-reference',
        value.span,
        `unknown asset reference \`${value.name}\``,
        'import the asset in the deck index and add it to the scope',
      );
      return null;
    }
    return String(resolved);
  }
  emit(
    ctx,
    'slot-type-mismatch',
    value.span,
    'expected an image (string path or asset name)',
  );
  return null;
}

// ── Schema validation ──────────────────────────────────────────────────

function validateAgainstMeta(
  comp: Component,
  meta: ComponentMeta,
  ctx: LoadCtx,
): void {
  const known = new Set([
    ...Object.keys(meta.slots),
    ...Object.keys(meta.params ?? {}),
  ]);
  // Duplicates + unknowns.
  const seen = new Map<string, SlotFill>();
  for (const fill of comp.fills) {
    const prev = seen.get(fill.name);
    if (prev) {
      emit(
        ctx,
        'duplicate-slot',
        fill.span,
        `duplicate slot \`${fill.name}\` on \`${comp.name}\``,
      );
      continue;
    }
    seen.set(fill.name, fill);
    if (!known.has(fill.name)) {
      emit(
        ctx,
        'unknown-slot',
        fill.span,
        `\`${comp.name}\` has no slot \`${fill.name}\``,
        knownHint(known),
      );
    }
  }
  // Required slots.
  for (const [slotName, schema] of Object.entries(meta.slots)) {
    if (schema.required && !seen.has(slotName)) {
      emit(
        ctx,
        'missing-required-slot',
        comp.span,
        `\`${comp.name}\` is missing required slot \`${slotName}\``,
      );
    }
  }
}

function validateNoUnknown(
  comp: Component,
  allowed: string[],
  ctx: LoadCtx,
): void {
  const set = new Set(allowed);
  for (const fill of comp.fills) {
    if (!set.has(fill.name)) {
      emit(
        ctx,
        'unknown-slot',
        fill.span,
        `\`${comp.name}\` has no slot \`${fill.name}\``,
        knownHint(set),
      );
    }
  }
}

function knownHint(known: Iterable<string>): string {
  const list = Array.from(known).sort().join(', ');
  return list.length > 0 ? `known slots: ${list}` : '(no slots declared)';
}

// ── Small readers ──────────────────────────────────────────────────────

function byName(fills: SlotFill[]): Map<string, SlotFill> {
  const m = new Map<string, SlotFill>();
  for (const f of fills) m.set(f.name, f);
  return m;
}

function readString(fill: SlotFill | undefined, ctx: LoadCtx): string | undefined {
  if (!fill) return undefined;
  const v = fill.value;
  if (v.kind === 'string') return v.value;
  if (v.kind === 'name_ref') {
    const r = lookup(ctx.scope, v.name);
    if (typeof r === 'string') return r;
  }
  emit(ctx, 'slot-type-mismatch', v.span, `expected a string for \`${fill.name}\``);
  return undefined;
}

function readNumber(fill: SlotFill | undefined, ctx: LoadCtx): number | undefined {
  if (!fill) return undefined;
  const v = fill.value;
  if (v.kind === 'number') return v.value;
  emit(ctx, 'slot-type-mismatch', v.span, `expected a number for \`${fill.name}\``);
  return undefined;
}

function readBoolean(fill: SlotFill | undefined, ctx: LoadCtx): boolean | undefined {
  if (!fill) return undefined;
  const v = fill.value;
  if (v.kind === 'boolean') return v.value;
  emit(ctx, 'slot-type-mismatch', v.span, `expected a boolean for \`${fill.name}\``);
  return undefined;
}

function readText(fill: SlotFill | undefined, ctx: LoadCtx): string | undefined {
  if (!fill) return undefined;
  const v = fill.value;
  if (v.kind === 'string') return v.value;
  emit(ctx, 'slot-type-mismatch', v.span, `expected a text/string value for \`${fill.name}\``);
  return undefined;
}

function readNameOrString(fill: SlotFill | undefined, ctx: LoadCtx): string | undefined {
  if (!fill) return undefined;
  const v = fill.value;
  if (v.kind === 'string') return v.value;
  if (v.kind === 'name_ref') return v.name;
  emit(ctx, 'slot-type-mismatch', v.span, `expected a token name or string for \`${fill.name}\``);
  return undefined;
}

function cellKey(node: { span: { start: { offset: number } } }): string {
  return `cell-${node.span.start.offset}`;
}
