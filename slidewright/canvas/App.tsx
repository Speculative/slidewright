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
import type { Component } from '../runtime/ast.js';
import { components, staticTokens } from '../../decks/v0-reference/registry.js';
import { DeckMetaContext } from '../../src/Slide.jsx';

import type { Host, SourceRange } from './host.js';
import {
  ScaledCanvas,
  type CreateStart,
  type DragStart,
  type TextEditTarget,
} from './ScaledCanvas.js';
import {
  appendShapeToFreeform,
  commitSourceEdit,
  computeArrowGeometry,
  findActiveSlideFreeform,
  findComponentAtSpan,
  findNumericSlot,
  findShapeChildIdx,
  findStringAt,
  makeArrowNode,
  makeBoxNode,
  makeTextBoxNode,
  removeShapeAtSpan,
} from './ast-edits.js';
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

// Box / TextBox: drag a corner or edge handle to resize the
// rectangle. The opposite edges stay fixed; we mutate x / y /
// width / height slot fills on commit.
interface BoxResizeStart {
  kind: 'box';
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

// Arrow endpoint resize: drag one of the two handles at (x1, y1) /
// (x2, y2) to move just that endpoint. The other endpoint stays
// put. Live preview updates the SVG line + polygon attributes
// directly (recomputing the arrowhead each frame so it points the
// new direction); commit mutates only the moving endpoint's slot
// fills.
interface ArrowEndpointResizeStart {
  kind: 'arrow-endpoint';
  endpoint: 1 | 2;
  svgEl: SVGSVGElement;
  // The polygon is held by reference (rather than re-queried each
  // frame) since it's the only one of its kind. Lines are queried
  // off svgEl every gesture-start because Arrow.tsx renders two
  // (visible + hit-area) — see Arrow.tsx for why.
  polygonEl: SVGPolygonElement;
  overlay: HTMLElement;
  handle: HTMLElement;        // the handle being dragged (live-tracks the moving endpoint)
  origX: number;              // moving endpoint's original x in design space
  origY: number;              // moving endpoint's original y
  fixedX: number;             // other endpoint x (stays put)
  fixedY: number;
  strokeWidth: number;
  start: number;
  end: number;
  pointerStartX: number;
  pointerStartY: number;
  scale: number;
}

type ResizeStart = BoxResizeStart | ArrowEndpointResizeStart;

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
        const result = commitSourceEdit(sourceRef.current, '<edit>', (ast) => {
          const target = findStringAt(ast, start, end);
          if (!target) return null;
          target.value = newText;
          return {};
        });
        if (result) host.setSource?.(result.newSource);
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
    if (!(visualNode instanceof Element)) {
      setDragging(null);
      return;
    }

    // Two flavors of body-drag, plumbed through the same gesture
    // lifecycle (pointermove/pointerup, commit on release). They
    // differ in:
    //   - Box / TextBox: write style.left/top imperatively; commit
    //     mutates `x` / `y` slot fills.
    //   - Arrow: write line + polygon attributes imperatively each
    //     frame (re-running the arrowhead geometry); commit mutates
    //     `x1` / `y1` / `x2` / `y2` slot fills by the same delta.
    //     CSS transform was tempting (one-line preview) but stuck
    //     on the SVG element across React re-renders, leaving the
    //     post-commit shape visually offset by the drag delta on
    //     top of the new coords.
    const componentName = node.getAttribute('data-sw-component');
    const isArrow = componentName === 'Arrow';
    const isSelectedDrag =
      selected !== null && selected.start === start && selected.end === end;

    type LiveStep = (designDx: number, designDy: number) => void;
    type Commit = (
      target: Component,
      designDx: number,
      designDy: number,
    ) => void;

    let live: LiveStep;
    let commit: Commit;

