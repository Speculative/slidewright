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
import { components, staticTokens } from '../../decks/v0-reference/registry.js';
import { DeckMetaContext } from '../../src/Slide.jsx';

import type { Host, SourceRange } from './host.js';
import {
  ScaledCanvas,
  type CreateStart,
  type DragStart,
  type MarqueeStart,
  type TextEditTarget,
} from './ScaledCanvas.js';
import {
  appendShapeToFreeform,
  commitSourceEdit,
  findActiveSlideFreeform,
  findStringAt,
  makeArrowNode,
  makeBoxNode,
  makeTextBoxNode,
  removeShapeAtSpan,
  type PreserveSelection,
} from './ast-edits.js';
import type {
  GestureHandle,
  ShapeAdapter,
} from './shape-adapter.js';
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

// Active pointer gesture — body drag or handle drag. Carries an
// array of GestureHandles so multi-shape body drags (group drag)
// fit the same lifecycle: each frame iterates the handles and
// dispatches the same delta to each. Single-shape gestures use a
// one-element array.
//
// Body drag sets `cursor: grabbing` on document.body for the
// duration of the gesture; handle drags rely on each handle's CSS
// cursor (resize, move, etc.) instead.
//
// The mutex of "only one pointer gesture at a time" is enforced by
// having a single state slot — body-drag pointerdown and handle
// pointerdown both stopPropagation, so the dispatch can only land
// in one of them per gesture.
interface ActiveGesture {
  handles: GestureHandle[];
  label: string;          // identifier for parser-error logs
  pointerStartX: number;
  pointerStartY: number;
  scale: number;
  cursor: 'grabbing' | null;
}

// Look up a shape's canvas adapter by component name. Returns null
// if the component isn't registered or doesn't declare canvas
// behavior (e.g., layout primitives like VStack, CardRow). Layout
// primitives can render but aren't directly manipulable today.
function getAdapter(componentName: string): ShapeAdapter | null {
  const loaded = components[componentName];
  if (!loaded) return null;
  return (loaded.canvas as ShapeAdapter | undefined) ?? null;
}

// Find the selection-outline div for a specific shape's span. The
// selection effect tags each overlay with `data-sw-overlay-for-*`
// attrs at creation time. With multi-select there are N overlays
// in the DOM; this lookup picks the one that belongs to a given
// shape so adapters' body-drag onMove updates the right outline.
// Returns null if the shape isn't currently selected (e.g., the
// user is body-dragging an unselected shape — single-shape drag,
// no overlay to track).
function getOverlayFor(span: { start: number; end: number }): HTMLElement | null {
  const el = document.querySelector(
    `.sw-canvas-stage .sw-selection-outline[data-sw-overlay-for-start="${span.start}"][data-sw-overlay-for-end="${span.end}"]`,
  );
  return el instanceof HTMLElement ? el : null;
}

// Read the current canvas scale (design pixels → CSS pixels). The
// .presentation-canvas has a CSS transform; getBoundingClientRect()
// returns post-transform dimensions, so dividing by the design
// width recovers the scale.
function getCurrentScale(): number {
  const canvas = document.querySelector(
    '.sw-canvas-stage .presentation-canvas',
  );
  if (!(canvas instanceof HTMLElement)) return 1;
  return canvas.getBoundingClientRect().width / 1920;
}

