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
// Built-in components (`Deck`, `Slide`, `Span`, `Paragraph`, `List`, `ListItem`) are
// special-cased; all other invocations go through the registry.

import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';
import { sourceElement, SourceLocationContext } from './source-location.js';
import type { DeckDocument, DocumentSnapshot, OccurrenceHandle } from './document.js';
import { Slide as SlideFrameRaw } from '../../src/Slide.jsx';

// src/Slide.jsx is JS; typing it loosely here keeps the loader honest
// without forcing premature TS conversion of the existing scaffold.
type SlideFrameProps = {
  key?: number | string;
  idx?: number;
  label?: string;
  notes?: string;
  chromeless?: boolean;
  actLabel?: string;
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
  type SlotState,
  type SlotType,
} from './contract.js';
import {
  type Diagnostic,
  type DiagnosticKind,
} from './diagnostics.js';
import { parse, type ParseResult } from './parser.js';
import { lookup, type Scope, type ScopeValue } from './scope.js';

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
  slotsState: Record<string, SlotState>;
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
  // Parallel to `slides: ReactElement[]` — one entry per slide,
  // same index. Carries the slide's AST component (the `Slide { ...
  // }` invocation, or a custom slide-producing component used at
  // the top level) plus its meta. The inspector reads this to
  // render slide-level properties (label, notes, etc.) as the
  // default panel when nothing else is selected.
  slidesData: SlideAstData[];
  // Source-declared color tokens — keyed by name, value is the
  // CSS color string. Empty when the deck has no `tokens:` fill.
  // The inspector palette merges these with the registry's static
  // tokens; this is the live, deck-derived part.
  tokens: Record<string, string>;
}

export interface SlideAstData {
  comp: Component;
  meta: ComponentMeta;
}

export interface ShapeData {
  comp: Component;
  // The component-registry entry's `canvas` export, opaque here.
  // Only present when the component declared one (so the registry
  // is naturally filtered to gesture-able shapes).
  canvas: unknown;
  // The component's declared meta (slots / params schema). The
  // inspector reads this to distinguish slots from params and to
  // route the omit-toggle to renderable slots only.
  meta: ComponentMeta;
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
  return resolveParsedDeck(input, parse(input.source, input.file));
}

// The resolver never mutates the AST. Copy diagnostics because document
// snapshots are frozen and validation contributes additional diagnostics.
export function resolveParsedDeck(input: LoadDeckInput, parsed: ParseResult): LoadDeckResult {
  return resolveDeck(input, parsed);
}

function resolveDeck(input: LoadDeckInput, parsed: ParseResult, cache?: SlideCacheContext): LoadDeckResult {
  const { ast } = parsed;
  const diagnostics = [...parsed.diagnostics];
  const ctx: LoadCtx = {
    file: input.file,
    components: input.components,
    scope: input.scope ?? { bindings: {} },
    colorTokens: {},
    diagnostics,
    cellStore: new CellStore(),
    cellSeq: 0,
    wrapShape: input.wrapShape ?? defaultWrapShape,
    shapes: new Map(),
    slidesData: [],
    currentSlideIdx: -1,
    cache,
  };

  // Find the top-level Deck invocation. We accept exactly one for v0.0.
  const deck = findDeck(ast, ctx);
  if (!deck) {
    return {
      meta: DEFAULT_META,
      slides: [],
      diagnostics,
      shapes: ctx.shapes,
      slidesData: ctx.slidesData,
      tokens: {},
    };
  }

  const meta = renderDeckMeta(deck, ctx);
  // Source-declared color tokens — must run before `renderDeckSlides`
  // so the augmented scope is visible to every slide's name_ref
  // resolution. Returns the merged token map (registry + source)
  // for the inspector palette.
  const tokens = processDeckTokens(deck, ctx);
  if (cache) {
    const tokensKey = JSON.stringify(tokens);
    if (tokensKey !== cache.tokensKey) cache.entries.clear();
    cache.tokensKey = tokensKey;
  }
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
  return {
    meta,
    slides,
    diagnostics,
    shapes: ctx.shapes,
    slidesData: ctx.slidesData,
    tokens,
  };
}

interface CachedSlide {
  source: string;
  baseStart: number;
  frame: ReactElement<SlideFrameProps> | null;
  diagnostics: Diagnostic[];
  shapes: ShapeData[];
  slidesData: SlideAstData[];
}

interface SlideCacheContext {
  entries: Map<OccurrenceHandle, CachedSlide>;
  tokensKey?: string;
  document: DeckDocument;
  snapshot: DocumentSnapshot;
  handles: Map<number, OccurrenceHandle>;
  components: Map<number, Component>;
  adapters: Map<number, unknown>;
  used: Set<OccurrenceHandle>;
  counts: { resolvedSlides: number; reusedSlides: number };
}