    if (isArrow) {
      if (!(visualNode instanceof SVGSVGElement)) {
        setDragging(null);
        return;
      }
      const lineEls = Array.from(visualNode.querySelectorAll('line'));
      const polyEl = visualNode.querySelector('polygon');
      if (lineEls.length === 0 || !polyEl) {
        setDragging(null);
        return;
      }
      const firstLine = lineEls[0]!;
      const origX1 = parseFloat(firstLine.getAttribute('x1') ?? '0');
      const origY1 = parseFloat(firstLine.getAttribute('y1') ?? '0');
      const origStroke = parseFloat(
        firstLine.getAttribute('stroke-width') ?? '4',
      );
      const polyPoints = polyEl.getAttribute('points') ?? '';
      const firstVertex = polyPoints.split(/\s+/)[0] ?? '0,0';
      const [tipXStr, tipYStr] = firstVertex.split(',');
      const origX2 = parseFloat(tipXStr ?? '0');
      const origY2 = parseFloat(tipYStr ?? '0');

      // Lazy lookup: the selection effect runs after this drag
      // effect (declaration order), so the overlay + endpoint
      // handles aren't in the DOM yet at gesture-start. Defer the
      // queries to the first onMove call.
      let lookedUp = false;
      let overlayEl: HTMLElement | null = null;
      let endpointEls: HTMLElement[] = [];
      const ensureSelectionDOM = (): void => {
        if (!isSelectedDrag || lookedUp) return;
        lookedUp = true;
        const presentation = document.querySelector(
          '.sw-canvas-stage .presentation',
        );
        if (!presentation) return;
        const ov = presentation.querySelector('.sw-selection-outline');
        if (ov instanceof HTMLElement) overlayEl = ov;
        presentation.querySelectorAll('.sw-arrow-endpoint').forEach((h) => {
          if (h instanceof HTMLElement) endpointEls.push(h);
        });
      };

      live = (designDx, designDy) => {
        const newX1 = origX1 + designDx;
        const newY1 = origY1 + designDy;
        const newX2 = origX2 + designDx;
        const newY2 = origY2 + designDy;
        const head = computeArrowGeometry(newX1, newY1, newX2, newY2, origStroke);
        for (const l of lineEls) {
          l.setAttribute('x1', String(newX1));
          l.setAttribute('y1', String(newY1));
          l.setAttribute('x2', String(head.baseX));
          l.setAttribute('y2', String(head.baseY));
        }
        polyEl.setAttribute('points', head.points);
        ensureSelectionDOM();
        if (overlayEl) {
          const minX = Math.min(newX1, newX2);
          const minY = Math.min(newY1, newY2);
          const maxX = Math.max(newX1, newX2);
          const maxY = Math.max(newY1, newY2);
          overlayEl.style.left = `${minX - 4}px`;
          overlayEl.style.top = `${minY - 4}px`;
          overlayEl.style.width = `${maxX - minX + 8}px`;
          overlayEl.style.height = `${maxY - minY + 8}px`;
        }
        // Endpoint handles are added in source order [tail (1), tip
        // (2)] by the selection effect, so handles[0] tracks (x1,
        // y1) and handles[1] tracks (x2, y2).
        if (endpointEls.length >= 2) {
          endpointEls[0]!.style.left = `${newX1 - 7}px`;
          endpointEls[0]!.style.top = `${newY1 - 7}px`;
          endpointEls[1]!.style.left = `${newX2 - 7}px`;
          endpointEls[1]!.style.top = `${newY2 - 7}px`;
        }
      };

      commit = (target, designDx, designDy) => {
        const dxRounded = Math.round(designDx);
        const dyRounded = Math.round(designDy);
        for (const slotName of ['x1', 'x2'] as const) {
          const slot = findNumericSlot(target, slotName);
          if (slot) slot.node.value = slot.value + dxRounded;
        }
        for (const slotName of ['y1', 'y2'] as const) {
          const slot = findNumericSlot(target, slotName);
          if (slot) slot.node.value = slot.value + dyRounded;
        }
      };
    } else {
      if (!(visualNode instanceof HTMLElement)) {
        setDragging(null);
        return;
      }
      const cs = window.getComputedStyle(visualNode);
      const originalLeft = parseFloat(cs.left) || 0;
      const originalTop = parseFloat(cs.top) || 0;

      let lookedUp = false;
      let overlayEl: HTMLElement | null = null;
      const ensureOverlay = (): void => {
        if (!isSelectedDrag || lookedUp) return;
        lookedUp = true;
        const ov = document.querySelector(
          '.sw-canvas-stage .presentation .sw-selection-outline',
        );
        if (ov instanceof HTMLElement) overlayEl = ov;
      };

      live = (designDx, designDy) => {
        const newLeft = originalLeft + designDx;
        const newTop = originalTop + designDy;
        visualNode.style.left = `${newLeft}px`;
        visualNode.style.top = `${newTop}px`;
        ensureOverlay();
        if (overlayEl) {
          overlayEl.style.left = `${newLeft - 4}px`;
          overlayEl.style.top = `${newTop - 4}px`;
        }
      };

      commit = (target, designDx, designDy) => {
        const xSlot = findNumericSlot(target, 'x');
        const ySlot = findNumericSlot(target, 'y');
        if (xSlot) xSlot.node.value = Math.round(originalLeft + designDx);
        if (ySlot) ySlot.node.value = Math.round(originalTop + designDy);
      };
    }

