// Slidewright canvas — host-agnostic React app.
//
// Receives source-of-truth from a Host (VSCodeHost in the extension,
// StandaloneHost in the standalone web app), runs the slidewright
// runtime against it, and renders the active slide via ScaledCanvas.
// A vertical SlideStrip on the left shows thumbnails for navigation.
//
// Gesture model (v0.3 refactor): React-native. Gesture state is in
// React; per-pointermove `setState` updates dx/dy; the loader's
// ShapeProjection wrapper consumes a gesture context and re-renders
// each affected shape with adjusted params; selection visuals
// (outlines, group bbox, handles) are React components portaled
// into the active Freeform. Imperative DOM mutation during drag is
// gone.

import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { loadDeck, type ShapeData } from '../runtime/loader.js';
import type { Diagnostic } from '../runtime/diagnostics.js';
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
  findActiveSlideFreeform,
  findStringAt,
  makeArrowNode,
  makeBoxNode,
  makeTextBoxNode,
  removeShapeAtSpan,
  type PreserveSelection,
} from './ast-edits.js';
import type {
  BoxResizeDirection,
  HandleGestureInit,
  ShapeAdapter,
  ShapeDelta,
  StartGesture,
} from './shape-adapter.js';
import { GestureProvider, spanKey } from './gesture-context.js';
import { wrapShape } from './shape-projection.js';
import { SelectionLayer } from './selection-layer.js';
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
  // Loader-built registry of shapes with canvas adapters. Selection
  // and gesture rendering iterate this without re-walking the slide
  // tree or the DOM.
  shapes: ReadonlyMap<string, ShapeData>;
}

// Pre-Section slides in the existing scaffold show "Setup" in the
// chrome's act position. v0.1's canvas doesn't model Section
// dividers / acts, so all slides land in the pre-Section "Setup"
// act. v0.2+ will track acts when navigation lands.
const DEFAULT_ACT_LABEL = 'Setup';

const STRIP_WIDTH_KEY = 'slidewright.canvas.stripWidth';
const STRIP_WIDTH_DEFAULT = 280;
const STRIP_WIDTH_MIN = 200;
const STRIP_WIDTH_MAX = 600;

const DESIGN_W = 1920;

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

// Inject the props that Presentation.jsx normally adds (active=true
// so styles.css's .slide.active visibility rule kicks in, actLabel
// so the chrome's third crumb isn't blank). The slide arrives pre-
// wrapped by the loader for selection sync; we clone the *inner*
// SlideFrame, not the wrapper div, and rewrap so React doesn't get
// active/actLabel as unknown DOM attrs.
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

// ─── Gesture state ────────────────────────────────────────────────
//
// Split into two pieces:
//   - `gestureMeta` — set once at gesture-start, cleared at end.
//     Carries pointer captures, the per-shape delta templates, and
//     metadata commit needs.
//   - `gestureLive` — pointer-derived `dx, dy`. Updated per
//     pointermove via `setGestureLive`.
//
// Why split: the gesture-lifecycle effect's deps are `gestureMeta`
// only — listeners attach on gesture-start, detach on gesture-end,
// nothing in between. setGestureLive triggers React re-render
// (which propagates new deltas to shapes / selection visuals) but
// does NOT cause the effect to re-run, avoiding per-frame
// remove/add of document listeners.

type DeltaTemplate =
  | { kind: 'translate' }
  | {
      kind: 'box-resize';
      direction: BoxResizeDirection;
      original: { x: number; y: number; width: number; height: number };
    }
  | {
      kind: 'arrow-endpoint';
      endpoint: 1 | 2;
      originalX: number;
      originalY: number;
      fixedX: number;
      fixedY: number;
    };

interface GestureMeta {
  templates: ReadonlyMap<string, DeltaTemplate>;
  spans: ReadonlyArray<SourceRange>;
  pointerStartX: number;
  pointerStartY: number;
  scale: number;
  slideIdx: number;
  label: string;
  cursor: 'grabbing' | null;
}

interface GestureLive {
  dx: number;
  dy: number;
}

const ZERO_LIVE: GestureLive = { dx: 0, dy: 0 };

// ─── Create gesture (drawing tools) ───────────────────────────────
//
// React-native preview state. Replaces the old imperative
// createElement('div'/'svg'/'line') + appendChild approach.