/** Retained per-slide resolution, scoped to one interactive document session.
 * Registry entries are immutable inputs; call invalidate() after an in-place
 * registry mutation. Asset/scope values and source tokens are compared by value.
 */
export class DeckResolver {
  private readonly entries = new Map<OccurrenceHandle, CachedSlide>();
  private registry: unknown[] = [];
  private bindings: [string, ScopeValue][] = [];
  private wrapper?: WrapShape;
  private tokensKey?: string;
  private counts = { resolvedSlides: 0, reusedSlides: 0 };
  get stats(): Readonly<{ resolvedSlides: number; reusedSlides: number }> { return this.counts; }

  invalidate(): void { this.entries.clear(); }

  resolve(document: DeckDocument, input: Omit<LoadDeckInput, 'source' | 'file'>): LoadDeckResult & { revision: number } {
    const snapshot = document.snapshot;
    const registry = Object.entries(input.components).sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([name, entry]) => [name, entry.render, entry.meta, entry.canvas]);
    const bindings = Object.entries(input.scope?.bindings ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (registry.length !== this.registry.length || registry.some((entry, i) => entry !== this.registry[i]) ||
        bindings.length !== this.bindings.length || bindings.some(([key, value], i) =>
          key !== this.bindings[i]?.[0] || !Object.is(value, this.bindings[i]?.[1])) || input.wrapShape !== this.wrapper) this.invalidate();
    this.registry = registry;
    this.bindings = bindings;
    this.wrapper = input.wrapShape;
    this.counts = { resolvedSlides: 0, reusedSlides: 0 };
    const cache: SlideCacheContext = {
      entries: this.entries, tokensKey: this.tokensKey, document, snapshot,
      handles: new Map(snapshot.occurrences.map(item => [item.range.start, item.handle])),
      // Resolution is read-only; mutable AST types remain for existing editor
      // commands. Resolution treats every snapshot node as read-only.
      components: new Map(snapshot.occurrences.map(item => [item.range.start, item.component as Component])),
      adapters: new Map(), used: new Set(), counts: this.counts,
    };
    // Recovery nodes can have truncated/non-enclosing spans. They cannot be
    // safe cache boundaries or owners of relative diagnostics. Keep source
    // authoritative, but resolve that revision conservatively without caching.
    const cacheable = !snapshot.diagnostics.some(diagnostic => diagnostic.severity === 'error');
    if (!cacheable) this.invalidate();
    const result = resolveDeck({ ...input, source: snapshot.source, file: snapshot.file }, {
      ast: snapshot.ast as SourceFile, diagnostics: snapshot.diagnostics as Diagnostic[],
    }, cacheable ? cache : undefined);
    if (!cacheable) this.counts.resolvedSlides = result.slidesData.length;
    this.tokensKey = cache.tokensKey;
    for (const key of this.entries.keys()) if (!cache.used.has(key)) this.entries.delete(key);
    return { ...result, revision: snapshot.revision };
  }
}

function renderCachedSlide(comp: Component, ctx: LoadCtx, idx: number, chapter?: string): ReactElement | null {
  const cache = ctx.cache!;
  const handle = cache.handles.get(comp.span.start.offset)!;
  cache.used.add(handle);
  const source = cache.snapshot.source.slice(comp.span.start.offset, comp.span.end.offset);
  let entry = cache.entries.get(handle);
  if (!entry || entry.source !== source) {
    const local: LoadCtx = { ...ctx, cache: undefined, diagnostics: [], shapes: new Map(),
      slidesData: [], cellStore: new CellStore(), cellSeq: 0 };
    const element = renderSlide(comp, local, idx, chapter);
    entry = {
      source, baseStart: comp.span.start.offset,
      frame: element ? (element as ReactElement<{ children: ReactElement<SlideFrameProps> }>).props.children : null,
      diagnostics: local.diagnostics, shapes: [...local.shapes.values()], slidesData: local.slidesData,
    };
    cache.entries.set(handle, entry);
    cache.counts.resolvedSlides++;
  } else cache.counts.reusedSlides++;
  const delta = comp.span.start.offset - entry.baseStart;
  for (const diagnostic of entry.diagnostics) {
    const span = cache.document.locate(handle, {
      start: diagnostic.span.start.offset - entry.baseStart,
      end: diagnostic.span.end.offset - entry.baseStart,
    })!;
    ctx.diagnostics.push({ ...diagnostic, file: ctx.file, span });
  }
  for (const shape of entry.shapes) {
    const current = cache.components.get(shape.comp.span.start.offset + delta)!;
    const registered = ctx.components[current.name]?.canvas as {
      bindChildren?: (children: readonly ShapeData[]) => unknown;
    } | undefined;
    const fill = current.fills.find(fill => fill.name === 'children');
    const children = fill?.value.kind === 'list' ? fill.value.items : current.implicitChildren;
    const canvas = registered?.bindChildren ? registered.bindChildren(children.flatMap(child => {
      const data = ctx.shapes.get(`${child.span.start.offset}-${child.span.end.offset}`);
      return data ? [data] : [];
    })) : shape.canvas;
    cache.adapters.set(current.span.start.offset, canvas);
    ctx.shapes.set(`${current.span.start.offset}-${current.span.end.offset}`, { ...shape, canvas, comp: current, slideIdx: idx });
  }
  for (const slide of entry.slidesData) ctx.slidesData.push({ ...slide, comp });
  if (!entry.frame) return null;
  // Frame order/chapter and source location are current; the resolved content
  // element below the provider retains its identity, including after shifts.
  return createElement('div', {
    key: handle, 'data-sw-component': comp.name,
    'data-sw-span-start': comp.span.start.offset, 'data-sw-span-end': comp.span.end.offset,
    style: { display: 'contents' },
  }, createElement(SlideFrame, { ...entry.frame.props, key: handle, idx: idx + 1, actLabel: chapter,
    children: createElement(SourceLocationContext.Provider, {
      value: { delta, components: cache.components, adapters: cache.adapters }, children: entry.frame.props.children,
    }),
  }));
}