    const onMove = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      live(designDx, designDy);
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
      const slideIdx = activeIdxRef.current;
      const result = commitSourceEdit(sourceRef.current, '<drag>', (ast) => {
        const target = findComponentAtSpan(ast, start, end);
        if (!target) return null;
        commit(target, designDx, designDy);
        if (!isSelectedDrag) return {};
        const childIdx = findShapeChildIdx(ast, slideIdx, { start, end });
        return childIdx !== null
          ? { preserveSelection: { slideIdx, childIdx } }
          : {};
      });
      if (result) {
        if (result.newSelection) pendingSelectionRef.current = result.newSelection;
        host.setSource?.(result.newSource);
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

  // Drag-to-resize gesture. Two flavors share the same gesture
  // lifecycle (pointermove/pointerup, commit on release with
  // selection preservation) but differ in what they update:
  //   - kind:'box' — Box / TextBox corner / edge resize. Updates
  //     style.left/top/width/height + overlay; commits x/y/width/
  //     height slot fills.
  //   - kind:'arrow-endpoint' — Arrow endpoint move. Updates the
  //     SVG line + polygon attributes (recomputes the arrowhead
  //     each frame so it points the new direction) + the overlay
  //     bbox + the moving handle's position; commits only the
  //     moving endpoint's x{1,2}/y{1,2} slot fills.
  // Both branches use the shared post-commit logic to preserve
  // selection via pendingSelectionRef.
  useEffect(() => {
    if (!resizing) return;
    const { start, end, pointerStartX, pointerStartY, scale } = resizing;

    type LiveStep = (designDx: number, designDy: number) => void;
    type Commit = (
      target: Component,
      designDx: number,
      designDy: number,
    ) => void;

    let live: LiveStep;
    let commit: Commit;

    if (resizing.kind === 'box') {
      const { inner: visualNode, overlay, direction } = resizing;
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
      const computeBox = (
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

      live = (designDx, designDy) => {
        const r = computeBox(designDx, designDy);
        visualNode.style.left = `${r.left}px`;
        visualNode.style.top = `${r.top}px`;
        visualNode.style.width = `${r.width}px`;
        visualNode.style.height = `${r.height}px`;
        overlay.style.left = `${r.left - 4}px`;
        overlay.style.top = `${r.top - 4}px`;
        overlay.style.width = `${r.width + 8}px`;
        overlay.style.height = `${r.height + 8}px`;
      };

      commit = (target, designDx, designDy) => {
        const r = computeBox(designDx, designDy);
        const xSlot = findNumericSlot(target, 'x');
        const ySlot = findNumericSlot(target, 'y');
        const wSlot = findNumericSlot(target, 'width');
        const hSlot = findNumericSlot(target, 'height');
        if (xSlot) xSlot.node.value = Math.round(r.left);
        if (ySlot) ySlot.node.value = Math.round(r.top);
        if (wSlot) wSlot.node.value = Math.round(r.width);
        if (hSlot) hSlot.node.value = Math.round(r.height);
      };
    } else {
      // arrow-endpoint
      const {
        endpoint,
        svgEl,
        polygonEl,
        overlay,
        handle,
        origX,
        origY,
        fixedX,
        fixedY,
        strokeWidth,
      } = resizing;
      // Both the visible stroke and the wider hit-area stroke share
      // the same coordinates (see Arrow.tsx); update them together
      // so the click target stays aligned with the line during the
      // gesture.
      const allLines = Array.from(svgEl.querySelectorAll('line'));

      live = (designDx, designDy) => {
        const newX = origX + designDx;
        const newY = origY + designDy;
        // Map (moving, fixed) → canonical (x1, y1, x2, y2) so the
        // arrowhead always renders at (x2, y2).
        const x1 = endpoint === 1 ? newX : fixedX;
        const y1 = endpoint === 1 ? newY : fixedY;
        const x2 = endpoint === 1 ? fixedX : newX;
        const y2 = endpoint === 1 ? fixedY : newY;
        const head = computeArrowGeometry(x1, y1, x2, y2, strokeWidth);
        for (const l of allLines) {
          l.setAttribute('x1', String(x1));
          l.setAttribute('y1', String(y1));
          l.setAttribute('x2', String(head.baseX));
          l.setAttribute('y2', String(head.baseY));
        }
        polygonEl.setAttribute('points', head.points);
        // Overlay tracks the bbox of the line (same approximation
        // the selection effect uses — ignores arrowhead extent).
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);
        const maxX = Math.max(x1, x2);
        const maxY = Math.max(y1, y2);
        overlay.style.left = `${minX - 4}px`;
        overlay.style.top = `${minY - 4}px`;
        overlay.style.width = `${maxX - minX + 8}px`;
        overlay.style.height = `${maxY - minY + 8}px`;
        // Moving handle follows the new endpoint.
        handle.style.left = `${newX - 7}px`;
        handle.style.top = `${newY - 7}px`;
      };

      commit = (target, designDx, designDy) => {
        const newX = Math.round(origX + designDx);
        const newY = Math.round(origY + designDy);
        const xName = endpoint === 1 ? 'x1' : 'x2';
        const yName = endpoint === 1 ? 'y1' : 'y2';
        const xSlot = findNumericSlot(target, xName);
        const ySlot = findNumericSlot(target, yName);
        if (xSlot) xSlot.node.value = newX;
        if (ySlot) ySlot.node.value = newY;
      };
    }

    const onMove = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      live(designDx, designDy);
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
      const slideIdx = activeIdxRef.current;
      const result = commitSourceEdit(sourceRef.current, '<resize>', (ast) => {
        const target = findComponentAtSpan(ast, start, end);
        if (!target) return null;
        commit(target, designDx, designDy);
        const childIdx = findShapeChildIdx(ast, slideIdx, { start, end });
        return childIdx !== null
          ? { preserveSelection: { slideIdx, childIdx } }
          : {};
      });
      if (result) {
        if (result.newSelection) pendingSelectionRef.current = result.newSelection;
        host.setSource?.(result.newSource);
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
      const result = commitSourceEdit(sourceRef.current, '<create>', (ast) => {
        const freeform = findActiveSlideFreeform(ast, activeIdxRef.current);
        if (!freeform) return null;
        if (tool === 'arrow') {
          // Treat very short lines as accidental clicks.
          const dx = c.x - designStartX;
          const dy = c.y - designStartY;
          if (Math.hypot(dx, dy) < 5) return null;
          appendShapeToFreeform(
            freeform,
            makeArrowNode(
              Math.round(designStartX),
              Math.round(designStartY),
              Math.round(c.x),
              Math.round(c.y),
            ),
          );
          return {};
        }
        const left = Math.round(Math.min(designStartX, c.x));
        const top = Math.round(Math.min(designStartY, c.y));
        const width = Math.round(Math.abs(c.x - designStartX));
        const height = Math.round(Math.abs(c.y - designStartY));
        if (width < 5 || height < 5) return null;
        appendShapeToFreeform(
          freeform,
          tool === 'textbox'
            ? makeTextBoxNode(left, top, width, height)
            : makeBoxNode(left, top, width, height, 'amber'),
        );
        return {};
      });
      if (result) {
        host.setSource?.(result.newSource);
        setActiveTool('select');
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
        const result = commitSourceEdit(sourceRef.current, '<delete>', (ast) =>
          removeShapeAtSpan(ast, selected) ? {} : null,
        );
        if (result) {
          host.setSource?.(result.newSource);
          setSelected(null);
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
    // Arrow tip (actual x2, y2) coordinates, captured here for the
    // endpoint-handle setup below. The line element's `x2`/`y2`
    // attributes are the BASE of the arrowhead, not the tip — the
    // tip lives in the polygon's first vertex (see Arrow.tsx).
    let arrowTipX = 0;
    let arrowTipY = 0;
    let arrowTailX = 0;
    let arrowTailY = 0;
    let arrowStrokeWidth = 4;
    const componentName = shapeWrapper.getAttribute('data-sw-component');
    if (componentName === 'Arrow') {
      const line = shapeInner.querySelector('line');
      const polygon = shapeInner.querySelector('polygon');
      if (!line || !polygon) return;
      arrowTailX = parseFloat(line.getAttribute('x1') ?? '0');
      arrowTailY = parseFloat(line.getAttribute('y1') ?? '0');
      arrowStrokeWidth = parseFloat(line.getAttribute('stroke-width') ?? '4');
      const polyPoints = polygon.getAttribute('points') ?? '';
      const firstVertex = polyPoints.split(/\s+/)[0] ?? '0,0';
      const [tipXStr, tipYStr] = firstVertex.split(',');
      arrowTipX = parseFloat(tipXStr ?? '0');
      arrowTipY = parseFloat(tipYStr ?? '0');
      bounds = {
        left: Math.min(arrowTailX, arrowTipX),
        top: Math.min(arrowTailY, arrowTipY),
        width: Math.abs(arrowTipX - arrowTailX),
        height: Math.abs(arrowTipY - arrowTailY),
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
            kind: 'box',
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

    // Arrow endpoint handles (v0.2.i.2). Two handles, one at
    // (x1, y1) and one at (x2, y2). They live as direct children of
    // the freeform (not the overlay) because the overlay is the
    // shape's bounding rectangle — endpoints can be anywhere within
    // it, not just at corners. Each handle drag updates only its
    // endpoint; the other stays fixed.
    const arrowEndpointHandles: HTMLElement[] = [];
    if (
      activeTool === 'select' &&
      componentName === 'Arrow' &&
      shapeInner instanceof SVGSVGElement
    ) {
      // Guard: SVG must have at least one line + a polygon (the
      // live closures re-query lines off svgEl since Arrow.tsx
      // renders both visible and hit-area strokes).
      const polygonEl = shapeInner.querySelector('polygon');
      const hasLine = shapeInner.querySelector('line') !== null;
      if (polygonEl && hasLine) {
        type Endpoint = 1 | 2;
        const setupEndpoint = (
          endpoint: Endpoint,
          movingX: number,
          movingY: number,
          fixedX: number,
          fixedY: number,
        ): void => {
          const handle = document.createElement('div');
          handle.className = 'sw-resize-handle-shape sw-arrow-endpoint';
          handle.style.left = `${movingX - 7}px`;
          handle.style.top = `${movingY - 7}px`;
          const onPointerDown = (event: PointerEvent): void => {
            if (event.button !== 0) return;
            event.stopPropagation();
            event.preventDefault();
            const canvasEl = document.querySelector(
              '.sw-canvas-stage .presentation-canvas',
            );
            const scale =
              canvasEl instanceof HTMLElement
                ? canvasEl.getBoundingClientRect().width / 1920
                : 1;
            setResizing({
              kind: 'arrow-endpoint',
              endpoint,
              svgEl: shapeInner,
              polygonEl,
              overlay,
              handle,
              origX: movingX,
              origY: movingY,
              fixedX,
              fixedY,
              strokeWidth: arrowStrokeWidth,
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
          freeformDiv.appendChild(handle);
          arrowEndpointHandles.push(handle);
        };
        setupEndpoint(1, arrowTailX, arrowTailY, arrowTipX, arrowTipY);
        setupEndpoint(2, arrowTipX, arrowTipY, arrowTailX, arrowTailY);
      }
    }

    return () => {
      for (const fn of handleCleanups) fn();
      for (const h of arrowEndpointHandles) h.parentElement?.removeChild(h);
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
