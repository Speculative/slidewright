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
  componentTarget,
  findTargetIndex,
  selectionTargetsEqual,
  type SelectionTarget,
} from './selection-target.js';
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
  ShapeAdapter,
  ShapeDelta,
  StartGesture,
  TransformDelta,
} from './shape-adapter.js';
import { resizeRect } from './rect-adapter.js';
import { GestureProvider, spanKey } from './gesture-context.js';
import { wrapShape } from './shape-projection.js';
import { isLayoutAdapter, type LayoutAdapter } from './layout-adapter.js';
import { SelectionLayer } from './selection-layer.js';
import { GestureOverlayLayer } from './gesture-overlay-layer.js';
import { DiagnosticsPanel } from './DiagnosticsPanel.js';
import { SlideStrip } from './SlideStrip.js';
import { ResizeHandle } from './ResizeHandle.js';
import {
  HierarchyPanel,
  PropertiesPanel,
  type SlotInfo,
} from './InspectorPanels.js';
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

// Bottom strip — vertical extent of [hierarchy | properties |
// bottomExtra]. Resizing drags the boundary between canvas and strip.
const BOTTOM_HEIGHT_KEY = 'slidewright.canvas.bottomStripHeight';
const BOTTOM_HEIGHT_DEFAULT = 280;
const BOTTOM_HEIGHT_MIN = 80;
const BOTTOM_HEIGHT_MAX = 800;

const HIERARCHY_WIDTH_KEY = 'slidewright.canvas.hierarchyWidth';
const HIERARCHY_WIDTH_DEFAULT = 260;
const HIERARCHY_WIDTH_MIN = 160;
const HIERARCHY_WIDTH_MAX = 600;

const PROPERTIES_WIDTH_KEY = 'slidewright.canvas.propertiesWidth';
const PROPERTIES_WIDTH_DEFAULT = 300;
const PROPERTIES_WIDTH_MIN = 160;
const PROPERTIES_WIDTH_MAX = 600;

function readStoredSize(
  key: string,
  def: number,
  min: number,
  max: number,
): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return def;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  } catch {
    return def;
  }
}

const DESIGN_W = 1920;

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
//     Carries pointer captures, the per-shape gesture states, and
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

// Per-shape gesture state. Three arms:
//   - `translate` — body drag / group body drag. Per-frame delta is
//     the universal `{ kind: 'translate', dx, dy }`; same for every
//     selected shape.
//   - `transform` — group-resize member marker. The actual matrix is
//     derived each frame from gestureMeta.groupResize (single source
//     of truth for the whole group, since every member sees the same
//     transform).
//   - `opaque` — adapter-bespoke gesture. The payload was produced
//     by `adapter.buildGestureState(init)` at gesture-start; per-
//     frame `adapter.combineGestureState(payload, dx, dy)` produces
//     the opaque delta. The framework treats both as `unknown`.
type GestureState =
  | { kind: 'translate' }
  | { kind: 'transform' }
  | { kind: 'opaque'; payload: unknown };

interface GestureMeta {
  states: ReadonlyMap<string, GestureState>;
  spans: ReadonlyArray<SourceRange>;
  pointerStartX: number;
  pointerStartY: number;
  scale: number;
  slideIdx: number;
  label: string;
  // CSS cursor pinned on document.body for the gesture's duration.
  // 'grabbing' for body-drag; 'ns-resize' / 'ew-resize' for layout
  // gap-drag; null leaves the cursor untouched.
  cursor: string | null;
  // Set when this is a group-resize gesture. The framework uses the
  // captured group bbox + direction to compute a single transform
  // each frame, then replicates that transform to every member's
  // gesture state.
  groupResize?: {
    direction: BoxResizeDirection;
    original: { x: number; y: number; width: number; height: number };
  };
}

interface GestureLive {
  dx: number;
  dy: number;
}

const ZERO_LIVE: GestureLive = { dx: 0, dy: 0 };