// Process the `tokens:` fill on Deck (if any). Each fill inside the
// `Tokens { ... }` body is treated as a named CSS color contributed
// to the deck's color-token map. Returns the resolved map for
// downstream consumers (inspector palette). Populates
// `ctx.colorTokens` so subsequent slide resolution sees them via
// `readColorValue`'s scope-first lookup.
//
// Token values may be color_oklch literals, strings (raw CSS), or
// name_refs (pointing to a previously-declared token OR a registry
// `var(--name)`). For the name_ref case we resolve relative to the
// tokens-so-far so users can build palettes that reference each
// other; cycles aren't checked but would shake out as undefined.
function processDeckTokens(deck: Component, ctx: LoadCtx): Record<string, string> {
  const fills = byName(deck.fills);
  const tokensFill = fills.get('tokens');
  if (!tokensFill) return {};
  const v = tokensFill.value;
  if (v.kind !== 'component' || v.name !== 'Tokens') {
    emit(
      ctx,
      'slot-type-mismatch',
      v.span,
      '`tokens` must be a `Tokens { ... }` invocation',
    );
    return {};
  }
  for (const fill of v.fills) {
    const css = readColorValue(fill, ctx);
    if (css === undefined) continue;
    // Accumulate progressively so later entries can name-ref earlier
    // ones — readColorValue consults ctx.colorTokens for name_refs.
    ctx.colorTokens[fill.name] = css;
  }
  return { ...ctx.colorTokens };
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
  // Source-declared color tokens — populated from
  // `Deck.tokens: Tokens { ... }` early in `loadDeck`, consulted
  // by `readColorValue` for name_ref resolution. Separate from
  // `scope.bindings` so text-slot name_refs (which read scope as
  // a generic string lookup) aren't affected by the CSS-color
  // form of these values.
  colorTokens: Record<string, string>;
  diagnostics: Diagnostic[];
  cellStore: CellStore;
  cellSeq: number;
  wrapShape: WrapShape;
  shapes: Map<string, ShapeData>;
  // Parallel to the eventual `slides: ReactElement[]` output. One
  // entry pushed per top-level slide (Slide builtin or custom slide
  // component) during renderDeckSlides; surfaces as
  // LoadDeckResult.slidesData.
  slidesData: SlideAstData[];
  // The slide index currently being rendered. Set by
  // renderDeckSlides as it iterates; used to tag each shape with
  // its parent slide for canvas-side commit logic.
  currentSlideIdx: number;
  cache?: SlideCacheContext;
  inlineSlotOverride?: { component: Component; name: string; content: ReactNode };
}

// Render source-backed custom inline views inside an editor island using
// the same registry resolution as the deck. Transparent node views supply
// one DOM hole through their declared text slot; the engine owns its kids.
// Canvas component previews reuse this resolver with a projection wrapper.
export function renderEditorInline(input: {
  component: Component;
  components: ComponentRegistry;
  scope: Scope;
  colorTokens?: Record<string, string>;
  contentSlot?: string;
  content?: ReactNode;
  wrapShape?: WrapShape;
}): ReactNode {
  const ctx: LoadCtx = {
    file: '<inline-editor>', components: input.components, scope: input.scope,
    colorTokens: input.colorTokens ?? {}, diagnostics: [], cellStore: new CellStore(), cellSeq: 0,
    wrapShape: input.wrapShape ?? defaultWrapShape, shapes: new Map(), slidesData: [], currentSlideIdx: -1,
    ...(input.contentSlot ? { inlineSlotOverride: { component: input.component, name: input.contentSlot, content: input.content } } : {}),
  };
  return createElement(SourceLocationContext.Provider, { value: null }, renderComponent(input.component, ctx));
}

