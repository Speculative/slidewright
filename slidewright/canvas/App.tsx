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

// Locate the index of a shape (matched by source span) within the
// active Freeform's `children` list. Used by the selection-
// preservation logic in drag and resize: spans shift on every emit
// so we can't carry the old (start, end) across, but the child
// index is stable as long as the operation only mutates the shape's
// own slot fills.
function findShapeChildIdx(
  ast: SourceFile,
  slideIdx: number,
  target: SourceRange,
): number | null {
  const freeform = findActiveSlideFreeform(ast, slideIdx);
  if (!freeform) return null;
  const childrenFill = freeform.fills.find((f) => f.name === 'children');
  if (!childrenFill || childrenFill.value.kind !== 'list') return null;
  for (let i = 0; i < childrenFill.value.items.length; i++) {
    const item = childrenFill.value.items[i];
    if (
      item &&
      item.kind === 'component' &&
      item.span.start.offset === target.start &&
      item.span.end.offset === target.end
    ) {
      return i;
    }
  }
  return null;
}

// Reverse direction: find the Component at a given index in the
// active Freeform's children list. Used after re-parsing the post-
// emit source to grab the same shape's new span.
function findShapeAtChildIdx(
  ast: SourceFile,
  slideIdx: number,
  idx: number,
): Component | null {
  const freeform = findActiveSlideFreeform(ast, slideIdx);
  if (!freeform) return null;
  const childrenFill = freeform.fills.find((f) => f.name === 'children');
  if (!childrenFill || childrenFill.value.kind !== 'list') return null;
  const item = childrenFill.value.items[idx];
  return item?.kind === 'component' ? item : null;
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

function makeStringLit(value: string): StringLit {
  return { kind: 'string', value, multiline: false, span: ZERO_SPAN };
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

function makeTextBoxNode(
  x: number,
  y: number,
  width: number,
  height: number,
): Component {
  return {
    kind: 'component',
    name: 'TextBox',
    fills: [
      makeSlotFill('x', makeNumberLit(x)),
      makeSlotFill('y', makeNumberLit(y)),
      makeSlotFill('width', makeNumberLit(width)),
      makeSlotFill('height', makeNumberLit(height)),
      // Placeholder content so the user has a visible text region
      // to double-click into. Auto-enter-edit on creation is
      // future polish.
      makeSlotFill('content', makeStringLit('Text')),
    ],
    implicitChildren: [],
    span: ZERO_SPAN,
    bodySpan: ZERO_SPAN,
  };
}

function makeArrowNode(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Component {
  return {
    kind: 'component',
    name: 'Arrow',
    fills: [
      makeSlotFill('x1', makeNumberLit(x1)),
      makeSlotFill('y1', makeNumberLit(y1)),
      makeSlotFill('x2', makeNumberLit(x2)),
      makeSlotFill('y2', makeNumberLit(y2)),
    ],
    implicitChildren: [],
    span: ZERO_SPAN,
    bodySpan: ZERO_SPAN,
  };
}

function appendShapeToFreeform(freeform: Component, shape: Component): void {
  let childrenFill = freeform.fills.find((f) => f.name === 'children');
  if (!childrenFill) {
    const list: ListLit = { kind: 'list', items: [], span: ZERO_SPAN };
    childrenFill = makeSlotFill('children', list);
    freeform.fills.push(childrenFill);
  }
  if (childrenFill.value.kind !== 'list') return;
  childrenFill.value.items.push(shape);
}

// Walks the AST and removes any Component whose source span exactly
// matches `target` from any list it appears in. Returns true if a
// removal happened. Used by the Delete-key handler — the selected
// span identifies which child of which Freeform-children list to
// drop.
function removeShapeAtSpan(
  ast: SourceFile,
  target: SourceRange,
): boolean {
  let removed = false;
  const visit = (node: Node | Value): void => {
    if (removed) return;
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
      case 'list': {
        const before = node.items.length;
        node.items = node.items.filter(
          (item) =>
            !(
              item.kind === 'component' &&
              item.span.start.offset === target.start &&
              item.span.end.offset === target.end
            ),
        );
        if (node.items.length !== before) {
          removed = true;
          return;
        }
        for (const item of node.items) visit(item);
        return;
      }
      default:
        return;
    }
  };
  visit(ast);
  return removed;
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

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface ResizeStart {
  // The shape's positioned div (the same node we mutate during drag-
  // to-move — `firstElementChild` of the data-sw-component wrapper,
  // since that wrapper is `display: contents` and has no layout box).
  inner: HTMLElement;
  // The selection outline div, mirrored alongside the shape so the
  // dashed rectangle resizes with the shape during the gesture.
  overlay: HTMLElement;
  direction: ResizeDirection;
  start: number;
  end: number;
  pointerStartX: number;
  pointerStartY: number;
  scale: number;
}

export function App({ host }: { host: Host }): ReactElement {
  const [state, setState] = useState<RenderState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [stripWidth, setStripWidth] = useState<number>(readStoredStripWidth);
  const [editing, setEditing] = useState<TextEditTarget | null>(null);
  const [dragging, setDragging] = useState<DragStart | null>(null);
  const [creating, setCreating] = useState<CreateStart | null>(null);
  const [resizing, setResizing] = useState<ResizeStart | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<SourceRange | null>(null);

  // Selection-preservation across host.setSource. Spans shift after
  // every emit (the canonical formatter rewrites whitespace), so the
  // currently-selected (start, end) won't match anything in the new
  // tree. Drag and resize commits stash the new shape's span here
  // before calling host.setSource; the subscribe handler picks it up
  // on the round-trip and re-applies it. Without this, gestures
  // would silently deselect on every commit.
  const pendingSelectionRef = useRef<SourceRange | null>(null);

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
      // Span offsets shift when emit re-canonicalizes, so the old
      // (start, end) doesn't match any shape in the new tree. Drag and
      // resize gestures pre-compute the new span and stash it in
      // pendingSelectionRef before calling setSource; pick it up here
      // so the selection survives the round-trip. Externally-driven
      // source changes (typing in the editor, file reload) leave the
      // ref empty and the selection clears as before.
      if (pendingSelectionRef.current) {
        setSelected(pendingSelectionRef.current);
        pendingSelectionRef.current = null;
      } else {
        setSelected(null);
      }
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

  // Refs for activeIdx and activeTool, read inside long-lived
  // gesture handlers (drag, create, resize). Refs avoid re-running
  // the effects on every tool/slide change — the handlers only need
  // the *current* value at gesture commit time, not the value at
  // gesture start.
  const activeIdxRef = useRef(activeIdx);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);
  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

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

    // If the dragged shape is currently selected, mirror the
    // position update onto the selection overlay so the dashed
    // outline follows in real-time. Lookup is lazy (in onMove
    // rather than at effect setup) because the selection effect
    // and the drag effect both fire from the same React batched
    // update — the overlay element may not exist yet at this
    // point in the commit.
    const isSelectedDrag =
      selected !== null && selected.start === start && selected.end === end;
    let overlayEl: HTMLElement | null = null;
    const findOverlay = (): HTMLElement | null => {
      if (!isSelectedDrag) return null;
      if (overlayEl && overlayEl.isConnected) return overlayEl;
      const el = document.querySelector(
        '.sw-canvas-stage .presentation .sw-selection-outline',
      );
      overlayEl = el instanceof HTMLElement ? el : null;
      return overlayEl;
    };

    const onMove = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      const newLeft = originalLeft + designDx;
      const newTop = originalTop + designDy;
      visualNode.style.left = `${newLeft}px`;
      visualNode.style.top = `${newTop}px`;
      const ov = findOverlay();
      if (ov) {
        ov.style.left = `${newLeft - 4}px`;
        ov.style.top = `${newTop - 4}px`;
      }
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
          // Capture the dragged shape's child index *before* emit
          // (spans in result.ast still reflect pre-emit offsets, so
          // the target span matches).
          const childIdx = isSelectedDrag
            ? findShapeChildIdx(result.ast, activeIdxRef.current, { start, end })
            : null;
          const newSource = emit(result.ast);
          if (childIdx !== null) {
            // Re-parse the post-emit source and find the same shape
            // by its (stable) child index. Stash the new span so the
            // subscribe handler re-applies the selection after
            // setSource flushes through the host.
            const reparsed = parse(newSource, '<drag-after>');
            if (!reparsed.diagnostics.some((d) => d.severity === 'error')) {
              const newShape = findShapeAtChildIdx(
                reparsed.ast,
                activeIdxRef.current,
                childIdx,
              );
              if (newShape) {
                pendingSelectionRef.current = {
                  start: newShape.span.start.offset,
                  end: newShape.span.end.offset,
                };
              }
            }
          }
          host.setSource?.(newSource);
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

  // Drag-to-resize gesture (Box / TextBox; Arrow's endpoint handles
  // are deferred to v0.2.i.2). Symmetric with drag-to-move: a corner
  // or edge handle on the selection overlay catches pointerdown and
  // sets `resizing`. This effect reads the original geometry, then
  // attaches document-level pointermove/pointerup listeners that
  // imperatively update both the shape's positioned div and the
  // overlay so the dashed outline tracks the new size in real time.
  // On release we mutate the corresponding x/y/width/height slot
  // fills, emit, setSource, and stash the new shape's span in
  // pendingSelectionRef so the round-trip preserves the selection.
  useEffect(() => {
    if (!resizing) return;
    const {
      inner: visualNode,
      overlay,
      direction,
      start,
      end,
      pointerStartX,
      pointerStartY,
      scale,
    } = resizing;
    const cs = window.getComputedStyle(visualNode);
    const originalLeft = parseFloat(cs.left) || 0;
    const originalTop = parseFloat(cs.top) || 0;
    const originalWidth = visualNode.offsetWidth;
    const originalHeight = visualNode.offsetHeight;

    const MIN_SIZE = 1;
    // Compute the new (left, top, width, height) given a pointer
    // delta and the gesture's anchor edges. Each handle direction
    // affects up to two edges; opposite edges of the rect stay put.
    // Clamping at MIN_SIZE prevents negative dimensions when the
    // user drags past the opposite edge — flipping the shape is
    // future polish.
    const computeNew = (
      designDx: number,
      designDy: number,
    ): { left: number; top: number; width: number; height: number } => {
      let newLeft = originalLeft;
      let newTop = originalTop;
      let newWidth = originalWidth;
      let newHeight = originalHeight;
      if (direction.includes('w')) {
        const proposedWidth = originalWidth - designDx;
        if (proposedWidth < MIN_SIZE) {
          newLeft = originalLeft + originalWidth - MIN_SIZE;
          newWidth = MIN_SIZE;
        } else {
          newLeft = originalLeft + designDx;
          newWidth = proposedWidth;
        }
      } else if (direction.includes('e')) {
        newWidth = Math.max(MIN_SIZE, originalWidth + designDx);
      }
      if (direction.includes('n')) {
        const proposedHeight = originalHeight - designDy;
        if (proposedHeight < MIN_SIZE) {
          newTop = originalTop + originalHeight - MIN_SIZE;
          newHeight = MIN_SIZE;
        } else {
          newTop = originalTop + designDy;
          newHeight = proposedHeight;
        }
      } else if (direction.includes('s')) {
        newHeight = Math.max(MIN_SIZE, originalHeight + designDy);
      }
      return { left: newLeft, top: newTop, width: newWidth, height: newHeight };
    };

    const onMove = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      const r = computeNew(designDx, designDy);
      visualNode.style.left = `${r.left}px`;
      visualNode.style.top = `${r.top}px`;
      visualNode.style.width = `${r.width}px`;
      visualNode.style.height = `${r.height}px`;
      // Overlay sits 4px outside the shape on each side (matches the
      // initial layout in the selection effect).
      overlay.style.left = `${r.left - 4}px`;
      overlay.style.top = `${r.top - 4}px`;
      overlay.style.width = `${r.width + 8}px`;
      overlay.style.height = `${r.height + 8}px`;
    };

    const onUp = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      // Treat near-zero motion as an accidental click on a handle —
      // no source mutation, just exit.
      if (Math.abs(designDx) < 0.5 && Math.abs(designDy) < 0.5) {
        setResizing(null);
        return;
      }
      const r = computeNew(designDx, designDy);
      const result = parse(sourceRef.current, '<resize>');
      if (!result.diagnostics.some((d) => d.severity === 'error')) {
        const target = findComponentAtSpan(result.ast, start, end);
        if (target) {
          const xSlot = findNumericSlot(target, 'x');
          const ySlot = findNumericSlot(target, 'y');
          const wSlot = findNumericSlot(target, 'width');
          const hSlot = findNumericSlot(target, 'height');
          if (xSlot) xSlot.node.value = Math.round(r.left);
          if (ySlot) ySlot.node.value = Math.round(r.top);
          if (wSlot) wSlot.node.value = Math.round(r.width);
          if (hSlot) hSlot.node.value = Math.round(r.height);
          // Capture the resized shape's child index *before* emit,
          // re-find it post-emit by index, then stash the new span
          // so the subscribe handler reapplies the selection.
          const childIdx = findShapeChildIdx(
            result.ast,
            activeIdxRef.current,
            { start, end },
          );
          const newSource = emit(result.ast);
          if (childIdx !== null) {
            const reparsed = parse(newSource, '<resize-after>');
            if (!reparsed.diagnostics.some((d) => d.severity === 'error')) {
              const newShape = findShapeAtChildIdx(
                reparsed.ast,
                activeIdxRef.current,
                childIdx,
              );
              if (newShape) {
                pendingSelectionRef.current = {
                  start: newShape.span.start.offset,
                  end: newShape.span.end.offset,
                };
              }
            }
          }
          host.setSource?.(newSource);
        }
      }
      setResizing(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    };
  }, [resizing, host]);

  // Shape-creation gesture (active when activeTool !== 'select'
  // and pointerdown lands over a Freeform). Two preview flavors:
  //   - Rectangle (Box, TextBox): dashed-blue rectangle following
  //     the pointer; on release, append a Box or TextBox node sized
  //     to the dragged rect.
  //   - Line (Arrow): dashed-blue line from start to cursor; on
  //     release, append an Arrow with the two endpoints.
  //
  // Both flavors anchor in the Freeform's coordinate system so
  // preview and final placement match. After commit, auto-return
  // to Select. (activeIdxRef / activeToolRef are declared up
  // above next to the drag effect — same refs, shared use.)
  useEffect(() => {
    if (!creating) return;
    const { containerEl, designStartX, designStartY, scale } = creating;
    const tool = activeToolRef.current;
    const isLine = tool === 'arrow';

    let rectPreview: HTMLDivElement | null = null;
    let svgPreview: SVGSVGElement | null = null;
    let linePreview: SVGLineElement | null = null;

    if (isLine) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
      svg.setAttribute(
        'style',
        'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible',
      );
      const line = document.createElementNS(ns, 'line') as SVGLineElement;
      line.setAttribute('x1', String(designStartX));
      line.setAttribute('y1', String(designStartY));
      line.setAttribute('x2', String(designStartX));
      line.setAttribute('y2', String(designStartY));
      line.setAttribute('stroke', 'rgba(0, 102, 255, 0.85)');
      line.setAttribute('stroke-width', '4');
      line.setAttribute('stroke-dasharray', '6 4');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
      containerEl.appendChild(svg);
      svgPreview = svg;
      linePreview = line;
    } else {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.left = `${designStartX}px`;
      div.style.top = `${designStartY}px`;
      div.style.width = '0px';
      div.style.height = '0px';
      div.style.background = 'rgba(0, 102, 255, 0.15)';
      div.style.border = '2px dashed rgba(0, 102, 255, 0.85)';
      div.style.boxSizing = 'border-box';
      div.style.pointerEvents = 'none';
      containerEl.appendChild(div);
      rectPreview = div;
    }

    const cursor = (clientX: number, clientY: number) => {
      const rect = containerEl.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    };

    const onMove = (e: PointerEvent) => {
      const c = cursor(e.clientX, e.clientY);
      if (linePreview) {
        linePreview.setAttribute('x2', String(c.x));
        linePreview.setAttribute('y2', String(c.y));
      } else if (rectPreview) {
        const left = Math.min(designStartX, c.x);
        const top = Math.min(designStartY, c.y);
        rectPreview.style.left = `${left}px`;
        rectPreview.style.top = `${top}px`;
        rectPreview.style.width = `${Math.abs(c.x - designStartX)}px`;
        rectPreview.style.height = `${Math.abs(c.y - designStartY)}px`;
      }
    };

    const onUp = (e: PointerEvent) => {
      const c = cursor(e.clientX, e.clientY);
      const result = parse(sourceRef.current, '<create>');
      if (!result.diagnostics.some((d) => d.severity === 'error')) {
        const freeform = findActiveSlideFreeform(
          result.ast,
          activeIdxRef.current,
        );
        if (freeform) {
          let inserted = false;
          if (tool === 'arrow') {
            // Treat very short lines as accidental clicks.
            const dx = c.x - designStartX;
            const dy = c.y - designStartY;
            if (Math.hypot(dx, dy) >= 5) {
              appendShapeToFreeform(
                freeform,
                makeArrowNode(
                  Math.round(designStartX),
                  Math.round(designStartY),
                  Math.round(c.x),
                  Math.round(c.y),
                ),
              );
              inserted = true;
            }
          } else {
            const left = Math.round(Math.min(designStartX, c.x));
            const top = Math.round(Math.min(designStartY, c.y));
            const width = Math.round(Math.abs(c.x - designStartX));
            const height = Math.round(Math.abs(c.y - designStartY));
            if (width >= 5 && height >= 5) {
              appendShapeToFreeform(
                freeform,
                tool === 'textbox'
                  ? makeTextBoxNode(left, top, width, height)
                  : makeBoxNode(left, top, width, height, 'amber'),
              );
              inserted = true;
            }
          }
          if (inserted) {
            host.setSource?.(emit(result.ast));
            setActiveTool('select');
          }
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
      if (rectPreview?.parentElement) {
        rectPreview.parentElement.removeChild(rectPreview);
      }
      if (svgPreview?.parentElement) {
        svgPreview.parentElement.removeChild(svgPreview);
      }
    };
  }, [creating, host]);

  // Escape returns to the Select tool *and* clears any active
  // selection. Common modal-tool convention. Also wires Delete /
  // Backspace to remove the selected shape from its parent list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (activeTool !== 'select') setActiveTool('select');
        if (selected) setSelected(null);
        e.preventDefault();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        const result = parse(sourceRef.current, '<delete>');
        if (!result.diagnostics.some((d) => d.severity === 'error')) {
          if (removeShapeAtSpan(result.ast, selected)) {
            host.setSource?.(emit(result.ast));
            setSelected(null);
          }
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, selected, host]);

  // Selection overlay. Computes bounds from the selected shape's
  // DOM (offsetLeft/Top/Width/Height for div-shapes; line attrs
  // for Arrow), appends an outline div to the active Freeform.
  // Re-runs on source change since the wrapper element identities
  // change after each emit + re-render.
  useEffect(() => {
    if (!selected || !state) return;
    // Find the active slide's Freeform DOM. Scope the query to the
    // .presentation container so thumbnails (which contain their
    // own Freeforms) aren't accidentally targeted.
    const presentation = document.querySelector(
      '.sw-canvas-stage .presentation',
    );
    if (!presentation) return;
    const shapeWrapper = presentation.querySelector(
      `[data-sw-span-start="${selected.start}"][data-sw-span-end="${selected.end}"]`,
    );
    if (!shapeWrapper) return;
    const shapeInner = shapeWrapper.firstElementChild;
    if (!shapeInner) return;

    let bounds: { left: number; top: number; width: number; height: number };
    const componentName = shapeWrapper.getAttribute('data-sw-component');
    if (componentName === 'Arrow') {
      const line = shapeInner.querySelector('line');
      if (!line) return;
      const x1 = parseFloat(line.getAttribute('x1') ?? '0');
      const y1 = parseFloat(line.getAttribute('y1') ?? '0');
      const x2 = parseFloat(line.getAttribute('x2') ?? '0');
      const y2 = parseFloat(line.getAttribute('y2') ?? '0');
      bounds = {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    } else {
      // Box / TextBox: read the absolutely-positioned div's offset
      // metrics (in design-space CSS pixels — the canvas's CSS
      // transform doesn't affect offset values).
      if (!(shapeInner instanceof HTMLElement)) return;
      bounds = {
        left: shapeInner.offsetLeft,
        top: shapeInner.offsetTop,
        width: shapeInner.offsetWidth,
        height: shapeInner.offsetHeight,
      };
    }

    // Anchor the overlay on the Freeform that contains the shape.
    const freeformWrapper = shapeWrapper.closest('[data-sw-component="Freeform"]');
    const freeformDiv = freeformWrapper?.firstElementChild;
    if (!(freeformDiv instanceof HTMLElement)) return;

    const overlay = document.createElement('div');
    overlay.className = 'sw-selection-outline';
    overlay.style.position = 'absolute';
    overlay.style.left = `${bounds.left - 4}px`;
    overlay.style.top = `${bounds.top - 4}px`;
    overlay.style.width = `${bounds.width + 8}px`;
    overlay.style.height = `${bounds.height + 8}px`;
    // Overlay body is event-transparent so the underlying shape
    // still receives clicks (re-select, drag-to-move). The handles
    // appended below set their own pointer-events: auto to catch
    // resize gestures.
    overlay.style.pointerEvents = 'none';
    freeformDiv.appendChild(overlay);

    // Resize handles. Only Box / TextBox get handles in v0.2.i.1 —
    // Arrow has different geometry (two endpoints, no width/height
    // slots) and lands separately in v0.2.i.2. Handles render only
    // in Select mode so creation tools (which take pointerdown over
    // any visible shape) aren't shadowed.
    const handleCleanups: Array<() => void> = [];
    if (
      activeTool === 'select' &&
      (componentName === 'Box' || componentName === 'TextBox') &&
      shapeInner instanceof HTMLElement
    ) {
      const directions: ResizeDirection[] = [
        'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
      ];
      for (const dir of directions) {
        const handle = document.createElement('div');
        handle.className = `sw-resize-handle-shape sw-resize-${dir}`;
        const onPointerDown = (event: PointerEvent): void => {
          if (event.button !== 0) return;
          // Stop propagation so ScaledCanvas's pointerdown handler
          // doesn't also fire (which would re-emit selection / start
          // a drag-to-move on the same gesture).
          event.stopPropagation();
          event.preventDefault();
          // Read scale fresh from the canvas's transform via its
          // bounding rect — DESIGN_W is the canvas's untransformed
          // width, getBoundingClientRect's width is post-transform.
          const canvasEl = document.querySelector(
            '.sw-canvas-stage .presentation-canvas',
          );
          const scale =
            canvasEl instanceof HTMLElement
              ? canvasEl.getBoundingClientRect().width / 1920
              : 1;
          setResizing({
            inner: shapeInner,
            overlay,
            direction: dir,
            start: selected.start,
            end: selected.end,
            pointerStartX: event.clientX,
            pointerStartY: event.clientY,
            scale,
          });
        };
        handle.addEventListener('pointerdown', onPointerDown);
        handleCleanups.push(() =>
          handle.removeEventListener('pointerdown', onPointerDown),
        );
        overlay.appendChild(handle);
      }
    }

    return () => {
      for (const fn of handleCleanups) fn();
      overlay.parentElement?.removeChild(overlay);
    };
  }, [selected, state, activeTool]);

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
              onSelectShape={(range) => setSelected(range)}
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