interface CreatePreview {
  tool: 'box' | 'textbox' | 'arrow';
  // Freeform's positioned div (the portal target — selection
  // visuals and create preview both portal in here).
  freeformDiv: HTMLElement;
  pointerStartX: number;
  pointerStartY: number;
  scale: number;
  designStartX: number;
  designStartY: number;
  // Live cursor in freeform-design space.
  designCurrentX: number;
  designCurrentY: number;
}

// ─── Marquee state ────────────────────────────────────────────────

interface MarqueeState {
  freeformDiv: HTMLElement;
  pointerStartX: number;
  pointerStartY: number;
  scale: number;
  designStartX: number;
  designStartY: number;
  designCurrentX: number;
  designCurrentY: number;
  shift: boolean;
}

// Look up a shape's canvas adapter from the static registry. Used
// by gesture-dispatch and commit code that doesn't have access to
// the loader's resolved shape data.
function getAdapter(componentName: string): ShapeAdapter | null {
  const loaded = components[componentName];
  if (!loaded) return null;
  return (loaded.canvas as ShapeAdapter | undefined) ?? null;
}

// Read the current canvas scale (design pixels → CSS pixels). The
// .presentation-canvas has a CSS transform; getBoundingClientRect's
// width is post-transform, so dividing by DESIGN_W recovers scale.
function getCurrentScale(): number {
  const canvas = document.querySelector(
    '.sw-canvas-stage .presentation-canvas',
  );
  if (!(canvas instanceof HTMLElement)) return 1;
  return canvas.getBoundingClientRect().width / DESIGN_W;
}