export function App({ host }: { host: Host }): ReactElement {
  const [state, setState] = useState<RenderState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [stripWidth, setStripWidth] = useState<number>(readStoredStripWidth);
  const [editing, setEditing] = useState<TextEditTarget | null>(null);
  const [creating, setCreating] = useState<CreateStart | null>(null);
  const [marquee, setMarquee] = useState<MarqueeStart | null>(null);
  // Pointer gesture state — body drag and handle drag share this
  // single slot. ScaledCanvas's body-drag dispatch and the handle
  // pointerdowns (in adapter renderHandles) both feed it.
  const [activeGesture, setActiveGesture] = useState<ActiveGesture | null>(null);
  const [activeTool, setActiveTool] = useState<Tool>('select');
  // Selection is always an array. Single-select works as length === 1;
  // empty array means nothing selected. Multi-select (v0.2.j) is
  // bounded to one layout context — currently the active slide's
  // Freeform.
  const [selected, setSelected] = useState<SourceRange[]>([]);

  // Selection-preservation across host.setSource. Spans shift after
  // every emit (the canonical formatter rewrites whitespace), so the
  // currently-selected (start, end) won't match anything in the new
  // tree. Drag, resize, and group commits stash the new spans here
  // before calling host.setSource; the subscribe handler picks them
  // up on the round-trip and re-applies. Without this, gestures
  // would silently deselect on every commit.
  const pendingSelectionRef = useRef<SourceRange[] | null>(null);

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
        setSelected([]);
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

  // Generic pointer-gesture lifecycle. Both body drag (dispatched
  // by ScaledCanvas's pointerdown when the user grabs a shape) and
  // handle drag (dispatched by an adapter's renderHandles when the
  // user grabs a corner / endpoint) feed into the single
  // `activeGesture` state. The framework owns the document-level
  // listener wiring, scale conversion, and commit pipeline; the
  // adapter-supplied GestureHandle owns per-frame visual updates
  // and AST mutation on commit.
  //
  // The two gesture sources are mutex'd by sharing this state slot
  // and by stopPropagation in handle pointerdowns (so a handle
  // grab doesn't also start a body drag on the same pointerdown).
  useEffect(() => {
    if (!activeGesture) return;
    const { handles, label, pointerStartX, pointerStartY, scale, cursor } =
      activeGesture;

    const onMove = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      for (const h of handles) h.onMove(designDx, designDy);
    };

    const onUp = (e: PointerEvent) => {
      const designDx = (e.clientX - pointerStartX) / scale;
      const designDy = (e.clientY - pointerStartY) / scale;
      // Treat near-zero motion as a click rather than a gesture
      // commit. Threshold is in design-space pixels so it's
      // consistent across canvas zoom levels. (For body drag this
      // means clicking a shape selects without committing; for
      // handle drag, an accidental click on a corner does nothing.)
      if (Math.abs(designDx) < 0.5 && Math.abs(designDy) < 0.5) {
        setActiveGesture(null);
        return;
      }
      const result = commitSourceEdit(sourceRef.current, label, (ast) => {
        // Iterate every handle's onCommit. Each returns at most
        // one PreserveSelection; collect the lot for the multi-
        // preservation pipeline. If every handle returns null the
        // commit aborts (gesture had no effect on any target).
        const preserveSelections: PreserveSelection[] = [];
        let anyCommitted = false;
        for (const h of handles) {
          const out = h.onCommit(ast, designDx, designDy);
          if (!out) continue;
          anyCommitted = true;
          if (out.preserveSelection) {
            preserveSelections.push(out.preserveSelection);
          }
        }
        if (!anyCommitted) return null;
        return { preserveSelections };
      });
      if (result) {
        if (result.newSelections.length > 0) {
          pendingSelectionRef.current = result.newSelections;
        }
        host.setSource?.(result.newSource);
      }
      setActiveGesture(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    if (cursor) document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (cursor) document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [activeGesture, host]);

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

  // Marquee selection (v0.2.j). Pointerdown on empty Freeform
  // space starts this; on pointerup, every shape whose adapter-
  // computed bounds intersects the marquee rect joins the
  // selection. Click-without-drag (zero motion) collapses to the
  // older "click clears selection" behavior so empty-area clicks
  // still feel snappy. Shift held during the gesture additively
  // unions the result onto the current selection rather than
  // replacing it.
  useEffect(() => {
    if (!marquee) return;
    const {
      freeformDiv,
      designStartX,
      designStartY,
      pointerStartX,
      pointerStartY,
      scale,
      shift,
    } = marquee;

    const preview = document.createElement('div');
    preview.className = 'sw-marquee';
    preview.style.position = 'absolute';
    preview.style.left = `${designStartX}px`;
    preview.style.top = `${designStartY}px`;
    preview.style.width = '0px';
    preview.style.height = '0px';
    preview.style.pointerEvents = 'none';
    preview.style.background = 'rgba(0, 102, 255, 0.08)';
    preview.style.border = '1px dashed rgba(0, 102, 255, 0.85)';
    preview.style.boxSizing = 'border-box';
    freeformDiv.appendChild(preview);

    const designAt = (clientX: number, clientY: number) => ({
      x: (clientX - pointerStartX) / scale + designStartX,
      y: (clientY - pointerStartY) / scale + designStartY,
    });

    const onMove = (e: PointerEvent) => {
      const { x, y } = designAt(e.clientX, e.clientY);
      const left = Math.min(designStartX, x);
      const top = Math.min(designStartY, y);
      preview.style.left = `${left}px`;
      preview.style.top = `${top}px`;
      preview.style.width = `${Math.abs(x - designStartX)}px`;
      preview.style.height = `${Math.abs(y - designStartY)}px`;
    };

    const onUp = (e: PointerEvent) => {
      const { x, y } = designAt(e.clientX, e.clientY);
      const dx = x - designStartX;
      const dy = y - designStartY;
      // Click without meaningful drag — treat as the old "click on
      // background clears selection" gesture (or no-op if shift,
      // since shift-click on background is meaningless).
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        if (!shift) setSelected([]);
        setMarquee(null);
        return;
      }
      const left = Math.min(designStartX, x);
      const top = Math.min(designStartY, y);
      const right = Math.max(designStartX, x);
      const bottom = Math.max(designStartY, y);
      // Walk every shape wrapper inside this freeform; pick the
      // ones whose adapter-computed bounds intersect the marquee.
      // (`getAdapter` filtering is what restricts to gesture-able
      // shapes — Freeform itself doesn't have an adapter, so its
      // own wrapper is naturally skipped.)
      const intersected: SourceRange[] = [];
      const wrappers = freeformDiv.querySelectorAll<HTMLElement>(
        '[data-sw-span-start]',
      );
      wrappers.forEach((wrapper) => {
        const componentName = wrapper.getAttribute('data-sw-component');
        if (!componentName) return;
        const adapter = getAdapter(componentName);
        if (!adapter) return;
        const visualNode = wrapper.firstElementChild;
        if (!visualNode) return;
        const b = adapter.bounds(visualNode);
        if (!b) return;
        const shapeRight = b.left + b.width;
        const shapeBottom = b.top + b.height;
        // Standard rect-rect intersection (overlap, not strict
        // containment) — Figma / Sketch convention.
        if (
          b.left < right &&
          shapeRight > left &&
          b.top < bottom &&
          shapeBottom > top
        ) {
          const start = parseInt(
            wrapper.getAttribute('data-sw-span-start') ?? '',
            10,
          );
          const end = parseInt(
            wrapper.getAttribute('data-sw-span-end') ?? '',
            10,
          );
          if (Number.isFinite(start) && Number.isFinite(end)) {
            intersected.push({ start, end });
          }
        }
      });
      if (shift) {
        // Additive: union with current selection, deduping by
        // (start, end). Order: existing first, then new.
        setSelected((current) => {
          const out = [...current];
          for (const r of intersected) {
            if (
              !out.some((s) => s.start === r.start && s.end === r.end)
            ) {
              out.push(r);
            }
          }
          return out;
        });
      } else {
        setSelected(intersected);
      }
      setMarquee(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      preview.parentElement?.removeChild(preview);
    };
  }, [marquee]);

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
        if (selected.length > 0) setSelected([]);
        e.preventDefault();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) {
        // Iterate the selection and remove each shape inside one
        // commitSourceEdit call so the AST mutates atomically.
        // Selection clears on commit (selected children no longer
        // exist; pendingSelectionRef stays empty).
        const targets = selected;
        const result = commitSourceEdit(sourceRef.current, '<delete>', (ast) => {
          let any = false;
          for (const target of targets) {
            if (removeShapeAtSpan(ast, target)) any = true;
          }
          return any ? {} : null;
        });
        if (result) {
          host.setSource?.(result.newSource);
          setSelected([]);
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, selected, host]);

  // Selection overlays. Iterates the selected list, looks up each
  // shape's adapter, mounts a dashed outline per shape. Adapter-
  // supplied resize handles render only when exactly one shape is
  // selected (group resize is a separate gesture model — deferred).
  // When 2+ shapes are selected, an additional "group bounding
  // box" outline is drawn around the union of the per-shape
  // bounds, giving the multi-selection a single visual identity.
  // Re-runs on source change since wrapper element identities
  // change after each emit + re-render.
  useEffect(() => {
    if (selected.length === 0 || !state) return;
    const presentation = document.querySelector(
      '.sw-canvas-stage .presentation',
    );
    if (!presentation) return;

    const cleanups: Array<() => void> = [];
    const renderHandlesFor = selected.length === 1;

    // Track per-shape bounds + the freeform anchor so we can render
    // the group bounding box at the end without re-walking the DOM.
    let groupFreeform: HTMLElement | null = null;
    const allBounds: Array<{
      left: number;
      top: number;
      width: number;
      height: number;
    }> = [];

    for (const span of selected) {
      const shapeWrapper = presentation.querySelector(
        `[data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"]`,
      );
      if (!shapeWrapper) continue;
      const shapeInner = shapeWrapper.firstElementChild;
      if (!shapeInner) continue;
      const componentName = shapeWrapper.getAttribute('data-sw-component');
      if (!componentName) continue;
      const adapter = getAdapter(componentName);
      if (!adapter) continue;

      const bounds = adapter.bounds(shapeInner);
      if (!bounds) continue;

      // Anchor each overlay on the Freeform that contains the
      // shape. (Generalizing to "any positioned ancestor" is
      // deferred until outside-Freeform shapes need adapters.)
      const freeformWrapper = shapeWrapper.closest(
        '[data-sw-component="Freeform"]',
      );
      const freeformDiv = freeformWrapper?.firstElementChild;
      if (!(freeformDiv instanceof HTMLElement)) continue;
      groupFreeform = freeformDiv;
      allBounds.push(bounds);

      const overlay = document.createElement('div');
      overlay.className = 'sw-selection-outline';
      overlay.setAttribute('data-sw-overlay-for-start', String(span.start));
      overlay.setAttribute('data-sw-overlay-for-end', String(span.end));
      overlay.style.position = 'absolute';
      overlay.style.left = `${bounds.left - 4}px`;
      overlay.style.top = `${bounds.top - 4}px`;
      overlay.style.width = `${bounds.width + 8}px`;
      overlay.style.height = `${bounds.height + 8}px`;
      overlay.style.pointerEvents = 'none';
      freeformDiv.appendChild(overlay);
      cleanups.push(() => overlay.parentElement?.removeChild(overlay));

      // Handles only on single-shape selection (the simpler-by-
      // far-most-common case). Multi-select shows outlines so the
      // user can disambiguate which shapes are in the group, but
      // group resize via aggregate handles is its own milestone
      // (deferred — needs the applyTransform adapter method).
      if (renderHandlesFor && activeTool === 'select') {
        const handleCleanup = adapter.renderHandles({
          overlay,
          visualNode: shapeInner,
          span,
          slideIdx: activeIdxRef.current,
          getScale: getCurrentScale,
          startHandleDrag: (handle, event) => {
            setActiveGesture({
              handles: [handle],
              label: '<resize>',
              pointerStartX: event.clientX,
              pointerStartY: event.clientY,
              scale: getCurrentScale(),
              cursor: null,
            });
          },
        });
        cleanups.push(handleCleanup);
      }
    }

    // Group bounding box — rendered when 2+ shapes contributed.
    // The box is the union of per-shape bounds with a small outset
    // so it visually contains the inner outlines. Solid border
    // distinguishes it from the dashed per-shape outlines.
    if (allBounds.length > 1 && groupFreeform) {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const b of allBounds) {
        if (b.left < left) left = b.left;
        if (b.top < top) top = b.top;
        if (b.left + b.width > right) right = b.left + b.width;
        if (b.top + b.height > bottom) bottom = b.top + b.height;
      }
      const groupBox = document.createElement('div');
      groupBox.className = 'sw-selection-group';
      groupBox.style.position = 'absolute';
      groupBox.style.left = `${left - 8}px`;
      groupBox.style.top = `${top - 8}px`;
      groupBox.style.width = `${right - left + 16}px`;
      groupBox.style.height = `${bottom - top + 16}px`;
      groupBox.style.pointerEvents = 'none';
      groupFreeform.appendChild(groupBox);
      cleanups.push(() => groupBox.parentElement?.removeChild(groupBox));
    }

    return () => {
      for (const fn of cleanups) fn();
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
              onDragStart={(target) => {
                // Decide which shapes are being dragged. If the
                // clicked shape is part of the current selection
                // AND the selection has multiple items, drag the
                // whole group together. Otherwise drag just the
                // clicked shape — selection itself was already
                // updated by onSelectShape on the same pointerdown.
                const targetSpan = { start: target.start, end: target.end };
                const isInSelection = selected.some(
                  (s) =>
                    s.start === targetSpan.start && s.end === targetSpan.end,
                );
                const dragSpans =
                  isInSelection && selected.length > 1 ? selected : [targetSpan];

                // Look up each shape's wrapper, adapter, and visual
                // node. Build a GestureHandle per shape via the
                // adapter's startBodyDrag. Skip any that don't
                // resolve (shape went away, missing adapter, etc.).
                const presentation = document.querySelector(
                  '.sw-canvas-stage .presentation',
                );
                if (!presentation) return;
                const handles: GestureHandle[] = [];
                for (const span of dragSpans) {
                  const wrapper = presentation.querySelector(
                    `[data-sw-span-start="${span.start}"][data-sw-span-end="${span.end}"]`,
                  );
                  if (!wrapper) continue;
                  const componentName = wrapper.getAttribute('data-sw-component');
                  if (!componentName) continue;
                  const adapter = getAdapter(componentName);
                  if (!adapter) continue;
                  const visualNode = wrapper.firstElementChild;
                  if (!visualNode) continue;
                  // Each shape's getOverlay returns ITS OWN overlay
                  // (matched by data-sw-overlay-for-* attrs), so a
                  // group drag updates each dashed outline rather
                  // than the first one.
                  const handle = adapter.startBodyDrag({
                    visualNode,
                    getOverlay: () => getOverlayFor(span),
                    span,
                    slideIdx: activeIdxRef.current,
                  });
                  handles.push(handle);
                }
                if (handles.length === 0) return;
                setActiveGesture({
                  handles,
                  label: '<drag>',
                  pointerStartX: target.pointerStartX,
                  pointerStartY: target.pointerStartY,
                  scale: target.scale,
                  cursor: 'grabbing',
                });
              }}
              onCreateStart={(target) => setCreating(target)}
              onMarqueeStart={(target) => setMarquee(target)}
              onSelectShape={(range, modifiers) => {
                if (!range) {
                  // Background click — clears selection unless
                  // shift held (shift-click on background is a
                  // no-op, not a clear).
                  if (!modifiers.shift) setSelected([]);
                  return;
                }
                setSelected((current) => {
                  const alreadySelected = current.some(
                    (s) => s.start === range.start && s.end === range.end,
                  );
                  if (modifiers.shift) {
                    // Shift-click toggles: remove if present,
                    // append if absent. Order is preserved (new
                    // shapes go to the end).
                    return alreadySelected
                      ? current.filter(
                          (s) =>
                            !(s.start === range.start && s.end === range.end),
                        )
                      : [...current, range];
                  }
                  // No-shift click: keep selection if the clicked
                  // shape is already in it (so the user can start
                  // a group drag without losing the rest), otherwise
                  // replace with just that shape.
                  return alreadySelected ? current : [range];
                });
              }}
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