// Default wrap: a span-only marker div for selection sync. No
// gesture awareness — the canvas overrides via input.wrapShape.
function defaultWrapShape(input: WrapShapeInput): ReactElement {
  return sourceElement(
    input.loaded.meta.produces === 'text' ? 'span' : 'div',
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
      slotsState: input.slotsState,
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
  let chapter: string | undefined;
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
    // A chapter boundary belongs to its first Slide, not every member.
    // Hidden footers still advance the chapter for subsequent slides.
    if (item.name === 'Slide') {
      const title = readString(byName(item.fills).get('chapter'), ctx);
      if (title !== undefined) chapter = title;
    }
    const el = ctx.cache ? renderCachedSlide(item, ctx, idx, chapter) : renderSlide(item, ctx, idx, chapter);
    if (el) out.push(el);
    idx += 1;
  }
  return out;
}

function renderSlide(comp: Component, ctx: LoadCtx, idx: number, chapter?: string): ReactElement | null {
  // The top-level slide invocation can be either:
  //   - a Slide built-in (frame + content), or
  //   - a custom slide component (we wrap it ourselves).
  if (comp.name === 'Slide') {
    return renderBuiltinSlide(comp, ctx, idx, chapter);
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
  // Record custom slide-producing components in slidesData too, so
  // the inspector treats them the same as builtin Slides. Their own
  // meta drives the property panel.
  ctx.slidesData.push({ comp, meta: loaded.meta });
  const inner = renderComponent(comp, ctx);
  if (!inner) return null;
  return wrapWithSpan(
    comp,
    createElement(SlideFrame, { key: idx, idx: idx + 1, label: comp.name, actLabel: chapter, children: inner }),
  );
}

function renderBuiltinSlide(comp: Component, ctx: LoadCtx, idx: number, chapter?: string): ReactElement | null {
  const fills = byName(comp.fills);
  validateAgainstMeta(comp, BUILTIN_META.Slide!, ctx);
  // Record the slide's AST + meta so the inspector can render its
  // properties as the default panel state. Pushed in slide-index
  // order (matches `slides: ReactElement[]`).
  ctx.slidesData.push({ comp, meta: BUILTIN_META.Slide! });
  const contentFill = fills.get('content');
  const label = readString(fills.get('label'), ctx);
  const notes = readText(fills.get('notes'), ctx);
  const chromeless = readBoolean(fills.get('chromeless'), ctx);
  // Missing `content` is a warning, not a fatal — emit the
  // diagnostic AND a slot-typed placeholder so the slide still
  // renders (clickable to select the slot; droppable as an
  // insertion target for registered block or slide components
  // via the toolbar). Lets newly-added empty slides
  // be a starting canvas rather than a blank no-op.
  let content: ReactNode;
  if (!contentFill) {
    emit(
      ctx,
      'missing-required-slot',
      comp.span,
      'Slide is missing required `content` slot',
    );
    content = createEmptySlotPlaceholder(
      'content',
      BUILTIN_META.Slide!.slots.content!.type,
      comp.span.start.offset,
      comp.span.end.offset,
    );
  } else {
    content = renderBlockValue(contentFill.value, ctx);
  }
  return wrapWithSpan(
    comp,
    createElement(SlideFrame, {
      key: idx,
      idx: idx + 1,
      label: label ?? '',
      actLabel: chapter,
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
  return sourceElement(
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
): ReactNode {
  if (lit.multiline) return resolved;
  return sourceElement(
    'span',
    {
      key: `text-${lit.span.start.offset}`,
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

  // Build resolved {slots, params, slotsState}.
  const slots: Record<string, unknown> = {};
  const params: Record<string, unknown> = {};
  const slotsState: Record<string, SlotState> = {};

  const fills = byName(comp.fills);
  for (const [slotName, schema] of Object.entries(loaded.meta.slots)) {
    const fill = fills.get(slotName);
    if (!fill) {
      slotsState[slotName] = 'missing';
    } else if (fill.value.kind === 'omit') {
      slotsState[slotName] = 'omit';
    } else {
      slotsState[slotName] = 'filled';
    }
    if (!fill || fill.value.kind === 'omit') {
      // No fill OR an explicit `omit` sigil. For renderable slot
      // types with no fill, inject a placeholder ReactNode the user
      // can click into (selection lands on a `kind: 'empty-slot'`
      // target). The `omit` sigil suppresses that placeholder —
      // the user has acknowledged the slot is intentionally empty.
      // Non-renderable slot types (image, scalars) stay undefined
      // either way; the component template and inspector handle
      // their absence.
      if (!fill && isRenderableSlotType(schema.type)) {
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
      slots[slotName] = sourceElement(
        schema.type === 'text-document' || schema.type === 'array<text-document>' ? 'div' : 'span',
        {
          'data-sw-slot-name': slotName,
          'data-sw-slot-span-start': fill.span.start.offset,
          'data-sw-slot-span-end': fill.span.end.offset,
          // Parent's span too — symmetric with the empty-slot
          // placeholder wrapper, so the canvas-side hit-test can
          // resolve the splice-target parent from any wrapper kind
          // without re-walking the DOM.
          'data-sw-slot-parent-start': comp.span.start.offset,
          'data-sw-slot-parent-end': comp.span.end.offset,
          'data-sw-slot-type': schema.type,
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
    if (fill && fill.value.kind !== 'omit') {
      params[paramName] = resolveSlotValue(schema.type, fill.value, ctx);
    } else if (schema.default !== undefined) {
      // For `color-token` params, a string default names a deck-scope
      // token (e.g., `'accent'` → `var(--accent)`). Matches the
      // resolution applied to source-side `name_ref` values so
      // components see a uniform CSS color string regardless of
      // whether the value came from source or from the default.
      if (schema.type === 'color-token' && typeof schema.default === 'string') {
        params[paramName] = `var(--${schema.default})`;
      } else {
        params[paramName] = schema.default;
      }
    }
  }

  if (ctx.inlineSlotOverride?.component === comp) {
    slots[ctx.inlineSlotOverride.name] = ctx.inlineSlotOverride.content;
    slotsState[ctx.inlineSlotOverride.name] = 'filled';
  }

  // Implicit children: if the body has implicitChildren and the meta
  // declares a `children` slot, fill it.
  if (
    comp.implicitChildren.length > 0 &&
    loaded.meta.slots['children'] !== undefined
  ) {
    const childrenSchema = loaded.meta.slots['children'];
    const rendered = comp.implicitChildren.map((c) => renderComponent(c, ctx));
    // Wrap with the same data-sw-slot-* span the explicit-fills
    // path emits, so the canvas's drop-target hit-test can find
    // this slot. Implicit children have no SlotFill span, so we
    // omit data-sw-slot-span-start/end; the canvas's selection
    // chain (ScaledCanvas.tsx) skips slot wrappers without a span
    // attr, so this stays correctly non-selectable as a slot —
    // clicks select the parent component, as before.
    if (isRenderableSlotType(childrenSchema.type)) {
      slots['children'] = sourceElement(
        'span',
        {
          'data-sw-slot-name': 'children',
          'data-sw-slot-parent-start': comp.span.start.offset,
          'data-sw-slot-parent-end': comp.span.end.offset,
          'data-sw-slot-type': childrenSchema.type,
          style: { display: 'contents' },
          key: `slot-children-implicit-${comp.span.start.offset}`,
        },
        rendered as ReactNode,
      );
    } else {
      slots['children'] = rendered;
    }
    // Implicit children count as 'filled' for the children slot
    // regardless of the iteration above (which only saw explicit
    // fills).
    slotsState['children'] = 'filled';
  } else if (comp.implicitChildren.length > 0) {
    emit(
      ctx,
      'invalid-implicit-children',
      comp.bodySpan,
      `\`${comp.name}\` does not declare a \`children\` slot but its body contains bare component invocations`,
      'declare a `children` slot in the component meta, or use explicit `children: [...]`',
    );
  }

  // Child components have already rendered, including their bound adapters.
  // Keep this hook opaque to the runtime, like the canvas export itself.
  const bindChildren = (loaded.canvas as {
    bindChildren?: (children: readonly ShapeData[]) => unknown;
  } | undefined)?.bindChildren;
  const childFill = comp.fills.find(fill => fill.name === 'children');
  const childNodes = childFill?.value.kind === 'list' ? childFill.value.items : comp.implicitChildren;
  const canvas = bindChildren ? bindChildren(childNodes.flatMap(child => {
    const data = ctx.shapes.get(`${child.span.start.offset}-${child.span.end.offset}`);
    return data ? [data] : [];
  })) : loaded.canvas;

  // Register shapes with canvas adapters in the registry the
  // canvas reads for selection / gesture rendering.
  if (loaded.canvas !== undefined && ctx.currentSlideIdx >= 0) {
    const key = `${comp.span.start.offset}-${comp.span.end.offset}`;
    ctx.shapes.set(key, {
      comp,
      canvas,
      meta: loaded.meta,
      params,
      slideIdx: ctx.currentSlideIdx,
      childIdx: -1, // populated post-rendering by computeChildIdxInFreeform
    });
  }

  return ctx.wrapShape({
    comp,
    loaded: canvas === loaded.canvas ? loaded : { ...loaded, canvas },
    slots,
    params,
    slotsState,
    cellKey: cellKey(comp),
  });
}

function renderSpanAsNode(comp: Component, ctx: LoadCtx): ReactNode {
  validateAgainstMeta(comp, BUILTIN_META.Span!, ctx);
  const fills = byName(comp.fills);
  const content = fills.get('content');
  const color = readColorValue(fills.get('color'), ctx);
  const font = readNameOrString(fills.get('font'), ctx);
  const size = readNumber(fills.get('size'), ctx);
  const weight = readNameOrString(fills.get('weight'), ctx);
  const letterSpacing = readNumber(fills.get('letterSpacing'), ctx);
  const strokeWidth = readNumber(fills.get('strokeWidth'), ctx);
  const strokeColor = readColorValue(fills.get('strokeColor'), ctx);
  const italic = readBoolean(fills.get('italic'), ctx);
  const underline = readBoolean(fills.get('underline'), ctx);
  const strikethrough = readBoolean(fills.get('strikethrough'), ctx);
  const href = readString(fills.get('href'), ctx);
  const inner = content ? resolveTextValue(content.value, ctx) : null;
  const style: Record<string, string> = {};
  if (color) style.color = color;
  if (font) style.fontFamily = ['body', 'display', 'mono'].includes(font) ? `var(--font-${font})` : font;
  if (size !== undefined) style.fontSize = `${size}px`;
  if (weight) style.fontWeight = weight;
  if (letterSpacing !== undefined) style.letterSpacing = `${letterSpacing}px`;
  if (strokeWidth !== undefined) style.WebkitTextStrokeWidth = `${strokeWidth}px`;
  if (strokeColor) style.WebkitTextStrokeColor = strokeColor;
  if (italic) style.fontStyle = 'italic';
  const decorations = [
    underline ? 'underline' : '',
    strikethrough ? 'line-through' : '',
  ].filter(Boolean);
  if (decorations.length > 0) style.textDecorationLine = decorations.join(' ');
  // Span is a built-in rather than a registry component, but it is
  // still a first-class, source-backed text run. Register it as a
  // lightweight layout selection so mixed styles can be selected on
  // canvas and edited through the same inspector as normal components.
  if (ctx.currentSlideIdx >= 0) {
    const key = `${comp.span.start.offset}-${comp.span.end.offset}`;
    ctx.shapes.set(key, {
      comp,
      canvas: { kind: 'layout' },
      meta: BUILTIN_META.Span!,
      params: {
        color,
        font,
        size,
        weight,
        letterSpacing,
        strokeWidth,
        strokeColor,
        italic,
        underline,
        strikethrough,
        href,
      },
      slideIdx: ctx.currentSlideIdx,
      childIdx: -1,
    });
  }
  return sourceElement(
    href ? 'a' : 'span',
    {
      style,
      key: cellKey(comp),
      ...(href ? { href } : {}),
      'data-sw-component': 'Span',
      'data-sw-span-start': comp.span.start.offset,
      'data-sw-span-end': comp.span.end.offset,
    },
    inner,
  );
}

const ORDERED_LIST_STYLES = new Set([
  'decimal',
  'decimal-leading-zero',
  'lower-alpha',
  'upper-alpha',
  'lower-roman',
  'upper-roman',
]);

function renderListAsNode(comp: Component, ctx: LoadCtx): ReactNode {
  validateAgainstMeta(comp, BUILTIN_META.List!, ctx);
  const fills = byName(comp.fills);
  const style = readNameOrString(fills.get('style'), ctx) ?? 'disc';
  const start = readNumber(fills.get('start'), ctx) ?? 1;
  const items = fills.get('items');
  const rendered: ReactNode[] = [];
  if (items?.value.kind !== 'list') {
    if (items) {
      emit(ctx, 'slot-type-mismatch', items.value.span, '`List.items` must be a list');
    }
  } else {
    for (const item of items.value.items) {
      if (item.kind !== 'component' || item.name !== 'ListItem') {
        emit(
          ctx,
          'slot-type-mismatch',
          item.span,
          '`List.items` entries must be `ListItem { ... }`',
        );
        continue;
      }
      rendered.push(renderListItemAsNode(item, ctx));
    }
  }
  const ordered = ORDERED_LIST_STYLES.has(style);
  return sourceElement(
    ordered ? 'ol' : 'ul',
    {
      key: cellKey(comp),
      ...(ordered ? { start } : {}),
      style: { margin: 0, paddingInlineStart: '1.35em', listStyleType: style },
      'data-sw-component': 'List',
      'data-sw-list-style': style,
      'data-sw-span-start': comp.span.start.offset,
      'data-sw-span-end': comp.span.end.offset,
    },
    ...rendered,
  );
}

function renderListItemAsNode(comp: Component, ctx: LoadCtx): ReactNode {
  validateAgainstMeta(comp, BUILTIN_META.ListItem!, ctx);
  const fills = byName(comp.fills);
  const content = fills.get('content');
  const children = fills.get('children');
  let nested: ReactNode = null;
  if (children && children.value.kind !== 'omit') {
    if (children.value.kind === 'component' && children.value.name === 'List') {
      nested = renderListAsNode(children.value, ctx);
    } else {
      emit(
        ctx,
        'slot-type-mismatch',
        children.value.span,
        '`ListItem.children` must be a `List { ... }`',
      );
    }
  }
  return sourceElement(
    'li',
    {
      key: cellKey(comp),
      'data-sw-component': 'ListItem',
      'data-sw-span-start': comp.span.start.offset,
      'data-sw-span-end': comp.span.end.offset,
    },
    createElement('p', { style: paragraphStyle(comp, ctx) }, content ? resolveTextValue(content.value, ctx) : null),
    nested,
  );
}

function paragraphStyle(comp: Component, ctx: LoadCtx): Record<string, string | number> {
  const fills = byName(comp.fills);
  const before = readNumber(fills.get('spaceBefore'), ctx) ?? 0;
  const after = readNumber(fills.get('spaceAfter'), ctx) ?? 0;
  const align = readString(fills.get('align'), ctx);
  const lineHeight = readNumber(fills.get('lineHeight'), ctx);
  return {
    margin: 0, marginTop: `${before}px`, marginBottom: `${after}px`, minHeight: '1em',
    marginLeft: `${readNumber(fills.get('indent'), ctx) ?? 0}px`,
    textIndent: `${readNumber(fills.get('firstLineIndent'), ctx) ?? 0}px`,
    ...(align ? { textAlign: align } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
  };
}

function renderParagraphAsNode(comp: Component, ctx: LoadCtx): ReactNode {
  validateAgainstMeta(comp, BUILTIN_META.Paragraph!, ctx);
  const fills = byName(comp.fills);
  const content = fills.get('content');
  return sourceElement('p', {
    key: cellKey(comp),
    'data-sw-component': 'Paragraph',
    'data-sw-span-start': comp.span.start.offset,
    'data-sw-span-end': comp.span.end.offset,
    style: paragraphStyle(comp, ctx),
  }, content ? resolveTextValue(content.value, ctx) : null);
}

function resolveTextDocument(value: Value, ctx: LoadCtx): ReactNode {
  if (value.kind === 'string' || value.kind === 'name_ref') {
    // Single-string migration shorthand remains source-backed, without
    // pretending the synthetic paragraph has an authored source span.
    return createElement('p', { key: cellKey(value), style: { margin: 0, minHeight: '1em' } }, resolveTextValue(value, ctx));
  }
  if (value.kind !== 'list') {
    emit(ctx, 'slot-type-mismatch', value.span, 'expected a text document: an ordered list of Paragraph/List blocks');
    return null;
  }
  const blocks = value.items.map((block) => {
    if (block.kind === 'component' && block.name === 'Paragraph') return renderParagraphAsNode(block, ctx);
    if (block.kind === 'component' && block.name === 'List') return renderListAsNode(block, ctx);
    emit(ctx, 'slot-type-mismatch', block.span, 'text document blocks must be Paragraph or List components');
    return null;
  });
  return createElement(Fragment, { key: cellKey(value) }, ...blocks);
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
  const isText = inner === 'text' || inner === 'text-document';
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
  return sourceElement(
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
export function isRenderableSlotType(type: SlotType): boolean {
  const inner = type.startsWith('array<')
    ? (type.slice(6, -1) as SlotType)
    : type;
  return inner === 'text' || inner === 'text-document' || inner === 'block' || inner === 'slide' || inner === 'slide-content';
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
    case 'text-document':
      return resolveTextDocument(value, ctx);
    case 'list-item':
      if (value.kind === 'component' && value.name === 'ListItem') return renderListItemAsNode(value, ctx);
      emit(ctx, 'slot-type-mismatch', value.span, 'expected a ListItem component');
      return null;
    case 'block':
    case 'slide-content':
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
      return readColorValue({ kind: 'slot_fill', name: '', value, span: value.span }, ctx) ?? null;
    case 'spacing-token':
    case 'font-token':
      return readNameOrString({ kind: 'slot_fill', name: '', value, span: value.span }, ctx) ?? null;
    default:
      emit(ctx, 'slot-type-mismatch', value.span, `unknown slot type: \`${type}\``);
      return null;
  }
}

function resolveTextValue(value: Value, ctx: LoadCtx): ReactNode {
  // Inline content cannot contain document blocks. Registry components
  // participate by declaring produces: 'text'; their source stays intact.
  if (value.kind === 'string') {
    const lit = ctx.cellStore.registerLiteral(nextCellId(ctx, 'text'), value.value);
    const resolved = ctx.cellStore.resolve<string>(lit, EMPTY_CONTEXT);
    return wrapEditableString(value, resolved);
  }
  if (value.kind === 'list') {
    const parts: ReactNode[] = value.items.map((v) => {
      if (v.kind === 'string') {
        return wrapEditableString(v, v.value);
      }
      if (v.kind === 'component' && v.name === 'Span') {
        return renderSpanAsNode(v, ctx);
      }
      if (v.kind === 'component' && ctx.components[v.name]?.meta.produces === 'text') {
        return renderComponent(v, ctx);
      }
      if (v.kind === 'name_ref') {
        return resolveTextValue(v, ctx);
      }
      emit(
        ctx,
        'slot-type-mismatch',
        v.span,
        'inline content must be strings, Spans, compatible references, or registered text components',
      );
      return '';
    });
    // parts already carry their own span-derived keys (text spans
    // from wrapEditableString, Span elements from renderSpanAsNode).
    // Plain strings (name_ref / fallback) are exempt from the key
    // requirement. Spread directly under the outer Fragment — the
    // earlier inner Fragment(key=i) wrap caused collisions with
    // other integer-keyed elements elsewhere in the tree.
    return createElement(Fragment, { key: cellKey(value) }, ...parts);
  }
  if (value.kind === 'component' && value.name === 'Span') {
    return renderSpanAsNode(value, ctx);
  }
  if (value.kind === 'component' && ctx.components[value.name]?.meta.produces === 'text') {
    return renderComponent(value, ctx);
  }
  if (value.kind === 'name_ref') {
    const resolved = lookup(ctx.scope, value.name);
    if (resolved === undefined) {
      emit(ctx, 'unknown-reference', value.span, `unknown name \`${value.name}\``);
      return null;
    }
    if (typeof resolved !== 'string') {
      emit(ctx, 'slot-type-mismatch', value.span, `reference \`${value.name}\` does not resolve to inline text`);
      return null;
    }
    return sourceElement('span', {
      key: cellKey(value),
      'data-sw-inline-reference': value.name,
      'data-sw-span-start': value.span.start.offset,
      'data-sw-span-end': value.span.end.offset,
    }, resolved);
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

// Resolve a `color-token`-typed slot to a ready-to-use CSS color
// string. Input kinds:
//   - name_ref `accent`   → scope binding if any (source-declared
//                           token via `Deck.tokens: Tokens { … }`),
//                           else `var(--accent)` (registry token via
//                           styles.css CSS variables).
//   - color_oklch literal → `oklch(L C H)` verbatim.
//   - string  `"#ff0080"` → passed through (lets users hand-write
//                             hex / rgb / any CSS color value).
// Components consume the returned string as-is — no per-component
// `var(--${name})` wrapping — so the same resolver can drive both
// tokens and literals.
function readColorValue(
  fill: SlotFill | undefined,
  ctx: LoadCtx,
): string | undefined {
  if (!fill) return undefined;
  const v = fill.value;
  if (v.kind === 'string') return v.value;
  if (v.kind === 'name_ref') {
    // Source-declared tokens (`Deck.tokens: Tokens { ... }`) take
    // precedence over registry-static ones — the deck author can
    // override a default token by redeclaring it. Registry tokens
    // fall through to `var(--name)` via styles.css's CSS variable
    // cascade.
    const sourced = ctx.colorTokens[v.name];
    if (sourced !== undefined) return sourced;
    return `var(--${v.name})`;
  }
  if (v.kind === 'color_oklch') return `oklch(${v.l} ${v.c} ${v.h})`;
  emit(
    ctx,
    'slot-type-mismatch',
    v.span,
    `expected a color token, color literal, or string for \`${fill.name}\``,
  );
  return undefined;
}

function cellKey(node: { span: { start: { offset: number } } }): string {
  return `cell-${node.span.start.offset}`;
}