export function App({ host }: { host: Host }): ReactElement {
  const [state, setState] = useState<RenderState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [stripWidth, setStripWidth] = useState<number>(readStoredStripWidth);
  const [editing, setEditing] = useState<TextEditTarget | null>(null);
  const [createPreview, setCreatePreview] = useState<CreatePreview | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [gestureMeta, setGestureMeta] = useState<GestureMeta | null>(null);
  const [gestureLive, setGestureLive] = useState<GestureLive>(ZERO_LIVE);
  const [activeTool, setActiveTool] = useState<Tool>('select');
  // Selection is always an array. Single-select is length === 1.
  // Multi-select is bounded to one layout context (one Freeform).
  const [selected, setSelected] = useState<SourceRange[]>([]);

  // Selection-preservation across host.setSource. Spans shift after
  // every emit; gestures stash the new spans here before calling
  // setSource, and the subscribe handler re-applies on the round-
  // trip. External edits leave it null and selection clears.
  const pendingSelectionRef = useRef<SourceRange[] | null>(null);

  // Live source mirror. Read by gesture commit code (which doesn't
  // have a state closure to current source) and by commitToHost
  // (which pushes the pre-commit source onto the undo stack).
  // Updated below on every state change.
  const sourceRef = useRef<string>('');

  // Canvas-side gesture undo stack. Each canvas commit pushes the
  // pre-commit source onto undoStack and clears redoStack. Cmd / Ctrl
  // + Z pops undo onto redo; Cmd / Ctrl + Shift + Z reverses. External
  // edits clear both stacks (per SLIDEWRIGHT.md / Undo/redo —
  // external edits are barriers in v0).
  //
  // VS Code's text-buffer undo also tracks each WorkspaceEdit-applied
  // canvas commit, so users in editor focus get editor-native undo
  // (which our handler doesn't override since the editor textarea
  // is excluded from the keyboard-handler input check). The two
  // mechanisms reach the same source states from different
  // directions; mixing them just clears our stack on the next
  // editor-driven edit.
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  // Set true before any internal setSource (gesture commit, undo,
  // redo). Subscribe reads + clears it: truthy means "the source
  // change we're about to process was driven by us; preserve the
  // undo stacks." Falsy means external — barrier behavior.
  const internalSourceChangeRef = useRef(false);

  // Wraps host.setSource for any canvas-driven source change so
  // the undo stacks see the pre-change source and the subscribe
  // handler treats the round-trip as internal.
  const commitToHost = useCallback(
    (newSource: string, newSelections?: SourceRange[]) => {
      undoStackRef.current.push(sourceRef.current);
      redoStackRef.current = [];
      internalSourceChangeRef.current = true;
      if (newSelections && newSelections.length > 0) {
        pendingSelectionRef.current = newSelections;
      }
      host.setSource?.(newSource);
    },
    [host],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STRIP_WIDTH_KEY, String(stripWidth));
    } catch {
      // Storage unavailable; fine to lose.
    }
  }, [stripWidth]);

  // activeIdx mirror — read inside long-lived closures (notably
  // the host.subscribe callback) so the effect's deps don't have
  // to include `activeIdx`. Every slide change would otherwise
  // re-subscribe, triggering the host's immediate-fire-on-subscribe,
  // which was indistinguishable from an external edit and silently
  // cleared the undo stack on every nav.
  const activeIdxRef = useRef(activeIdx);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);

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
        wrapShape,
      });
      // Distinguish internal source changes (canvas gesture commit,
      // canvas-side undo, canvas-side redo — all flow through
      // commitToHost / the keyboard undo handler, which set
      // internalSourceChangeRef) from external edits (user typing
      // in the editor pane / file reload — ref stays false).
      const isInternal = internalSourceChangeRef.current;
      internalSourceChangeRef.current = false;
      const pending = pendingSelectionRef.current;
      pendingSelectionRef.current = null;
      const prevState = stateRef.current;
      setState((prev) => {
        const next: RenderState = {
          slides: result.slides,
          diagnostics: result.diagnostics,
          fileName,
          meta: { name: result.meta.name, subtitle: result.meta.subtitle },
          source,
          shapes: result.shapes,
        };
        // Read activeIdx via ref (not closure) so this effect's
        // deps don't include `activeIdx` — every slide-change
        // would otherwise tear down + re-subscribe, which fires
        // the host callback again with the current source. That
        // synchronous re-fire was indistinguishable from an
        // external edit and silently cleared the undo stack on
        // every slide nav / cursor move.
        const idx = activeIdxRef.current;
        if (prev && next.slides.length > 0 && idx >= next.slides.length) {
          queueMicrotask(() => setActiveIdx(next.slides.length - 1));
        }
        return next;
      });
      if (isInternal) {
        // Canvas-driven (gesture commit / undo / redo). Selection:
        // gesture commits stash post-emit spans in pending; undo /
        // redo leave pending null (no specific shape to restore;
        // `selected` simply clears, which matches what most editors
        // do across undo / redo boundaries).
        setSelected(pending ?? []);
        return;
      }
      // External edit. Three responses:
      //   1. Cancel any in-progress gesture (its captured spans /
      //      templates point at a stale AST).
      //   2. Clear the canvas-side undo/redo stacks — external
      //      edits are barriers per SLIDEWRIGHT.md / Undo/redo.
      //   3. Preserve selection by (slideIdx, childIdx,
      //      componentName) lookup. Works for benign edits (typing
      //      inside strings, modifying params); doesn't survive
      //      restructuring (insertions / deletions / reorders) —
      //      stable IDs in source are the long-term answer.
      undoStackRef.current = [];
      redoStackRef.current = [];
      setGestureMeta(null);
      setGestureLive(ZERO_LIVE);
      setSelected((prevSelected) =>
        preserveSelectionAcrossExternalEdit(
          prevSelected,
          prevState?.shapes,
          result.shapes,
        ),
      );
    });
  }, [host]);

  const total = state?.slides.length ?? 0;
  const select = useCallback(
    (idx: number) => {
      if (total === 0) return;
      const clamped = Math.max(0, Math.min(total - 1, idx));
      setActiveIdx(clamped);
    },
    [total],
  );

  // Source-cursor → canvas-slide sync. Walk slides by their data-
  // sw-span attrs (placed by the loader's wrapShape) and pick the
  // one whose top-level span contains the cursor offset.
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

  // Keyboard nav — mirrors src/Presentation.jsx's handler.
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

  useEffect(() => {
    sourceRef.current = state?.source ?? '';
  }, [state]);

  // Text-edit gesture (contentEditable). Different lifecycle from
  // pointer gestures — keyboard-driven, blur to commit. Stays
  // imperative because contentEditable IS imperative; the React
  // model doesn't fit.
  useEffect(() => {
    if (!editing) return;
    const { node, originalText, start, end } = editing;
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
        const result = commitSourceEdit(sourceRef.current, '<edit>', (ast) => {
          const target = findStringAt(ast, start, end);
          if (!target) return null;
          target.value = newText;
          return {};
        });
        if (result) commitToHost(result.newSource);
      } else if (intent === 'cancel') {
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
      if (exited === null) node.contentEditable = 'false';
    };
  }, [editing, host]);

  // ─── Gesture lifecycle ──────────────────────────────────────────
  //
  // Document-level pointermove / pointerup listeners while a
  // gesture is active. pointermove updates dx/dy in React state
  // (triggers re-render — shapes, outlines, handles, group bbox
  // all re-render in lockstep with pure functions of state). On
  // pointerup, dispatch each shape's adapter.commit through
  // commitSourceEdit and forward to host.setSource.
  useEffect(() => {
    if (!gestureMeta) return;
    const {
      pointerStartX,
      pointerStartY,
      scale,
      cursor,
      label,
      spans,
      slideIdx,
      templates,
    } = gestureMeta;

    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - pointerStartX) / scale;
      const dy = (e.clientY - pointerStartY) / scale;
      setGestureLive({ dx, dy });
    };

    const onUp = (e: PointerEvent) => {
      const dx = (e.clientX - pointerStartX) / scale;
      const dy = (e.clientY - pointerStartY) / scale;
      // Treat near-zero motion as a click rather than a gesture
      // commit. (For body drag this means clicking a shape selects
      // without committing; for handle drag, an accidental click
      // on a corner does nothing.)
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        setGestureMeta(null);
        setGestureLive(ZERO_LIVE);
        return;
      }
      const result = commitSourceEdit(sourceRef.current, label, (ast) => {
        // For each affected shape, look up its adapter and dispatch
        // adapter.commit with the final delta. Collect each shape's
        // PreserveSelection contribution.
        const preserveSelections: PreserveSelection[] = [];
        let any = false;
        for (const span of spans) {
          const key = spanKey(span);
          const template = templates.get(key);
          if (!template) continue;
          const data = stateRef.current?.shapes.get(key);
          if (!data) continue;
          const adapter = data.canvas as ShapeAdapter;
          const finalDelta = templateToDelta(template, dx, dy);
          const out = adapter.commit(ast, span, finalDelta, slideIdx);
          if (!out) continue;
          any = true;
          if (out.preserveSelection) {
            preserveSelections.push(out.preserveSelection);
          }
        }
        if (!any) return null;
        return { preserveSelections };
      });
      if (result) {
        commitToHost(result.newSource, result.newSelections);
      }
      setGestureMeta(null);
      setGestureLive(ZERO_LIVE);
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
  }, [gestureMeta, host]);

  // ─── Create-tool gesture lifecycle ──────────────────────────────
  //
  // Same pattern as the main gesture lifecycle: setState per
  // pointermove updates the preview's design-current coords, which
  // the React-rendered <CreatePreviewOverlay/> picks up.
  useEffect(() => {
    if (!createPreview) return;
    const { pointerStartX, pointerStartY, scale, designStartX, designStartY, tool } = createPreview;

    const onMove = (e: PointerEvent) => {
      const designCurrentX = (e.clientX - pointerStartX) / scale + designStartX;
      const designCurrentY = (e.clientY - pointerStartY) / scale + designStartY;
      setCreatePreview((prev) =>
        prev ? { ...prev, designCurrentX, designCurrentY } : null,
      );
    };

    const onUp = (e: PointerEvent) => {
      const designCurrentX = (e.clientX - pointerStartX) / scale + designStartX;
      const designCurrentY = (e.clientY - pointerStartY) / scale + designStartY;
      const result = commitSourceEdit(sourceRef.current, '<create>', (ast) => {
        const freeform = findActiveSlideFreeform(ast, activeIdxRef.current);
        if (!freeform) return null;
        if (tool === 'arrow') {
          const dx = designCurrentX - designStartX;
          const dy = designCurrentY - designStartY;
          if (Math.hypot(dx, dy) < 5) return null;
          appendShapeToFreeform(
            freeform,
            makeArrowNode(
              Math.round(designStartX),
              Math.round(designStartY),
              Math.round(designCurrentX),
              Math.round(designCurrentY),
            ),
          );
          return {};
        }
        const left = Math.round(Math.min(designStartX, designCurrentX));
        const top = Math.round(Math.min(designStartY, designCurrentY));
        const width = Math.round(Math.abs(designCurrentX - designStartX));
        const height = Math.round(Math.abs(designCurrentY - designStartY));
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
        commitToHost(result.newSource);
        setActiveTool('select');
      }
      setCreatePreview(null);
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
    };
  }, [createPreview, host]);

  // ─── Marquee selection ──────────────────────────────────────────
  //
  // Pointerdown on empty Freeform space → marquee. setState per
  // pointermove drives the React-rendered <MarqueePreviewOverlay/>;
  // on release, walk the loaded shapes registry, intersect bounds
  // with marquee rect, set selection.
  useEffect(() => {
    if (!marquee) return;
    const { pointerStartX, pointerStartY, scale, designStartX, designStartY, freeformDiv, shift } = marquee;

    const onMove = (e: PointerEvent) => {
      const designCurrentX = (e.clientX - pointerStartX) / scale + designStartX;
      const designCurrentY = (e.clientY - pointerStartY) / scale + designStartY;
      setMarquee((prev) =>
        prev ? { ...prev, designCurrentX, designCurrentY } : null,
      );
    };

    const onUp = (e: PointerEvent) => {
      const designCurrentX = (e.clientX - pointerStartX) / scale + designStartX;
      const designCurrentY = (e.clientY - pointerStartY) / scale + designStartY;
      const dx = designCurrentX - designStartX;
      const dy = designCurrentY - designStartY;
      // Click without meaningful drag — treat as click-to-clear.
      // Shift makes it a no-op.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        if (!shift) setSelected([]);
        setMarquee(null);
        return;
      }
      const left = Math.min(designStartX, designCurrentX);
      const top = Math.min(designStartY, designCurrentY);
      const right = Math.max(designStartX, designCurrentX);
      const bottom = Math.max(designStartY, designCurrentY);
      // Iterate the shapes registry rather than walking the DOM.
      // Every shape with an adapter goes through the loader's
      // ShapeProjection, so the registry has them all. Filter by
      // active slide so multi-slide decks don't pull selectables
      // from inactive slides.
      const intersected: SourceRange[] = [];
      const shapes = stateRef.current?.shapes;
      const slideIdx = activeIdxRef.current;
      if (shapes) {
        for (const data of shapes.values()) {
          if (data.slideIdx !== slideIdx) continue;
          const adapter = data.canvas as ShapeAdapter;
          const b = adapter.calculateBounds(data.params);
          if (!b) continue;
          if (
            b.left < right &&
            b.left + b.width > left &&
            b.top < bottom &&
            b.top + b.height > top
          ) {
            intersected.push({
              start: data.comp.span.start.offset,
              end: data.comp.span.end.offset,
            });
          }
        }
      }
      if (shift) {
        setSelected((current) => {
          const out = [...current];
          for (const r of intersected) {
            if (!out.some((s) => s.start === r.start && s.end === r.end)) {
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
    };
  }, [marquee]);

  // ─── Keyboard: Escape, Delete / Backspace, Cmd-Z / Cmd-Shift-Z ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      ) {
        // Editable text element has focus — defer to its native
        // handling for everything (typing, native undo).
        return;
      }

      // Undo / redo (Cmd/Ctrl + Z, Cmd/Ctrl + Shift + Z). Modifier-
      // gated; handled before the no-modifier early return below.
      // Reaches our canvas-side undo stack — gesture commits push,
      // Cmd-Z pops onto redoStack, Cmd-Shift-Z reverses. VS Code's
      // editor-native undo also tracks each WorkspaceEdit-applied
      // canvas commit, so editor-focused undo "just works"
      // through that path; this handler covers the
      // canvas-focused / standalone case.
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (ctrlOrCmd && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        // Always preventDefault on Cmd-Z / Cmd-Shift-Z reaching the
        // canvas. Even when our undo / redo stack is empty, the
        // browser's native input-undo can reach back into the
        // editor textarea's recent edits (especially after a
        // programmatic .fill()), surprising the user. The canvas-
        // owned undo is the single source of truth from this
        // handler's perspective.
        e.preventDefault();
        if (e.shiftKey) {
          const next = redoStackRef.current.pop();
          if (next === undefined) return;
          undoStackRef.current.push(sourceRef.current);
          internalSourceChangeRef.current = true;
          host.setSource?.(next);
          return;
        }
        const prev = undoStackRef.current.pop();
        if (prev === undefined) return;
        redoStackRef.current.push(sourceRef.current);
        internalSourceChangeRef.current = true;
        host.setSource?.(prev);
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
        const targets = selected;
        const result = commitSourceEdit(sourceRef.current, '<delete>', (ast) => {
          let any = false;
          for (const target of targets) {
            if (removeShapeAtSpan(ast, target)) any = true;
          }
          return any ? {} : null;
        });
        if (result) {
          commitToHost(result.newSource);
          setSelected([]);
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, selected, host]);

  // ─── Derived gesture deltas (for context distribution) ──────────
  //
  // Turns gesture state's `templates + dx/dy` into a Map<spanKey,
  // ShapeDelta> that the GestureProvider hands down to every
  // ShapeProjection wrapper and to the SelectionLayer.
  const gestureDeltas = useMemo<ReadonlyMap<string, ShapeDelta>>(() => {
    if (!gestureMeta) return EMPTY_DELTAS;
    const out = new Map<string, ShapeDelta>();
    for (const [key, template] of gestureMeta.templates) {
      out.set(key, templateToDelta(template, gestureLive.dx, gestureLive.dy));
    }
    return out;
  }, [gestureMeta, gestureLive]);

  // ─── startGesture callback for adapter handles ──────────────────
  //
  // Adapters' Handles components call this when one of their
  // handles' pointerdown fires. The framework converts the
  // HandleGestureInit to a GestureState and sets it.
  const startGesture: StartGesture = useCallback(
    (init, event) => {
      const slideIdx = activeIdxRef.current;
      // Handle drags affect a single shape — the one currently
      // selected (which is what triggered the handle's render).
      // selected[0] is that shape since handles only render when
      // selection.length === 1 (per SelectionLayer).
      const cur = selected;
      if (cur.length !== 1) return;
      const span = cur[0]!;
      const key = spanKey(span);
      const template: DeltaTemplate =
        init.kind === 'box-resize'
          ? { kind: 'box-resize', direction: init.direction, original: init.original }
          : {
              kind: 'arrow-endpoint',
              endpoint: init.endpoint,
              originalX: init.originalX,
              originalY: init.originalY,
              fixedX: init.fixedX,
              fixedY: init.fixedY,
            };
      setGestureMeta({
        templates: new Map([[key, template]]),
        spans: [span],
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        scale: getCurrentScale(),
        slideIdx,
        label: '<resize>',
        cursor: null,
      });
      setGestureLive(ZERO_LIVE);
    },
    [selected],
  );

  if (!state) {
    return <div className="sw-canvas-status">waiting for source…</div>;
  }

  const errors = state.diagnostics.filter((d) => d.severity === 'error');
  const slide = state.slides[activeIdx];
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
            <GestureProvider deltas={gestureDeltas}>
              <ScaledCanvas
                onSelectRange={(range: SourceRange) => host.sendSelection(range)}
                onTextEdit={(target) => setEditing(target)}
                onDragStart={(target) =>
                  startBodyDrag(target, selected, state.shapes, setGestureMeta, setGestureLive)
                }
                onCreateStart={(target) =>
                  startCreate(target, activeTool, setCreatePreview)
                }
                onMarqueeStart={(target) => {
                  setMarquee({
                    freeformDiv: target.freeformDiv,
                    pointerStartX: target.pointerStartX,
                    pointerStartY: target.pointerStartY,
                    scale: target.scale,
                    designStartX: target.designStartX,
                    designStartY: target.designStartY,
                    designCurrentX: target.designStartX,
                    designCurrentY: target.designStartY,
                    shift: target.shift,
                  });
                }}
                onSelectShape={(range, modifiers) =>
                  applySelectionClick(range, modifiers, setSelected)
                }
                activeTool={activeTool}
              >
                {preparedSlide}
              </ScaledCanvas>
              <SelectionLayer
                selected={selected}
                shapes={state.shapes}
                gestureDeltas={gestureDeltas}
                renderHandles={activeTool === 'select' && !gestureMeta}
                startGesture={startGesture}
              />
              <MarqueePreviewOverlay marquee={marquee} />
              <CreatePreviewOverlay createPreview={createPreview} />
            </GestureProvider>
          </div>
        ) : null}
      </div>
    </DeckMetaContext.Provider>
  );
}

