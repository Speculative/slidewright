// Slidewright canvas — host-agnostic React app.
//
// Receives source-of-truth from a Host (VSCodeHost in the extension,
// StandaloneHost in the standalone web app), runs the slidewright
// runtime against it, and renders the active slide via ScaledCanvas.
// A vertical SlideStrip on the left shows thumbnails for navigation.
//
// The deck-specific bits (component registry, static color tokens) are
// imported from decks/v0-reference/registry. v0.2 will replace this
// with an on-the-fly deck loader; for v0.1 the canvas is hardcoded to
// v0-reference.

import { cloneElement, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { loadDeck } from '../runtime/loader.js';
import type { Diagnostic } from '../runtime/diagnostics.js';
import { emit } from '../runtime/emitter.js';
import { parse } from '../runtime/parser.js';
import type {
  Component,
  ListLit,
  NameRef,
  Node,
  NumberLit,
  SlotFill,
  SourceFile,
  Span,
  StringLit,
  Value,
} from '../runtime/ast.js';
import { components, staticTokens } from '../../decks/v0-reference/registry.js';
import { DeckMetaContext } from '../../src/Slide.jsx';

import type { Host, SourceRange } from './host.js';
import {
  ScaledCanvas,
  type CreateStart,
  type DragStart,
  type TextEditTarget,
} from './ScaledCanvas.js';
import { DiagnosticsPanel } from './DiagnosticsPanel.js';
import { SlideStrip } from './SlideStrip.js';
import { ResizeHandle } from './ResizeHandle.js';
import { ToolPalette, type Tool } from './ToolPalette.js';

interface DeckMeta {
  name: string;
  subtitle: string;
}

interface RenderState {
  slides: ReactElement[];
  diagnostics: Diagnostic[];
  fileName: string;
  meta: DeckMeta;
  // Kept on render state so text-edit commits can splice into it
  // without a parallel host.subscribe subscription.
  source: string;
}

// Pre-Section slides in the existing scaffold show "Setup" in the
// chrome's act position (Presentation.jsx:67 — `let actLabel =
// setupLabel`, default "Setup"). v0.1's canvas doesn't yet model
// Section dividers / acts, so all slides land in the pre-Section
// "Setup" act. v0.2+ will track acts when navigation lands.
const DEFAULT_ACT_LABEL = 'Setup';

const STRIP_WIDTH_KEY = 'slidewright.canvas.stripWidth';
const STRIP_WIDTH_DEFAULT = 280;
const STRIP_WIDTH_MIN = 200;
const STRIP_WIDTH_MAX = 600;

function readStoredStripWidth(): number {
  try {
    const raw = localStorage.getItem(STRIP_WIDTH_KEY);
    if (raw == null) return STRIP_WIDTH_DEFAULT;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return STRIP_WIDTH_DEFAULT;
    return Math.max(STRIP_WIDTH_MIN, Math.min(STRIP_WIDTH_MAX, n));
  } catch {
    return STRIP_WIDTH_DEFAULT;
  }
}

// Walks the AST looking for a StringLit whose source span exactly
// matches `(start, end)`. Used by the text-edit commit path to find
// the node corresponding to the rendered <span data-sw-text-span-*>
// the user double-clicked. Spans are stable byte offsets — they
// uniquely identify the literal even when other strings in the
// source share the same value.
function findStringAt(
  root: SourceFile,
  start: number,
  end: number,
): StringLit | null {
  let found: StringLit | null = null;
  const visit = (node: Node | Value): void => {
    if (found) return;
    if (
      node.kind === 'string' &&
      node.span.start.offset === start &&
      node.span.end.offset === end
    ) {
      found = node;
      return;
    }
    switch (node.kind) {
      case 'source_file':
        for (const c of node.items) visit(c);
        return;
      case 'component':
        for (const f of node.fills) visit(f);
        for (const c of node.implicitChildren) visit(c);
        return;
      case 'slot_fill':
        visit(node.value);
        return;
      case 'list':
        for (const v of node.items) visit(v);
        return;
      default:
        return;
    }
  };
  visit(root);
  return found;
}

// Same idea as findStringAt, but for whole component invocations —
// used by the drag-to-move gesture to find the AST node whose x/y
// slot-fill values need updating.
function findComponentAtSpan(
  root: SourceFile,
  start: number,
  end: number,
): Component | null {
  let found: Component | null = null;
  const visit = (node: Node | Value): void => {
    if (found) return;
    if (
      node.kind === 'component' &&
      node.span.start.offset === start &&
      node.span.end.offset === end
    ) {
      found = node;
      return;
    }
    switch (node.kind) {
      case 'source_file':
        for (const c of node.items) visit(c);
        return;
      case 'component':
        for (const f of node.fills) visit(f);
        for (const c of node.implicitChildren) visit(c);
        return;
      case 'slot_fill':
        visit(node.value);
        return;
      case 'list':
        for (const v of node.items) visit(v);
        return;
      default:
        return;
    }
  };
  visit(root);
  return found;
}

// Reads a numeric slot fill from a component, returning the AST node
// (so the drag handler can mutate its `value` in place) and the
// current numeric value. Returns null if the slot isn't a plain
// number — a future "computed defaults" world might have a
// solve.* expression here, in which case dragging would need to
// promote it to a literal-override; v0.2.e dodges that by skipping
// non-literal cases.
function findNumericSlot(
  comp: Component,
  name: string,
): { node: NumberLit; value: number } | null {
  for (const fill of comp.fills) {
    if (fill.name === name && fill.value.kind === 'number') {
      return { node: fill.value, value: fill.value.value };
    }
  }
  return null;
}

// Walks a freshly parsed AST to find the Freeform that's the
// `content` of the active slide. v0.2.f's Box drawing tool only
// supports slides where content is *directly* a Freeform — the
// reference deck's Freeform-demo slide. Future generalization
// (drawing inside Freeforms nested deeper, e.g., inside a ZStack)
// is straightforward but not in scope.
function findActiveSlideFreeform(
  ast: SourceFile,
  activeIdx: number,
): Component | null {
  const deck = ast.items[0];
  if (!deck || deck.name !== 'Deck') return null;
  const slidesFill = deck.fills.find((f) => f.name === 'slides');
  if (!slidesFill || slidesFill.value.kind !== 'list') return null;
  const slide = slidesFill.value.items[activeIdx];
  if (!slide || slide.kind !== 'component' || slide.name !== 'Slide') return null;
  const contentFill = slide.fills.find((f) => f.name === 'content');
  if (
    !contentFill ||
    contentFill.value.kind !== 'component' ||
    contentFill.value.name !== 'Freeform'
  ) {
    return null;
  }
  return contentFill.value;
}

// Constructs synthetic AST nodes for inserting a new shape. Spans
// are placeholder zeros — the emitter ignores spans, and the next
// re-parse rebuilds them from the actual source. The placeholder
// keeps the type system happy without needing a separate "AST
// without spans" representation.
const ZERO_SPAN: Span = {
  start: { offset: 0, line: 0, column: 0 },
  end: { offset: 0, line: 0, column: 0 },
};

function makeNumberLit(value: number): NumberLit {
  return { kind: 'number', value, span: ZERO_SPAN };
}

function makeNameRef(name: string): NameRef {
  return { kind: 'name_ref', name, span: ZERO_SPAN };
}

function makeSlotFill(name: string, value: Value): SlotFill {
  return { kind: 'slot_fill', name, value, span: ZERO_SPAN };
}

function makeBoxNode(
  x: number,
  y: number,
  width: number,
  height: number,
  fillToken: string,
): Component {
  return {
    kind: 'component',
    name: 'Box',
    fills: [
      makeSlotFill('x', makeNumberLit(x)),
      makeSlotFill('y', makeNumberLit(y)),
      makeSlotFill('width', makeNumberLit(width)),
      makeSlotFill('height', makeNumberLit(height)),
      makeSlotFill('fill', makeNameRef(fillToken)),
    ],
    implicitChildren: [],
    span: ZERO_SPAN,
    bodySpan: ZERO_SPAN,
  };
}

function appendBoxToFreeform(
  freeform: Component,
  x: number,
  y: number,
  width: number,
  height: number,
  fillToken: string,
): void {
  let childrenFill = freeform.fills.find((f) => f.name === 'children');
  if (!childrenFill) {
    const list: ListLit = { kind: 'list', items: [], span: ZERO_SPAN };
    childrenFill = makeSlotFill('children', list);
    freeform.fills.push(childrenFill);
  }
  if (childrenFill.value.kind !== 'list') return;
  childrenFill.value.items.push(makeBoxNode(x, y, width, height, fillToken));
}

// Inject the props that Presentation.jsx normally adds (active=true so
// styles.css's .slide.active visibility rule kicks in, actLabel so the
// chrome's third crumb isn't blank). The slide arrives pre-wrapped by
// the loader for selection sync — see slidewright/runtime/loader.ts /
// wrapWithSpan — so we clone the *inner* SlideFrame, not the wrapper
// div, and rewrap. Cloning the wrapper directly would leak `active`
// and `actLabel` onto a plain <div> and trigger React DOM warnings.
export function prepareSlide(wrappedSlide: ReactElement): ReactElement {
  const inner = (wrappedSlide.props as { children?: ReactElement }).children;
  if (!inner || typeof inner !== 'object' || !('type' in inner)) {
    return wrappedSlide;
  }
  const preparedInner = cloneElement(inner, {
    active: true,
    actLabel: DEFAULT_ACT_LABEL,
  } as Record<string, unknown>);
  return cloneElement(wrappedSlide, undefined, preparedInner);
}

export function App({ host }: { host: Host }): ReactElement {
  const [state, setState] = useState<RenderState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [stripWidth, setStripWidth] = useState<number>(readStoredStripWidth);
  const [editing, setEditing] = useState<TextEditTarget | null>(null);
  const [dragging, setDragging] = useState<DragStart | null>(null);
  const [creating, setCreating] = useState<CreateStart | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('select');

  useEffect(() => {
    try {
      localStorage.setItem(STRIP_WIDTH_KEY, String(stripWidth));
    } catch {
      // Storage unavailable (e.g., disabled in webview); fine to lose.
    }
  }, [stripWidth]);

  useEffect(() => {
    return host.subscribe(({ source, fileName, assets }) => {
      const scope = {
        bindings: { ...staticTokens, ...assets },
      };
      const result = loadDeck({
        source,
        file: fileName,
        components,
        scope,
      });
      setState((prev) => {
        const next: RenderState = {
          slides: result.slides,
          diagnostics: result.diagnostics,
          fileName,
          meta: { name: result.meta.name, subtitle: result.meta.subtitle },
          source,
        };
        // Clamp activeIdx if the new deck has fewer slides than where
        // we were. Done as a side-effect to keep the state setter pure.
        if (prev && next.slides.length > 0 && activeIdx >= next.slides.length) {
          queueMicrotask(() => setActiveIdx(next.slides.length - 1));
        }
        return next;
      });
    });
  }, [host, activeIdx]);

  const total = state?.slides.length ?? 0;
  const select = useCallback(
    (idx: number) => {
      if (total === 0) return;
      const clamped = Math.max(0, Math.min(total - 1, idx));
      setActiveIdx(clamped);
    },
    [total],
  );

  // Source-cursor → canvas-slide sync (v0.1e Phase 2). The host emits
  // the .sw-editor's caret offset whenever it moves; we walk the
  // slide list and pick the one whose top-level span contains the
  // offset. Reading the data-sw-span attrs directly off the React
  // elements (placed by loader.ts/wrapWithSpan) keeps span info
  // available without a parallel data structure.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    if (!host.onCursorChange) return;
    return host.onCursorChange((offset) => {
      const cur = stateRef.current;
      if (!cur) return;
      for (let i = 0; i < cur.slides.length; i++) {
        const slide = cur.slides[i];
        if (!slide) continue;
        const props = slide.props as Record<string, unknown>;
        const s = props['data-sw-span-start'];
        const e = props['data-sw-span-end'];
        if (
          typeof s === 'number' &&
          typeof e === 'number' &&
          offset >= s &&
          offset <= e
        ) {
          setActiveIdx(i);
          return;
        }
      }
    });
  }, [host]);

  // Keyboard nav — mirrors src/Presentation.jsx's handler. Skips when
  // the focus is inside an editable text element so the host-side
  // editor (or future inline-text-edit gestures) don't lose keys.
  useEffect(() => {
    if (total === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key;
      let handled = true;
      if (
        k === 'ArrowRight' ||
        k === 'ArrowDown' ||
        k === 'PageDown' ||
        k === ' ' ||
        k === 'Spacebar'
      ) {
        setActiveIdx((i) => Math.min(total - 1, i + 1));
      } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') {
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (k === 'Home') {
        setActiveIdx(0);
      } else if (k === 'End') {
        setActiveIdx(Math.max(0, total - 1));
      } else if (/^[0-9]$/.test(k)) {
        const n = k === '0' ? 9 : parseInt(k, 10) - 1;
        if (n < total) setActiveIdx(n);
      } else {
        handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  // Text-edit gesture: when `editing` is set, flip the targeted span
  // to contentEditable, focus it, select all. Editing happens directly
  // on the styled element so font / color / scaling all carry through
  // for free — no overlay positioning, no font-size mismatch with the
  // CSS-transformed canvas. React doesn't track contentEditable as a
  // prop, so the imperative attribute setting survives re-renders as
  // long as the slide React tree doesn't change (which it doesn't
  // until host.setSource fires).
  const sourceRef = useRef<string>('');
  useEffect(() => {
    sourceRef.current = state?.source ?? '';
  }, [state]);
  useEffect(() => {
    if (!editing) return;
    const { node, originalText, start, end } = editing;
    // `plaintext-only` (Chromium / WebKit) keeps browser-default
    // formatting commands (Cmd+B etc.) from inserting markup; Firefox
    // treats it as `true` which is acceptable.
    node.contentEditable = 'plaintext-only';
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    let exited: 'commit' | 'cancel' | null = null;

    const finish = (intent: 'commit' | 'cancel') => {
      if (exited !== null) return;
      exited = intent;
      const newText = node.textContent ?? '';
      node.contentEditable = 'false';
      if (intent === 'commit' && newText !== originalText) {
        // Re-parse current source, mutate the StringLit at (start,
        // end), re-emit. Going through the canonical formatter
        // means we lose adjacent-string concatenation (a single
        // literal is emitted in place of two), but we preserve
        // comments — and we know the round-trip is structurally
        // sound because the property tests cover it.
        const src = sourceRef.current;
        const result = parse(src, '<edit>');
        if (result.diagnostics.some((d) => d.severity === 'error')) {
          // Source is currently broken; bail rather than emit on
          // top of a partial AST.
          setEditing(null);
          return;
        }
        const target = findStringAt(result.ast, start, end);
        if (target) {
          target.value = newText;
          host.setSource?.(emit(result.ast));
        }
      } else if (intent === 'cancel') {
        // Restore the original text — without this, the user-typed
        // content stays in the DOM until the next host re-render.
        node.textContent = originalText;
      }
      setEditing(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish('commit');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish('cancel');
      }
    };
    const onBlur = () => finish('commit');

    node.addEventListener('keydown', onKeyDown);
    node.addEventListener('blur', onBlur);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
      node.removeEventListener('blur', onBlur);
      // Defensive: if effect re-runs while still mid-edit, leave the
      // element in a sane state so it's not mysteriously editable.
      if (exited === null) node.contentEditable = 'false';
    };
  }, [editing, host]);

  // Drag-to-move gesture. ScaledCanvas hands us the dragged DOM
  // node + the AST span + the canvas scale at drag-start. We update
  // the visual node's CSS imperatively during the gesture (React
  // doesn't own `style.left` / `style.top` — they're inline-style
  // properties we wrote, so React will overwrite them on the next
  // render after we've committed via host.setSource). On pointerup,
  // re-parse the current source, mutate the targeted Component's
  // `x` / `y` slot fills, emit, setSource.
  //
  // The data-sw-component wrapper is `display: contents` (so it
  // doesn't disrupt layout), which means it has no layout box of
  // its own — getComputedStyle(...).left returns "auto" and
  // imperative style changes have no effect. The actual positioned
  // element is its first child (the rendered shape's root div), so
  // we step through to that for both reading the original position
  // and applying the live drag preview.
  //
  // TODO(v0.4): Ctrl+Z on canvas-driven edits doesn't restore — the
  // textarea sees host.setSource as an external value change, not
  // typing, so its built-in undo stack doesn't track canvas
  // gestures. SLIDEWRIGHT.md / Undo/redo commits to a unified
  // canvas-gesture undo stack at v0.4.
  useEffect(() => {
    if (!dragging) return;
    const { node, start, end, pointerStartX, pointerStartY, scale } = dragging;
    const visualNode = node.firstElementChild;
    if (!(visualNode instanceof HTMLElement)) {
      setDragging(null);
      return;
    }
    const cs = window.getComputedStyle(visualNode);
    const originalLeft = parseFloat(cs.left) || 0;
    const originalTop = parseFloat(cs.top) || 0;

    const onMove = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      visualNode.style.left = `${originalLeft + designDx}px`;
      visualNode.style.top = `${originalTop + designDy}px`;
    };

    const onUp = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      // Treat near-zero motion as a click rather than a drag — no
      // source mutation. Threshold is in design-space pixels so the
      // result is consistent across canvas zoom levels.
      if (Math.abs(designDx) < 0.5 && Math.abs(designDy) < 0.5) {
        setDragging(null);
        return;
      }
      const result = parse(sourceRef.current, '<drag>');
      if (!result.diagnostics.some((d) => d.severity === 'error')) {
        const target = findComponentAtSpan(result.ast, start, end);
        if (target) {
          const xSlot = findNumericSlot(target, 'x');
          const ySlot = findNumericSlot(target, 'y');
          if (xSlot) xSlot.node.value = Math.round(originalLeft + designDx);
          if (ySlot) ySlot.node.value = Math.round(originalTop + designDy);
          host.setSource?.(emit(result.ast));
        }
      }
      setDragging(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, host]);

  // Box-creation gesture (active when activeTool === 'box' and
  // pointerdown happens over a Freeform). An imperative preview div
  // is appended to the Freeform's render element for the duration
  // of the drag — sized in design-space pixels, which scale
  // automatically with the canvas's CSS transform. The preview and
  // the final Box share the Freeform's coordinate system, so the
  // shape lands exactly where it was drawn.
  //
  // After commit, we auto-return to the Select tool — matches the
  // typical drawing-app convention where each tool fires once.
  // (Figma stays in tool mode; we may revisit if the auto-return
  // feels rushed in practice.)
  const activeIdxRef = useRef(activeIdx);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);
  useEffect(() => {
    if (!creating) return;
    const {
      containerEl,
      pointerStartX,
      pointerStartY,
      designStartX,
      designStartY,
      scale,
    } = creating;
    void pointerStartX;
    void pointerStartY;

    const preview = document.createElement('div');
    preview.style.position = 'absolute';
    preview.style.left = `${designStartX}px`;
    preview.style.top = `${designStartY}px`;
    preview.style.width = '0px';
    preview.style.height = '0px';
    preview.style.background = 'rgba(0, 102, 255, 0.15)';
    preview.style.border = '2px dashed rgba(0, 102, 255, 0.85)';
    preview.style.boxSizing = 'border-box';
    preview.style.pointerEvents = 'none';
    containerEl.appendChild(preview);

    const updateRect = (clientX: number, clientY: number) => {
      const rect = containerEl.getBoundingClientRect();
      const cursorX = (clientX - rect.left) / scale;
      const cursorY = (clientY - rect.top) / scale;
      const left = Math.min(designStartX, cursorX);
      const top = Math.min(designStartY, cursorY);
      const width = Math.abs(cursorX - designStartX);
      const height = Math.abs(cursorY - designStartY);
      return { left, top, width, height };
    };

    const onMove = (e: PointerEvent) => {
      const { left, top, width, height } = updateRect(e.clientX, e.clientY);
      preview.style.left = `${left}px`;
      preview.style.top = `${top}px`;
      preview.style.width = `${width}px`;
      preview.style.height = `${height}px`;
    };

    const onUp = (e: PointerEvent) => {
      const { left, top, width, height } = updateRect(e.clientX, e.clientY);
      // Tiny rectangles are treated as accidental clicks; no source
      // change. 5 design-space pixels is a small enough threshold
      // that intentional small shapes still go through.
      if (width < 5 || height < 5) {
        setCreating(null);
        return;
      }
      const result = parse(sourceRef.current, '<create>');
      if (!result.diagnostics.some((d) => d.severity === 'error')) {
        const freeform = findActiveSlideFreeform(
          result.ast,
          activeIdxRef.current,
        );
        if (freeform) {
          appendBoxToFreeform(
            freeform,
            Math.round(left),
            Math.round(top),
            Math.round(width),
            Math.round(height),
            'amber',
          );
          host.setSource?.(emit(result.ast));
          setActiveTool('select');
        }
      }
      setCreating(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (preview.parentElement) {
        preview.parentElement.removeChild(preview);
      }
    };
  }, [creating, host]);

  // Escape returns to the Select tool. Common modal-tool convention
  // and avoids the user feeling trapped if they press Box and don't
  // know how to exit.
  useEffect(() => {
    if (activeTool === 'select') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveTool('select');
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool]);

  if (!state) {
    return <div className="sw-canvas-status">waiting for source…</div>;
  }

  const errors = state.diagnostics.filter((d) => d.severity === 'error');
  const slide = state.slides[activeIdx];

  // Same prep the strip thumbnails use — keeps chrome consistent
  // across active slide and thumbnails. The slide element comes
  // pre-wrapped from the loader (<div data-sw-span-...><SlideFrame
  // /></div> for selection sync); we clone the *inner* slide with
  // active/actLabel props and rewrap so the wrapper div doesn't get
  // unknown DOM props.
  const preparedSlide = slide ? prepareSlide(slide) : null;

  return (
    <DeckMetaContext.Provider
      value={{
        name: state.meta.name,
        subtitle: state.meta.subtitle,
        total,
      }}
    >
      <div className="sw-canvas-status">
        {state.fileName.split('/').pop()} · slide {activeIdx + 1} of {total}
      </div>
      <DiagnosticsPanel diagnostics={errors} />
      <div className="sw-canvas-body">
        <SlideStrip
          slides={state.slides}
          activeIdx={activeIdx}
          onSelect={select}
          width={stripWidth}
        />
        <ResizeHandle
          size={stripWidth}
          setSize={setStripWidth}
          min={STRIP_WIDTH_MIN}
          max={STRIP_WIDTH_MAX}
        />
        {preparedSlide ? (
          <div className="sw-canvas-stage">
            <ToolPalette active={activeTool} onSelect={setActiveTool} />
            <ScaledCanvas
              onSelectRange={(range: SourceRange) => host.sendSelection(range)}
              onTextEdit={(target) => setEditing(target)}
              onDragStart={(target) => setDragging(target)}
              onCreateStart={(target) => setCreating(target)}
              activeTool={activeTool}
            >
              {preparedSlide}
            </ScaledCanvas>
          </div>
        ) : null}
      </div>
    </DeckMetaContext.Provider>
  );
}