// ─── Undo/redo entry ──────────────────────────────────────────────
//
// Each commit captures the pre-commit source plus the slide the
// commit was made on. On pop, the active slide is restored alongside
// the source so the user sees the change being applied/reverted.
interface UndoEntry {
  source: string;
  slideIdx: number;
}

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

export function App({
  host,
  bottomExtra,
}: {
  host: Host;
  // Optional slot rendered as the rightmost column of the bottom
  // strip, alongside the inspector. The standalone passes its
  // EditorPane here; the VS Code webview leaves it empty (VS Code's
  // own editor is the source surface).
  bottomExtra?: ReactElement | null;
}): ReactElement {
  const [state, setState] = useState<RenderState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [stripWidth, setStripWidth] = useState<number>(() =>
    readStoredSize(STRIP_WIDTH_KEY, STRIP_WIDTH_DEFAULT, STRIP_WIDTH_MIN, STRIP_WIDTH_MAX),
  );
  const [bottomHeight, setBottomHeight] = useState<number>(() =>
    readStoredSize(
      BOTTOM_HEIGHT_KEY,
      BOTTOM_HEIGHT_DEFAULT,
      BOTTOM_HEIGHT_MIN,
      BOTTOM_HEIGHT_MAX,
    ),
  );
  const [hierarchyWidth, setHierarchyWidth] = useState<number>(() =>
    readStoredSize(
      HIERARCHY_WIDTH_KEY,
      HIERARCHY_WIDTH_DEFAULT,
      HIERARCHY_WIDTH_MIN,
      HIERARCHY_WIDTH_MAX,
    ),
  );
  const [propertiesWidth, setPropertiesWidth] = useState<number>(() =>
    readStoredSize(
      PROPERTIES_WIDTH_KEY,
      PROPERTIES_WIDTH_DEFAULT,
      PROPERTIES_WIDTH_MIN,
      PROPERTIES_WIDTH_MAX,
    ),
  );
  const [editing, setEditing] = useState<TextEditTarget | null>(null);
  const [createPreview, setCreatePreview] = useState<CreatePreview | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [gestureMeta, setGestureMeta] = useState<GestureMeta | null>(null);
  const [gestureLive, setGestureLive] = useState<GestureLive>(ZERO_LIVE);
  const [activeTool, setActiveTool] = useState<Tool>('select');
  // Selection is always an array. Single-select is length === 1.
  // Multi-select is bounded to one layout context (one Freeform).
  const [selected, setSelected] = useState<SelectionTarget[]>([]);

  // Selection-preservation across host.setSource. Spans shift after
  // every emit; gestures stash the post-emit selection here before
  // calling setSource, and the subscribe handler re-applies on the
  // round-trip. External edits leave it null and selection clears.
  const pendingSelectionRef = useRef<SelectionTarget[] | null>(null);

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
  //
  // Entries carry the slide the commit was made on so popping either
  // stack also navigates back to that slide — without it, source
  // reverts but the user's view stays put, which is confusing when
  // the change wasn't on the active slide.
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  // Set true before any internal setSource (gesture commit, undo,
  // redo). Subscribe reads + clears it: truthy means "the source
  // change we're about to process was driven by us; preserve the
  // undo stacks." Falsy means external — barrier behavior.
  const internalSourceChangeRef = useRef(false);

  // activeIdx mirror — read inside long-lived closures (notably
  // the host.subscribe callback and commitToHost) so effect deps
  // don't have to include `activeIdx`. Every slide change would
  // otherwise re-subscribe, triggering the host's immediate-fire-
  // on-subscribe, which was indistinguishable from an external
  // edit and silently cleared the undo stack on every nav.
  const activeIdxRef = useRef(activeIdx);
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);

  // Wraps host.setSource for any canvas-driven source change so
  // the undo stacks see the pre-change source and the subscribe
  // handler treats the round-trip as internal.
  const commitToHost = useCallback(
    (newSource: string, newSelections?: SourceRange[]) => {
      undoStackRef.current.push({
        source: sourceRef.current,
        slideIdx: activeIdxRef.current,
      });
      redoStackRef.current = [];
      internalSourceChangeRef.current = true;
      if (newSelections && newSelections.length > 0) {
        // Commit-pipeline selections come back as plain SourceRanges
        // (the AST helpers don't model selection kinds). Wrap as
        // component targets — every gesture commit today preserves
        // a component selection (shape body-drag / resize / group
        // resize / layout reorder).
        pendingSelectionRef.current = newSelections.map(componentTarget);
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
  useEffect(() => {
    try {
      localStorage.setItem(BOTTOM_HEIGHT_KEY, String(bottomHeight));
    } catch {
      // Storage unavailable; fine to lose.
    }
  }, [bottomHeight]);
  useEffect(() => {
    try {
      localStorage.setItem(HIERARCHY_WIDTH_KEY, String(hierarchyWidth));
    } catch {
      // Storage unavailable; fine to lose.
    }
  }, [hierarchyWidth]);
  useEffect(() => {
    try {
      localStorage.setItem(PROPERTIES_WIDTH_KEY, String(propertiesWidth));
    } catch {
      // Storage unavailable; fine to lose.
    }
  }, [propertiesWidth]);

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
      //      gesture states point at a stale AST).
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
      states,
      groupResize,
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
          const state = states.get(key);
          if (!state) continue;
          const data = stateRef.current?.shapes.get(key);
          if (!data) continue;
          const adapter = data.canvas as ShapeAdapter | LayoutAdapter;
          const finalDelta = gestureStateToDelta(state, dx, dy, groupResize, adapter);
          if (!adapter.commit) continue;
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
      const intersected: SelectionTarget[] = [];
      const shapes = stateRef.current?.shapes;
      const slideIdx = activeIdxRef.current;
      if (shapes) {
        for (const data of shapes.values()) {
          if (data.slideIdx !== slideIdx) continue;
          // v0.4 tight cut: marquee picks shapes only. Layouts can
          // be selected by direct click but not by marquee — their
          // bounds are flow-laid and they often span the whole slide
          // area, making marquee selection counterintuitive.
          if (isLayoutAdapter(data.canvas)) continue;
          const adapter = data.canvas as ShapeAdapter;
          const b = adapter.calculateBounds(data.params);
          if (!b) continue;
          if (
            b.left < right &&
            b.left + b.width > left &&
            b.top < bottom &&
            b.top + b.height > top
          ) {
            intersected.push(
              componentTarget({
                start: data.comp.span.start.offset,
                end: data.comp.span.end.offset,
              }),
            );
          }
        }
      }
      if (shift) {
        setSelected((current) => {
          const out = [...current];
          for (const t of intersected) {
            if (findTargetIndex(out, t) === -1) out.push(t);
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
          const entry = redoStackRef.current.pop();
          if (entry === undefined) return;
          undoStackRef.current.push({
            source: sourceRef.current,
            slideIdx: entry.slideIdx,
          });
          internalSourceChangeRef.current = true;
          if (entry.slideIdx !== activeIdxRef.current) {
            setActiveIdx(entry.slideIdx);
          }
          host.setSource?.(entry.source);
          return;
        }
        const entry = undoStackRef.current.pop();
        if (entry === undefined) return;
        redoStackRef.current.push({
          source: sourceRef.current,
          slideIdx: entry.slideIdx,
        });
        internalSourceChangeRef.current = true;
        if (entry.slideIdx !== activeIdxRef.current) {
          setActiveIdx(entry.slideIdx);
        }
        host.setSource?.(entry.source);
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
            // Slot targets aren't deletable as components — clear-
            // slot semantics is a separate gesture (deferred). Skip
            // for now; only component selections are deleted.
            if (target.kind !== 'component') continue;
            if (removeShapeAtSpan(ast, target.span)) any = true;
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
  // Turns gesture state's `states + dx/dy` into a Map<spanKey,
  // ShapeDelta> that the GestureProvider hands down to every
  // ShapeProjection wrapper and to the SelectionLayer. Opaque-arm
  // entries need their adapter to produce the per-frame delta;
  // looked up from the live shapes registry.
  const gestureDeltas = useMemo<ReadonlyMap<string, ShapeDelta>>(() => {
    if (!gestureMeta || !state) return EMPTY_DELTAS;
    const out = new Map<string, ShapeDelta>();
    for (const [key, gestureState] of gestureMeta.states) {
      const data = state.shapes.get(key);
      const adapter =
        (data?.canvas as ShapeAdapter | LayoutAdapter | undefined) ?? null;
      out.set(
        key,
        gestureStateToDelta(
          gestureState,
          gestureLive.dx,
          gestureLive.dy,
          gestureMeta.groupResize,
          adapter,
        ),
      );
    }
    return out;
  }, [gestureMeta, gestureLive, state]);

  // ─── startGesture callback for adapter handles ──────────────────
  //
  // Two HandleGestureInit kinds:
  //   - `group-resize` — emitted by SelectionLayer's GroupHandles
  //     when 2+ shapes are selected. Framework-known: per-shape
  //     gesture states are `{ kind: 'transform' }` markers and the
  //     actual matrix is derived each frame from
  //     gestureMeta.groupResize.
  //   - `opaque` — emitted by an adapter's per-shape Handles. Carries
  //     the shape's span plus the adapter's internal init payload.
  //     We look up the adapter and call its buildGestureState to
  //     capture a per-shape opaque payload; per-frame
  //     combineGestureState produces the opaque delta.
  const startGesture: StartGesture = useCallback(
    (init, event) => {
      const slideIdx = activeIdxRef.current;
      if (init.kind === 'group-resize') {
        const states = new Map<string, GestureState>();
        const spans: SourceRange[] = [];
        for (const m of init.members) {
          const span: SourceRange = { start: m.start, end: m.end };
          states.set(spanKey(span), { kind: 'transform' });
          spans.push(span);
        }
        if (states.size === 0) return;
        setGestureMeta({
          states,
          spans,
          pointerStartX: event.clientX,
          pointerStartY: event.clientY,
          scale: getCurrentScale(),
          slideIdx,
          label: '<group-resize>',
          cursor: null,
          groupResize: { direction: init.direction, original: init.originalBox },
        });
        setGestureLive(ZERO_LIVE);
        return;
      }
      // Opaque arm. Look up the adapter via the span the Handles
      // component carried (or interceptChildDrag dispatcher); ask
      // it to build a per-shape gesture state. Same path serves
      // ShapeAdapter (Handles-emitted opaque init) and LayoutAdapter
      // (interceptChildDrag-emitted opaque init).
      const span = init.span;
      const key = spanKey(span);
      const data = stateRef.current?.shapes.get(key);
      if (!data) return;
      const adapter = data.canvas as ShapeAdapter | LayoutAdapter | undefined;
      if (!adapter?.buildGestureState) return;
      const payload = adapter.buildGestureState(init.init);
      if (payload == null) return;
      setGestureMeta({
        states: new Map([[key, { kind: 'opaque', payload }]]),
        spans: [{ start: span.start, end: span.end }],
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        scale: getCurrentScale(),
        slideIdx,
        label: '<resize>',
        cursor: init.cursor ?? null,
      });
      setGestureLive(ZERO_LIVE);
    },
    [],
  );

  if (!state) {
    return <div className="sw-canvas-status">waiting for source…</div>;
  }

  const errors = state.diagnostics.filter((d) => d.severity === 'error');
  const slide = state.slides[activeIdx];
  const preparedSlide = slide ? prepareSlide(slide) : null;
  // Set of selectable component spans — populated from the shapes
  // registry. A component is selectable iff it exports a `canvas`
  // field (the loader registers it). ScaledCanvas's pointerdown
  // walk uses this set to find the innermost selectable ancestor
  // without a hardcoded selector list.
  const selectableSpans = state.shapes;
  // Resolved selection context for the property panel. One of
  // componentShape / slotInfo is non-null when single-selected;
  // multiCount > 1 short-circuits both to a multi-select hint.
  const singleTarget = selected.length === 1 ? selected[0]! : null;
  const selectedShape: ShapeData | null =
    singleTarget?.kind === 'component'
      ? findShapeForRange(state.shapes, singleTarget.span)
      : null;
  const slotInfo: SlotInfo | null = (() => {
    if (!singleTarget || singleTarget.kind !== 'slot') return null;
    const parentShape = findShapeForRange(state.shapes, singleTarget.parentSpan);
    if (!parentShape) return null;
    const fill = parentShape.comp.fills.find(
      (f) => f.name === singleTarget.slotName,
    );
    if (!fill) return null;
    return { slotName: singleTarget.slotName, fill, parentShape };
  })();

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
                selectableSpans={selectableSpans}
                currentSelection={selected}
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
                onSelectShape={(target, modifiers) =>
                  applySelectionClick(target, modifiers, setSelected)
                }
                onChildDragStart={(target) => {
                  // Look up the parent component's adapter. If it's
                  // a LayoutAdapter with interceptChildDrag, ask it
                  // to take ownership of the drag. Returns true iff
                  // it accepted (init non-null) — ScaledCanvas then
                  // skips body-drag.
                  const parentData = state.shapes.get(spanKey(target.parentSpan));
                  if (!parentData) return false;
                  const adapter = parentData.canvas;
                  if (!isLayoutAdapter(adapter)) return false;
                  if (!adapter.interceptChildDrag) return false;
                  const init = adapter.interceptChildDrag({
                    childSpan: target.childSpan,
                    parentSpan: target.parentSpan,
                    parentEl: target.parentEl,
                    event: target.event,
                    scale: target.scale,
                  });
                  if (init == null) return false;
                  startGesture(
                    { kind: 'opaque', span: target.parentSpan, init },
                    target.event,
                  );
                  return true;
                }}
                activeTool={activeTool}
              >
                {preparedSlide}
              </ScaledCanvas>
              {/* Key on activeIdx so DOM-tied hook state (cached
                portal target, ResizeObserver subscriptions, layout
                snapshots) resets on slide navigation. The standalone
                canvas only mounts the active slide; without a remount,
                observers stay subscribed to the previous slide's now-
                detached DOM and never re-attach on nav-back. */}
              <SelectionLayer
                key={activeIdx}
                selected={selected}
                shapes={state.shapes}
                gestureDeltas={gestureDeltas}
                renderHandles={activeTool === 'select' && !gestureMeta}
                startGesture={startGesture}
              />
              <GestureOverlayLayer
                key={activeIdx}
                activeSpans={gestureMeta?.spans ?? EMPTY_SPANS}
                shapes={state.shapes}
                gestureDeltas={gestureDeltas}
              />
              <MarqueePreviewOverlay marquee={marquee} />
              <CreatePreviewOverlay createPreview={createPreview} />
            </GestureProvider>
          </div>
        ) : null}
      </div>
      {bottomExtra ? (
        <>
          <ResizeHandle
            axis="y"
            invert
            size={bottomHeight}
            setSize={setBottomHeight}
            min={BOTTOM_HEIGHT_MIN}
            max={BOTTOM_HEIGHT_MAX}
          />
          <div
            className="sw-canvas-bottom-strip"
            style={{ height: `${bottomHeight}px` }}
          >
            <div
              className="sw-bottom-col"
              style={{ width: `${hierarchyWidth}px` }}
            >
              <HierarchyPanel
                shapes={state.shapes}
                activeIdx={activeIdx}
                selected={selected}
                onSelect={(target, modifiers) =>
                  applySelectionClick(target, modifiers, setSelected)
                }
                onJumpToSource={(range) => host.sendSelection(range)}
              />
            </div>
            <ResizeHandle
              axis="x"
              size={hierarchyWidth}
              setSize={setHierarchyWidth}
              min={HIERARCHY_WIDTH_MIN}
              max={HIERARCHY_WIDTH_MAX}
            />
            <div
              className="sw-bottom-col"
              style={{ width: `${propertiesWidth}px` }}
            >
              <PropertiesPanel
                componentShape={selectedShape}
                slotInfo={slotInfo}
                multiCount={selected.length}
                source={state.source}
                onCommit={(newSource, newSelections) =>
                  commitToHost(newSource, newSelections)
                }
              />
            </div>
            <ResizeHandle
              axis="x"
              size={propertiesWidth}
              setSize={setPropertiesWidth}
              min={PROPERTIES_WIDTH_MIN}
              max={PROPERTIES_WIDTH_MAX}
            />
            <div className="sw-bottom-col sw-bottom-col-flex">
              {bottomExtra}
            </div>
          </div>
        </>
      ) : null}
    </DeckMetaContext.Provider>
  );
}

const EMPTY_DELTAS: ReadonlyMap<string, ShapeDelta> = new Map();
const EMPTY_SPANS: ReadonlyArray<SourceRange> = [];

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
  prevSelected: SelectionTarget[],
  prevShapes: ReadonlyMap<string, ShapeData> | undefined,
  nextShapes: ReadonlyMap<string, ShapeData>,
): SelectionTarget[] {
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
  const out: SelectionTarget[] = [];
  for (const target of prevSelected) {
    // Slot-target preservation across external edits is deferred —
    // would need to look up the parent's new span and re-derive the
    // SlotFill span post-emit. Drop slot selections for now.
    if (target.kind !== 'component') continue;
    const oldKey = spanKey(target.span);
    const oldData = prevShapes.get(oldKey);
    if (!oldData || oldData.childIdx < 0) continue;
    const positionKey = `${oldData.slideIdx}-${oldData.childIdx}-${oldData.comp.name}`;
    const newSpan = positionToSpan.get(positionKey);
    if (newSpan) out.push(componentTarget(newSpan));
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────

function gestureStateToDelta(
  state: GestureState,
  dx: number,
  dy: number,
  groupResize: GestureMeta['groupResize'] | undefined,
  adapter: ShapeAdapter | LayoutAdapter | null,
): ShapeDelta {
  if (state.kind === 'translate') {
    return { kind: 'translate', dx, dy };
  }
  if (state.kind === 'transform') {
    // Group resize. Without group context, fall back to identity —
    // shouldn't happen in practice (transform states only get
    // created together with groupResize), but stay safe.
    if (!groupResize) return { kind: 'transform', sx: 1, sy: 1, tx: 0, ty: 0 };
    return groupResizeToTransform(groupResize, dx, dy);
  }
  // Opaque arm — the adapter combines its captured payload with
  // the cursor delta to produce the per-frame opaque delta.
  // ShapeAdapter has combineGestureState as required, LayoutAdapter
  // has it optional; optional-chain handles both.
  if (!adapter?.combineGestureState) return { kind: 'opaque', delta: null };
  return {
    kind: 'opaque',
    delta: adapter.combineGestureState(state.payload, dx, dy),
  };
}

// Derive the per-frame transform from the captured group bbox +
// resize direction + cursor delta. The opposite corner / edge stays
// fixed; the named direction's corner / edge moves with the cursor;
// every member shape is mapped through `x' = sx*x + tx, y' = sy*y +
// ty`. Edges (n / s / e / w) only scale on one axis.
function groupResizeToTransform(
  ctx: NonNullable<GestureMeta['groupResize']>,
  dx: number,
  dy: number,
): TransformDelta {
  const { direction, original } = ctx;
  const newBox = resizeRect(direction, original, dx, dy);
  const horizontal = direction.includes('e') || direction.includes('w');
  const vertical = direction.includes('n') || direction.includes('s');
  const sx = horizontal ? newBox.width / original.width : 1;
  const sy = vertical ? newBox.height / original.height : 1;
  // Fixed-edge anchor: opposite side stays put under the scale.
  // For 'w', the EAST edge (original.x + original.width) is fixed;
  // for everything else (incl. no horizontal) the WEST edge is.
  const fixedX = direction.includes('w')
    ? original.x + original.width
    : original.x;
  const fixedY = direction.includes('n')
    ? original.y + original.height
    : original.y;
  return {
    kind: 'transform',
    sx,
    sy,
    tx: fixedX * (1 - sx),
    ty: fixedY * (1 - sy),
  };
}

// Body-drag dispatch. Decides whether the drag is single-shape or
// group (based on the clicked shape's membership in the current
// selection), builds a translate gesture state per affected shape,
// sets gestureMeta.
function startBodyDrag(
  target: DragStart,
  selected: ReadonlyArray<SelectionTarget>,
  shapes: ReadonlyMap<string, ShapeData>,
  setGestureMeta: (g: GestureMeta) => void,
  setGestureLive: (l: GestureLive) => void,
): void {
  const targetSpan = { start: target.start, end: target.end };
  // Body drag only applies to component selections — slot targets
  // aren't draggable bodies. Filter to component spans for the
  // group-drag membership check.
  const componentSpans: SourceRange[] = selected
    .filter((s) => s.kind === 'component')
    .map((s) => s.span);
  const isInSelection = componentSpans.some(
    (s) => s.start === targetSpan.start && s.end === targetSpan.end,
  );
  const dragSpans =
    isInSelection && componentSpans.length > 1
      ? componentSpans
      : [targetSpan];
  // Build a translate gesture state per affected shape. The same
  // state applies to every shape in a group drag — they all
  // translate by the same dx/dy. Layouts (HStack / VStack) in the
  // selection are skipped: tight cut doesn't gesture on them, and
  // their commit path doesn't have a `translate` arm. Without this
  // filter, group-dragging a shape while a layout is also selected
  // would crash trying to call adapter.commit on the layout.
  const states = new Map<string, GestureState>();
  const spans: SourceRange[] = [];
  let slideIdx = 0;
  for (const span of dragSpans) {
    const key = spanKey(span);
    const data = shapes.get(key);
    if (!data) continue;
    if (isLayoutAdapter(data.canvas)) continue;
    states.set(key, { kind: 'translate' });
    spans.push(span);
    slideIdx = data.slideIdx;
  }
  if (states.size === 0) return;
  setGestureMeta({
    states,
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
function findShapeForRange(
  shapes: ReadonlyMap<string, ShapeData>,
  range: SourceRange,
): ShapeData | null {
  for (const data of shapes.values()) {
    if (
      data.comp.span.start.offset === range.start &&
      data.comp.span.end.offset === range.end
    ) {
      return data;
    }
  }
  return null;
}

function applySelectionClick(
  target: SelectionTarget | null,
  modifiers: { shift: boolean },
  setSelected: (
    update:
      | SelectionTarget[]
      | ((current: SelectionTarget[]) => SelectionTarget[]),
  ) => void,
): void {
  if (!target) {
    if (!modifiers.shift) setSelected([]);
    return;
  }
  setSelected((current: SelectionTarget[]) => {
    const idx = findTargetIndex(current, target);
    const alreadySelected = idx !== -1;
    if (modifiers.shift) {
      return alreadySelected
        ? current.filter((_, i) => i !== idx)
        : [...current, target];
    }
    return alreadySelected ? current : [target];
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