const EMPTY_DELTAS: ReadonlyMap<string, ShapeDelta> = new Map();

// Re-find each previously-selected shape in the new shapes
// registry by (slideIdx + childIdx + componentName). Used for
// external-edit selection preservation. Survives:
//   - param-only edits (typing inside a string, changing x / y
//     / width / height — span shifts but identity is intact)
//   - whitespace / formatting edits (canonical re-emit on save)
//   - edits to OTHER shapes (only the edited shape's span shifts;
//     the rest stay at the same childIdx)
// Doesn't survive (limitations):
//   - inserting a sibling before the selected shape (childIdx
//     shifts; identity is misaligned by 1)
//   - deleting the selected shape (no longer present)
//   - reordering siblings (childIdx swap)
// Stable IDs in source would fix these (per SLIDEWRIGHT.md / IDs
// in source); deferred to a future revision.
function preserveSelectionAcrossExternalEdit(
  prevSelected: SourceRange[],
  prevShapes: ReadonlyMap<string, ShapeData> | undefined,
  nextShapes: ReadonlyMap<string, ShapeData>,
): SourceRange[] {
  if (!prevShapes || prevSelected.length === 0) return [];
  // Build a (slideIdx + childIdx + componentName) → newSpan index
  // for the new registry.
  const positionToSpan = new Map<string, SourceRange>();
  for (const data of nextShapes.values()) {
    if (data.childIdx < 0) continue;
    const positionKey = `${data.slideIdx}-${data.childIdx}-${data.comp.name}`;
    positionToSpan.set(positionKey, {
      start: data.comp.span.start.offset,
      end: data.comp.span.end.offset,
    });
  }
  const out: SourceRange[] = [];
  for (const span of prevSelected) {
    const oldKey = spanKey(span);
    const oldData = prevShapes.get(oldKey);
    if (!oldData || oldData.childIdx < 0) continue;
    const positionKey = `${oldData.slideIdx}-${oldData.childIdx}-${oldData.comp.name}`;
    const newSpan = positionToSpan.get(positionKey);
    if (newSpan) out.push(newSpan);
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────

function templateToDelta(
  template: DeltaTemplate,
  dx: number,
  dy: number,
): ShapeDelta {
  if (template.kind === 'translate') {
    return { kind: 'translate', dx, dy };
  }
  if (template.kind === 'box-resize') {
    return {
      kind: 'box-resize',
      direction: template.direction,
      original: template.original,
      dx,
      dy,
    };
  }
  return {
    kind: 'arrow-endpoint',
    endpoint: template.endpoint,
    originalX: template.originalX,
    originalY: template.originalY,
    fixedX: template.fixedX,
    fixedY: template.fixedY,
    dx,
    dy,
  };
}

// Body-drag dispatch. Decides whether the drag is single-shape or
// group (based on the clicked shape's membership in the current
// selection), builds a translate-template per affected shape, sets
// gesture state.
function startBodyDrag(
  target: DragStart,
  selected: ReadonlyArray<SourceRange>,
  shapes: ReadonlyMap<string, ShapeData>,
  setGestureMeta: (g: GestureMeta) => void,
  setGestureLive: (l: GestureLive) => void,
): void {
  const targetSpan = { start: target.start, end: target.end };
  const isInSelection = selected.some(
    (s) => s.start === targetSpan.start && s.end === targetSpan.end,
  );
  const dragSpans =
    isInSelection && selected.length > 1
      ? Array.from(selected)
      : [targetSpan];
  // Build a translate-template per affected shape. The same
  // template applies to every shape in a group drag — they all
  // translate by the same dx/dy.
  const templates = new Map<string, DeltaTemplate>();
  const spans: SourceRange[] = [];
  let slideIdx = 0;
  for (const span of dragSpans) {
    const key = spanKey(span);
    const data = shapes.get(key);
    if (!data) continue;
    templates.set(key, { kind: 'translate' });
    spans.push(span);
    slideIdx = data.slideIdx;
  }
  if (templates.size === 0) return;
  setGestureMeta({
    templates,
    spans,
    pointerStartX: target.pointerStartX,
    pointerStartY: target.pointerStartY,
    scale: target.scale,
    slideIdx,
    label: '<drag>',
    cursor: 'grabbing',
  });
  setGestureLive(ZERO_LIVE);
}

// Create-gesture dispatch. ScaledCanvas dispatches CreateStart with
// the freeform's positioned div + design-space pointer coords; we
// turn it into a CreatePreview.
function startCreate(
  target: CreateStart,
  activeTool: Tool,
  setCreatePreview: (cp: CreatePreview) => void,
): void {
  if (activeTool === 'select') return;
  setCreatePreview({
    tool: activeTool,
    freeformDiv: target.containerEl,
    pointerStartX: target.pointerStartX,
    pointerStartY: target.pointerStartY,
    scale: target.scale,
    designStartX: target.designStartX,
    designStartY: target.designStartY,
    designCurrentX: target.designStartX,
    designCurrentY: target.designStartY,
  });
}

// Selection-click handler. Replace / toggle / keep based on whether
// the clicked shape is already selected and whether shift is held.
function applySelectionClick(
  range: SourceRange | null,
  modifiers: { shift: boolean },
  setSelected: (
    update: SourceRange[] | ((current: SourceRange[]) => SourceRange[]),
  ) => void,
): void {
  if (!range) {
    if (!modifiers.shift) setSelected([]);
    return;
  }
  setSelected((current: SourceRange[]) => {
    const alreadySelected = current.some(
      (s) => s.start === range.start && s.end === range.end,
    );
    if (modifiers.shift) {
      return alreadySelected
        ? current.filter(
            (s) => !(s.start === range.start && s.end === range.end),
          )
        : [...current, range];
    }
    return alreadySelected ? current : [range];
  });
}

// ─── Marquee preview (React-rendered, portaled into freeform) ───

function MarqueePreviewOverlay({
  marquee,
}: {
  marquee: MarqueeState | null;
}): ReactNode {
  if (!marquee) return null;
  const left = Math.min(marquee.designStartX, marquee.designCurrentX);
  const top = Math.min(marquee.designStartY, marquee.designCurrentY);
  const width = Math.abs(marquee.designCurrentX - marquee.designStartX);
  const height = Math.abs(marquee.designCurrentY - marquee.designStartY);
  return createPortal(
    <div
      className="sw-marquee"
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
        background: 'rgba(0, 102, 255, 0.08)',
        border: '1px dashed rgba(0, 102, 255, 0.85)',
        boxSizing: 'border-box',
      }}
    />,
    marquee.freeformDiv,
  );
}

// ─── Create preview (React-rendered, portaled into freeform) ────

function CreatePreviewOverlay({
  createPreview,
}: {
  createPreview: CreatePreview | null;
}): ReactNode {
  if (!createPreview) return null;
  if (createPreview.tool === 'arrow') {
    return createPortal(
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <line
          x1={createPreview.designStartX}
          y1={createPreview.designStartY}
          x2={createPreview.designCurrentX}
          y2={createPreview.designCurrentY}
          stroke="rgba(0, 102, 255, 0.85)"
          strokeWidth={4}
          strokeDasharray="6 4"
          strokeLinecap="round"
        />
      </svg>,
      createPreview.freeformDiv,
    );
  }
  const left = Math.min(createPreview.designStartX, createPreview.designCurrentX);
  const top = Math.min(createPreview.designStartY, createPreview.designCurrentY);
  const width = Math.abs(createPreview.designCurrentX - createPreview.designStartX);
  const height = Math.abs(createPreview.designCurrentY - createPreview.designStartY);
  return createPortal(
    <div
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
        background: 'rgba(0, 102, 255, 0.15)',
        border: '2px dashed rgba(0, 102, 255, 0.85)',
        boxSizing: 'border-box',
      }}
    />,
    createPreview.freeformDiv,
  );
}

