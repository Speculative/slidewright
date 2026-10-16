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
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { emit } from '../runtime/emitter.js';
import {
  loadDeck,
  type ShapeData,
  type SlideAstData,
} from '../runtime/loader.js';
import { parse } from '../runtime/parser.js';
import { numberLit, stringLit, booleanLit, nameRef, paragraphDocument } from '../runtime/ast-builders.js';
import type { Diagnostic } from '../runtime/diagnostics.js';
import type { Scope } from '../runtime/scope.js';
import { slotFill } from '../runtime/ast-builders.js';
import { RichTextEditor, type TextEditorSnapshot, type TextSessionHandle } from './rich-text/Editor.js';
import { BoxSettings, type TextBoxDefault, type TextBoxDefaults } from './rich-text/BoxSettings.js';
import type { TextFormattingState } from './rich-text/feedback.js';
import { commitOnTextBlur } from './rich-text/focus.js';
import { FormattingToolbar } from './rich-text/FormattingToolbar.js';
import { TextDocumentSessionContext } from './text-document-context.js';
import { components, staticTokens } from '../../decks/v0-reference/registry.js';
import { DeckMetaContext } from '../../src/Slide.jsx';

import type { Host, SourceRange } from './host.js';
import type { EditorPaneProjection } from './editor-projection.js';
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
  type EmptyTextSlotEditTarget,
  type TextEditTarget,
  type TextDocumentEditTarget,
} from './ScaledCanvas.js';
import {
  addStringSlotFill,
  appendEmptySlide,
  commitSourceEdit,
  componentByPath,
  findComponentAtSpan,
  findStringAt,
  insertIntoArraySlot,
  materializeSlotFill,
  pathToComponent,
  projectReorderedIndices,
  removeListItemAtSpan,
  removeShapeAtSpan,
  removeSlidesAtIndices,
  reorderSlides,
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
import { crossesDragThreshold } from './drag-threshold.js';
import { wrapShape } from './shape-projection.js';
import { isLayoutAdapter, type LayoutAdapter } from './layout-adapter.js';
import { SelectionLayer } from './selection-layer.js';
import { GestureOverlayLayer } from './gesture-overlay-layer.js';
import { DiagnosticsPanel } from './DiagnosticsPanel.js';
import { SlideStrip, type SlideClickModifiers } from './SlideStrip.js';
import { ResizeHandle } from './ResizeHandle.js';
import {
  HierarchyPanel,
  PropertiesPanel,
  collectSlideColors,
  type EmptySlotInfo,
  type SlotInfo,
} from './InspectorPanels.js';
import { AlignmentControls } from './AlignmentControls.js';
import { GroupingControls } from './GroupingControls.js';
import { findPortalAncestor } from './portal-target.js';
import { ToolPalette, SELECT_TOOL, type Tool, type ToolEntry } from './ToolPalette.js';
import {
  acceptsTargetSlot,
  type SlotType,
  type SlotTypeName,
} from '../runtime/contract.js';

interface DeckMeta {
  name: string;
  subtitle: string;
}

interface RenderState {
  scope: Scope;
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
  // Parallel to `slides` — one entry per top-level Slide invocation,
  // carrying its AST + meta. The inspector reads
  // `slidesData[activeIdx]` to render slide-level properties and to
  // show the slide as the first row in the hierarchy.
  slidesData: SlideAstData[];
  // Source-declared color tokens from `Deck.tokens: Tokens { ... }`,
  // merged with the registry's static tokens for the inspector
  // palette. Re-derived on every load.
  colorTokens: Record<string, string>;
}

// Slides before the first source-declared chapter use the scaffold default.
const DEFAULT_ACT_LABEL = 'Setup';

const STRIP_WIDTH_KEY = 'slidewright.canvas.stripWidth';
const STRIP_WIDTH_DEFAULT = 280;
const STRIP_WIDTH_MIN = 200;
const STRIP_WIDTH_MAX = 600;

// Bottom dock height. Resizing drags the boundary between canvas and dock.
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
const PROPERTIES_WIDTH_MIN = 260;
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
// as a fallback before a source-declared chapter). The slide arrives pre-
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
    actLabel: (inner.props as { actLabel?: string }).actLabel ?? DEFAULT_ACT_LABEL,
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

// ─── Tool-drag gesture (drag from toolbar onto a slot) ────────────
//
// Drag-mode toolbar entries (e.g., VStack, CardRow, TitleSlide)
// kick off a document-level pointer drag that resolves a valid
// drop target on each move and commits on release. Lives parallel
// to `createPreview` (modal draw) and `marquee`; one of the three
// is active at a time. See ToolPalette / `onDragStart`.

interface ToolDragState {
  // Component-registry key being dragged in.
  tool: string;
  // Whether the pointer has crossed the drag-commit threshold.
  // Pointerdown without movement should fall back to onClick on
  // entries that opt into both gestures; today's entries are
  // exclusive so committed=false ends as a silent no-op.
  committed: boolean;
  // Pointerdown coords in client space — used by the threshold
  // check before the drag commits.
  pointerStartX: number;
  pointerStartY: number;
  // Latest pointer position in client space — drives both the
  // hit-test and the drop-target overlay's positioning.
  pointerCurrentX: number;
  pointerCurrentY: number;
  // Last identified valid drop target (or null). `validity`
  // distinguishes "no candidate under pointer" (null) from
  // "candidate but slot type rejects" — for cursor feedback.
  target: ToolDragDropTarget | null;
  // Pointer is over a slot placeholder but it rejected. Drives
  // the `not-allowed` cursor. Mutually exclusive with `target`.
  invalidHover: boolean;
}

// Resolved drop-target context. Two arms — empty-slot drops
// materialize the slot fill from scratch; array-gap drops insert
// at a position within an existing list.
type ToolDragDropTarget =
  | EmptySlotDropTarget
  | ArrayGapDropTarget;

interface EmptySlotDropTarget {
  kind: 'empty-slot';
  // The placeholder DOM element — outline rect comes from its
  // `getBoundingClientRect`.
  el: HTMLElement;
  parentStart: number;
  parentEnd: number;
  parentName: string;
  slotName: string;
  slotType: SlotType;
}

interface ArrayGapDropTarget {
  kind: 'array-gap';
  // Geometric gap rect in viewport coords — drives the outline.
  rect: { left: number; top: number; width: number; height: number };
  parentStart: number;
  parentEnd: number;
  parentName: string;
  slotName: string;
  slotType: SlotType;
  // Where to splice within the existing list. 0 ≤ index ≤ N.
  insertionIndex: number;
}

const TOOL_DRAG_THRESHOLD = 4;

// ─── Create gesture (drawing tools) ───────────────────────────────
//
// React-native preview state. Replaces the old imperative
// createElement('div'/'svg'/'line') + appendChild approach.

interface CreatePreview {
  // Component-registry key (e.g., 'Box', 'TextBox', 'Arrow').
  // Used to look up the insertion stub at commit time.
  tool: string;
  // Preview overlay shape — cached at gesture-start from the
  // component's `meta.insertion.modalPreview` so the overlay
  // renderer doesn't need to re-consult the registry every frame.
  previewShape: 'rect' | 'line';
  // Freeform's positioned div (the portal target — selection
  // visuals and create preview both portal in here).
  freeformDiv: HTMLElement;
  containerSpan: SourceRange;
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
  initialSelection: SelectionTarget[];
}

// Look up a shape's canvas adapter from the static registry. Used
// by gesture-dispatch and commit code that doesn't have access to
// the loader's resolved shape data.
// Resolve which empty-slot placeholder (if any) sits under a
// client-space point, and whether the dragged component is type-
// compatible with that slot. Returns:
//   - { target: T, invalidHover: false } when a valid placeholder
//     is under the pointer and accepts the dragged component;
//   - { target: null, invalidHover: true } when a placeholder is
//     present but rejects the dragged component (different type);
//   - { target: null, invalidHover: false } when no placeholder
//     is under the pointer.
//
// Only loader-emitted placeholders (`data-sw-slot-empty="true"`)
// participate. `omit` sigils don't render placeholders so they
// reject silently. Filled slots reject silently. Empty `array<>`
// slots authored as `children: []` don't render placeholders
// today either — step 7's gap indicators add those targets.
function hitTestDropTarget(
  clientX: number,
  clientY: number,
  produces: SlotTypeName,
): { target: ToolDragDropTarget | null; invalidHover: boolean } {
  const hit = document.elementFromPoint(clientX, clientY);
  // Empty-slot placeholder: unambiguous, check first.
  if (hit instanceof HTMLElement) {
    const placeholder = hit.closest<HTMLElement>(
      '[data-sw-slot-empty="true"]',
    );
    if (placeholder) {
      return hitTestEmptySlot(placeholder, produces);
    }
  }
  // Filled array slots: the wrapper is `display: contents` so
  // elementFromPoint can't address it directly, and the
  // before-first / after-last gaps land OUTSIDE the wrapper's
  // DOM subtree anyway. Scan all visible array slot wrappers in
  // the document; multiple may pass the bounds test for a single
  // pointer position (a nested HStack inside a VStack — both
  // wrappers' bounds contain the pointer). Pick the wrapper
  // whose *closest gap rect* is nearest the pointer, breaking
  // ties by DOM depth (innermost wins). This handles two cases
  // the simpler "innermost wins" rule got wrong:
  //   - User points at the outer VStack's before-first gap (the
  //     strip at the inner stack's top edge): outer's gap-0 rect
  //     contains the pointer at distance 0, while the inner's
  //     gap-0 rect is far away along the orthogonal axis. Outer
  //     wins — which is what the user wants when aiming at the
  //     space *above* the inner stack.
  //   - User points inside the inner stack proper: inner's
  //     before-first / after-last gap rects sit at the inner's
  //     edges and dominate. Inner wins.
  const wrappers = document.querySelectorAll<HTMLElement>(
    '[data-sw-slot-name][data-sw-slot-type^="array<"]',
  );
  let firstInvalid = false;
  let bestMatch: {
    wrapper: HTMLElement;
    result: { target: ToolDragDropTarget; invalidHover: false };
    distance: number;
  } | null = null;
  for (const wrapper of wrappers) {
    const result = hitTestArrayGap(wrapper, clientX, clientY, produces);
    if (result.target) {
      const cand = {
        wrapper,
        result: result as { target: ToolDragDropTarget; invalidHover: false },
        distance: result.distance,
      };
      if (!bestMatch) {
        bestMatch = cand;
      } else if (cand.distance < bestMatch.distance) {
        bestMatch = cand;
      } else if (
        cand.distance === bestMatch.distance &&
        bestMatch.wrapper.contains(wrapper)
      ) {
        // Tie on distance — prefer the innermost (deeper in DOM).
        bestMatch = cand;
      }
    } else if (result.invalidHover) {
      firstInvalid = true;
    }
  }
  if (bestMatch) return bestMatch.result;
  return { target: null, invalidHover: firstInvalid };
}

function hitTestEmptySlot(
  placeholder: HTMLElement,
  produces: SlotTypeName,
): { target: ToolDragDropTarget | null; invalidHover: boolean } {
  const parentStart = Number(placeholder.dataset.swSlotParentStart);
  const parentEnd = Number(placeholder.dataset.swSlotParentEnd);
  const slotName = placeholder.dataset.swSlotName;
  const slotType = placeholder.dataset.swSlotType as SlotType | undefined;
  if (
    !Number.isFinite(parentStart) ||
    !Number.isFinite(parentEnd) ||
    !slotName ||
    !slotType
  ) {
    return { target: null, invalidHover: false };
  }
  if (!acceptsTargetSlot(produces, slotType)) {
    return { target: null, invalidHover: true };
  }
  // Locate the visible inner element (the dashed box / inline
  // ghost-text span). The wrapper itself is `display: contents`,
  // so its bounding rect is empty — we use the first element
  // child for outline positioning.
  const visual =
    (placeholder.firstElementChild as HTMLElement | null) ?? placeholder;
  // Walk up the DOM to find the parent component's element —
  // its `data-sw-component` attr names the parent. Used in the
  // overlay label ("Drop into CardRow.body"). The walk starts at
  // the placeholder's parent so we don't bind to the placeholder
  // wrapper itself.
  const parentEl = placeholder.parentElement?.closest<HTMLElement>(
    '[data-sw-component]',
  );
  const parentName = parentEl?.dataset.swComponent ?? '';
  return {
    target: {
      kind: 'empty-slot',
      el: visual,
      parentStart,
      parentEnd,
      parentName,
      slotName,
      slotType,
    },
    invalidHover: false,
  };
}

// Filled array slot. Resolve which gap (before-first /
// between-children / after-last) the pointer is closest to, and
// return a drop target carrying the splice index + a rect for
// the overlay. Skips Freeform — Freeform's children are
// absolutely positioned with no obvious gap geometry, so its
// existing rect-draw modal continues to govern there.
function hitTestArrayGap(
  wrapper: HTMLElement,
  clientX: number,
  clientY: number,
  produces: SlotTypeName,
): { target: ToolDragDropTarget | null; invalidHover: boolean; distance: number } {
  const parentStart = Number(wrapper.dataset.swSlotParentStart);
  const parentEnd = Number(wrapper.dataset.swSlotParentEnd);
  const slotName = wrapper.dataset.swSlotName;
  const slotType = wrapper.dataset.swSlotType as SlotType | undefined;
  if (
    !Number.isFinite(parentStart) ||
    !Number.isFinite(parentEnd) ||
    !slotName ||
    !slotType
  ) {
    return { target: null, invalidHover: false, distance: Infinity };
  }
  if (!acceptsTargetSlot(produces, slotType)) {
    return { target: null, invalidHover: true, distance: Infinity };
  }
  const parentEl = wrapper.parentElement?.closest<HTMLElement>(
    '[data-sw-component]',
  );
  const parentName = parentEl?.dataset.swComponent ?? '';
  // Freeform children are absolutely positioned — gap geometry
  // doesn't apply. Skip and leave the existing rect-draw modal
  // to govern.
  if (parentName === 'Freeform') {
    return { target: null, invalidHover: false, distance: Infinity };
  }
  // The wrapper is `display: contents`, so its own
  // bounding-client-rect is meaningless. The rendered children
  // sit in its parent's flex layout. Each direct child is a
  // shape-projection wrapper that itself uses `display: contents`
  // (so the user's component renders directly in the parent's
  // layout). Drill one more level to find the element whose box
  // actually participates in layout — that's where the bounding
  // rect is non-zero.
  const childEls: HTMLElement[] = [];
  for (const c of wrapper.children) {
    if (!(c instanceof HTMLElement)) continue;
    const compEl = c.matches('[data-sw-component]')
      ? c
      : c.querySelector<HTMLElement>(':scope > [data-sw-component]');
    if (!compEl) continue;
    const visible = visibleBoxFor(compEl);
    if (visible) childEls.push(visible);
  }
  // Axis comes from the parent component's identity, not the
  // two-child geometry heuristic. The heuristic fails at N=1 (no
  // second child to compare against) and N=0 (no children at all).
  // VStack/HStack are the only stacks today; other layouts with
  // array slots fall back to the heuristic with 'v' default.
  const rects = childEls.map((c) => c.getBoundingClientRect());
  let axis: 'v' | 'h';
  if (parentName === 'VStack') axis = 'v';
  else if (parentName === 'HStack') axis = 'h';
  else
    axis =
      rects.length >= 2 && rects[1]!.top >= rects[0]!.bottom - 1 ? 'v' : 'h';
  // The parent stack element has real flex geometry even when its
  // children list is empty (CSS sizing, padding, min-height). Use
  // it for: (a) the N=0 fallback gap, and (b) extending bounds
  // along the stack axis so before-first/after-last gaps are
  // reachable from pointers outside the children's collective
  // extent.
  const parentBox = parentEl ? visibleBoxFor(parentEl) : null;
  const parentRect = parentBox ? parentBox.getBoundingClientRect() : null;
  const THICKNESS = 12;
  // Empty-array case: one full-extent gap at index 0 anchored to
  // the parent's flex container. Without this, an empty stack is
  // invisible to drop targeting.
  if (rects.length === 0) {
    if (!parentRect || (parentRect.width === 0 && parentRect.height === 0)) {
      return { target: null, invalidHover: false, distance: Infinity };
    }
    if (
      clientX < parentRect.left - THICKNESS ||
      clientX > parentRect.right + THICKNESS ||
      clientY < parentRect.top - THICKNESS ||
      clientY > parentRect.bottom + THICKNESS
    ) {
      return { target: null, invalidHover: false, distance: Infinity };
    }
    // Pointer is inside the parent's flex container; treat as
    // distance 0 (an empty stack's single gap is the whole stack
    // area).
    return {
      target: {
        kind: 'array-gap',
        rect: {
          left: parentRect.left,
          top: parentRect.top,
          width: parentRect.width,
          height: parentRect.height,
        },
        parentStart,
        parentEnd,
        parentName,
        slotName,
        slotType,
        insertionIndex: 0,
      },
      invalidHover: false,
      distance: 0,
    };
  }
  // N+1 gap rects: before each child + after the last.
  // Width / height orthogonal to the axis matches the child's
  // extent; thickness along the axis is the half-gap-tolerance
  // (12px) so adjacent strips don't overlap.
  let bestIndex = -1;
  let bestRect: { left: number; top: number; width: number; height: number } | null = null;
  let bestDist = Infinity;
  for (let i = 0; i <= rects.length; i++) {
    const gap = computeGapRect(rects, i, axis, THICKNESS);
    // Distance from pointer to the gap rect (0 if inside).
    const dx = Math.max(gap.left - clientX, 0, clientX - (gap.left + gap.width));
    const dy = Math.max(gap.top - clientY, 0, clientY - (gap.top + gap.height));
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
      bestRect = gap;
    }
  }
  // Containment test. Orthogonal to the stack axis: use the
  // children's collective extent ± THICKNESS. Along the stack
  // axis: use the parent layout's extent if available (so the
  // before-first / after-last gaps are reachable from above/
  // below the children's box), falling back to children extent ±
  // THICKNESS.
  const childBounds = boundsOfRects(rects);
  let minX = childBounds.left - THICKNESS;
  let maxX = childBounds.right + THICKNESS;
  let minY = childBounds.top - THICKNESS;
  let maxY = childBounds.bottom + THICKNESS;
  if (parentRect) {
    if (axis === 'v') {
      minY = Math.min(minY, parentRect.top);
      maxY = Math.max(maxY, parentRect.bottom);
    } else {
      minX = Math.min(minX, parentRect.left);
      maxX = Math.max(maxX, parentRect.right);
    }
  }
  if (clientX < minX || clientX > maxX || clientY < minY || clientY > maxY) {
    return { target: null, invalidHover: false, distance: Infinity };
  }
  if (bestIndex < 0 || !bestRect) {
    return { target: null, invalidHover: false, distance: Infinity };
  }
  return {
    target: {
      kind: 'array-gap',
      rect: bestRect,
      parentStart,
      parentEnd,
      parentName,
      slotName,
      slotType,
      insertionIndex: bestIndex,
    },
    invalidHover: false,
    distance: bestDist,
  };
}

// Compute the i-th gap rect among `rects` along `axis`.
// i ∈ [0, rects.length]:
//   - i = 0          → before the first child
//   - i = rects.length → after the last child
//   - otherwise      → between rects[i-1] and rects[i]
function computeGapRect(
  rects: DOMRect[],
  i: number,
  axis: 'v' | 'h',
  thickness: number,
): { left: number; top: number; width: number; height: number } {
  if (axis === 'v') {
    // Horizontal strip at a vertical gap.
    let centerY: number;
    if (i === 0) centerY = rects[0]!.top;
    else if (i === rects.length) centerY = rects[rects.length - 1]!.bottom;
    else centerY = (rects[i - 1]!.bottom + rects[i]!.top) / 2;
    // Span the union of the bracketing children's horizontal
    // extents so the strip aligns with the visible flow.
    const refIdx = i === rects.length ? rects.length - 1 : i;
    const r = rects[refIdx]!;
    return {
      left: r.left,
      top: centerY - thickness / 2,
      width: r.width,
      height: thickness,
    };
  }
  let centerX: number;
  if (i === 0) centerX = rects[0]!.left;
  else if (i === rects.length) centerX = rects[rects.length - 1]!.right;
  else centerX = (rects[i - 1]!.right + rects[i]!.left) / 2;
  const refIdx = i === rects.length ? rects.length - 1 : i;
  const r = rects[refIdx]!;
  return {
    left: centerX - thickness / 2,
    top: r.top,
    width: thickness,
    height: r.height,
  };
}

// Drill into a `display: contents` wrapper until we find an
// element that has actual layout (non-zero bounding rect). Used
// by hitTestArrayGap to locate the visible box for a shape-
// projection wrapper — display: contents wrappers report 0×0
// rects on Chrome / Firefox, so geometry tied to them is
// useless.
function visibleBoxFor(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  // Bounded walk — components are typically wrapped by at most
  // a couple of `display: contents` layers (shape-projection +
  // user component). Five hops is more than enough margin.
  for (let i = 0; i < 5 && cur; i++) {
    const rect = cur.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return cur;
    cur = cur.firstElementChild as HTMLElement | null;
  }
  return null;
}

function boundsOfRects(rects: DOMRect[]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.left < left) left = r.left;
    if (r.top < top) top = r.top;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return { left, top, right, bottom };
}

function getAdapter(componentName: string): ShapeAdapter | null {
  const loaded = components[componentName];
  if (!loaded) return null;
  return (loaded.canvas as ShapeAdapter | undefined) ?? null;
}

// Search entries for insertion commands. Derived once from
// the static registry — the entry list is stable for the
// session. Stable order = registry order = deck author's
// `index.tsx` import order, which is a deliberate placement they
// can shuffle to control toolbar order until categorization +
// search land in later steps.
const toolEntries: ToolEntry[] = Object.entries(components)
  .filter(([, loaded]) => loaded.meta.insertion !== undefined)
  .map(([name, loaded]) => ({
    id: name,
    label: name,
    description: loaded.meta.description,
    category: loaded.meta.category,
    gestures: loaded.meta.insertion!.gestures,
  }));

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
  onActiveSlideChange,
}: {
  host: Host;
  onActiveSlideChange?(index: number): void;
  // Optional source/notes pane alongside hierarchy in the bottom dock.
  // VS Code uses its native editor and leaves this slot empty.
  bottomExtra?:
    | ReactElement
    | ((projection: EditorPaneProjection) => ReactElement | null)
    | null;
}): ReactElement {
  const [state, setState] = useState<RenderState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => { onActiveSlideChange?.(activeIdx); }, [activeIdx, onActiveSlideChange]);
  // Slide-strip multi-selection. Invariant: always contains
  // `activeIdx`. The anchor pins the start of a shift-range so
  // successive shift-clicks extend from the same origin. Plain
  // click and cmd-toggle reset the anchor; keyboard nav resets
  // both the selection and the anchor to the new active idx.
  const [slideSelection, setSlideSelection] = useState<ReadonlyArray<number>>([0]);
  const [slideAnchor, setSlideAnchor] = useState<number>(0);
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
  const [richEditing, setRichEditing] = useState<TextEditorSnapshot | null>(null);
  const [textFormatting, setTextFormatting] = useState<TextFormattingState | null>(null);
  const [boxDraft, setBoxDraft] = useState<TextBoxDefaults>({});
  const boxDraftRef = useRef<TextBoxDefaults>({});
  const richSessionRef = useRef<TextSessionHandle | null>(null);
  // Set when the user dblclicks an empty text-slot placeholder.
  // The handler commits an empty `slotName: ""` fill, then queues
  // this baton so a follow-up effect (after the commit re-renders
  // and the new text-edit span exists in DOM) can dispatch the
  // text-edit gesture on it. Identity is `(parentStart, slotName)`
  // — parent.start is unchanged across the inside-body insertion.
  const pendingTextEditRef = useRef<{
    parentStart: number;
    slotName: string;
  } | null>(null);
  const [createPreview, setCreatePreview] = useState<CreatePreview | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [toolDrag, setToolDrag] = useState<ToolDragState | null>(null);
  const [gestureMeta, setGestureMeta] = useState<GestureMeta | null>(null);
  const [gestureLive, setGestureLive] = useState<GestureLive>(ZERO_LIVE);
  const [activeTool, setActiveTool] = useState<Tool>(SELECT_TOOL);
  // Selection is always an array. Single-select is length === 1.
  // Multi-select is bounded to one layout context (one Freeform).
  const [selected, setSelected] = useState<SelectionTarget[]>([]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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
  // (which our handler doesn't override since the source editor
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
  // Shapes map from the immediately-previous subscribe call.
  // Updated synchronously *inside* the subscribe handler so that
  // batched scrub previews (multiple subscribes in one React batch)
  // each see the correct old→new mapping — `stateRef.current` only
  // updates via useEffect after React commits, which during a
  // rapid drag lags behind.
  const lastShapesRef = useRef<ReadonlyMap<string, ShapeData> | undefined>(undefined);

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

  const startRichEditing = useCallback((target: TextDocumentEditTarget) => {
    const current = stateRef.current;
    if (!current) return;
    const parsed = parse(sourceRef.current, '<text-session>');
    if (parsed.diagnostics.some(d => d.severity === 'error')) return;
    const component = findComponentAtSpan(parsed.ast, target.span.start, target.span.end);
    if (!component || components[component.name]?.meta.slots.content?.type !== 'text-document') return;
    setEditing(null);
    setGestureMeta(null);
    setSelected([componentTarget(target.span)]);
    boxDraftRef.current = {}; setBoxDraft({});
    setRichEditing({ component, content: component.fills.find(f => f.name === 'content')?.value,
      source: sourceRef.current, slideIdx: activeIdxRef.current, scope: current.scope, colorTokens: current.colorTokens,
      clientX: target.clientX, clientY: target.clientY });
  }, []);

  const finishRichEditing = useCallback((snapshot: TextEditorSnapshot, intent: 'commit' | 'cancel', value: import('../runtime/ast.js').Value | undefined, changed: boolean) => {
    const defaults = boxDraftRef.current;
    boxDraftRef.current = {}; setBoxDraft({});
    richSessionRef.current = null;
    setRichEditing(null);
    if (intent !== 'commit' || (!changed && !Object.keys(defaults).length) || sourceRef.current !== snapshot.source) return;
    let selectionPaths: NonNullable<ReturnType<typeof pathToComponent>>[] = [];
    const result = commitSourceEdit(snapshot.source, '<text-session>', ast => {
      const comp = findComponentAtSpan(ast, snapshot.component.span.start.offset, snapshot.component.span.end.offset);
      if (!comp) return null;
      // Committing a departing draft must preserve the current canvas choice,
      // including an empty selection, rather than reselecting the edited box.
      selectionPaths = selectedRef.current.flatMap(target => {
        if (target.kind !== 'component') return [];
        const selectedComp = findComponentAtSpan(ast, target.span.start, target.span.end);
        const path = selectedComp ? pathToComponent(ast, selectedComp) : null;
        return path ? [path] : [];
      });
      if (value) {
        const fill = comp.fills.find(f => f.name === 'content');
        if (fill) fill.value = value; else comp.fills.push(slotFill('content', value));
      }
      for (const [field, setting] of Object.entries(defaults)) {
        const next = typeof setting === 'boolean' ? booleanLit(setting) : typeof setting === 'number' ? numberLit(setting) : field === 'color' && setting in snapshot.colorTokens ? nameRef(setting) : stringLit(setting);
        const fill = comp.fills.find(fill => fill.name === field);
        if (fill) fill.value = next; else comp.fills.push(slotFill(field, next));
      }
      return {};
    });
    if (!result) return;
    const nextAst = parse(result.newSource, '<text-selection>').ast;
    const restored = selectionPaths.flatMap(path => {
      const comp = componentByPath(nextAst, path);
      return comp ? [{ start: comp.span.start.offset, end: comp.span.end.offset }] : [];
    });
    commitToHost(result.newSource, restored);
  }, [commitToHost]);

  useEffect(() => {
    if (richEditing && richEditing.slideIdx !== activeIdx) {
      richSessionRef.current?.finish('cancel');
      setRichEditing(null);
    }
  }, [activeIdx, richEditing]);

  useEffect(() => {
    if (!richEditing || richEditing.slideIdx !== activeIdx) return;
    const span = richEditing.component.span;
    const ownsSelection = selected.some(target => target.kind === 'component' &&
      target.span.start === span.start.offset && target.span.end === span.end.offset);
    if (!ownsSelection) richSessionRef.current?.finish('commit');
  }, [selected, richEditing, activeIdx]);

  // Scrub session: a single drag on the inspector's numeric key
  // emits a stream of source previews on pointermove and one
  // committed result on pointerup. To keep the undo stack clean
  // (one entry per drag, not per frame), beginScrub captures the
  // pre-scrub source as the future undo target; previews call
  // setSource without touching the undo stack; endScrub pushes a
  // single undo entry containing the pre-scrub source iff the
  // final source actually differs.
  const scrubPreSourceRef = useRef<string | null>(null);
  const beginScrub = useCallback(() => {
    scrubPreSourceRef.current = sourceRef.current;
  }, []);
  const applyScrubPreview = useCallback(
    (preview: string) => {
      if (scrubPreSourceRef.current === null) return;
      internalSourceChangeRef.current = true;
      host.setSource?.(preview);
    },
    [host],
  );
  const endScrub = useCallback(
    (final: string | null) => {
      const pre = scrubPreSourceRef.current;
      if (pre === null) return;
      // IMPORTANT: keep `scrubPreSourceRef` set through the final
      // setSource. The subscribe handler reads it to decide
      // whether to clear selection on an internal source change;
      // clearing the ref before setSource would let the
      // round-trip's setSelected fire and unmount the inspector
      // row (which during scrub also held the locked pointer).
      // We clear it AFTER the host has been updated.
      if (final === null || final === pre) {
        // Cancellation or no-op. Make sure the host reflects pre.
        if (sourceRef.current !== pre) {
          internalSourceChangeRef.current = true;
          host.setSource?.(pre);
        }
        scrubPreSourceRef.current = null;
        return;
      }
      // Real change. One undo entry for the whole drag.
      undoStackRef.current.push({
        source: pre,
        slideIdx: activeIdxRef.current,
      });
      redoStackRef.current = [];
      internalSourceChangeRef.current = true;
      host.setSource?.(final);
      scrubPreSourceRef.current = null;
    },
    [host],
  );

  // Materialize an empty text slot: write `slotName: "<value>"` into
  // the parent component's body, then commit. The parent component
  // is preserved as the post-commit selection (the slot now exists
  // and a follow-up click can drill into it). Used by the empty-
  // slot inspector and (below) by the dblclick-on-empty-text-
  // placeholder gesture.
  //
  // Source spans aren't stable across the canonical-emitter round-
  // trip (the formatter rewrites whitespace), so we capture the
  // parent's structural path-from-root pre-commit and walk the same
  // path on the post-emit reparse to recover its new span.
  // Returns the parent's new SourceRange, or null on any failure.
  const materializeTextSlot = useCallback(
    (
      parentSpan: SourceRange,
      slotName: string,
      value: string,
    ): SourceRange | null => {
      const preParse = parse(sourceRef.current, '<materialize-slot-pre>');
      if (preParse.diagnostics.some((d) => d.severity === 'error')) return null;
      const oldParent = findComponentAtSpan(
        preParse.ast,
        parentSpan.start,
        parentSpan.end,
      );
      if (!oldParent) return null;
      const path = pathToComponent(preParse.ast, oldParent);
      if (!path) return null;
      // Mutate in place on the same AST, then emit + reparse to
      // recover the post-format span.
      if (!addStringSlotFill(oldParent, slotName, value)) return null;
      if (components[oldParent.name]?.meta.slots[slotName]?.type === 'text-document') {
        oldParent.fills.find((fill) => fill.name === slotName)!.value = paragraphDocument(value);
      }
      const newSource = emit(preParse.ast);
      const postParse = parse(newSource, '<materialize-slot-post>');
      if (postParse.diagnostics.some((d) => d.severity === 'error')) {
        // Post-emit parse failed — push the source through anyway
        // (the diagnostics panel will surface the issue) but skip
        // selection preservation since we can't locate the parent.
        commitToHost(newSource);
        return null;
      }
      const newParent = componentByPath(postParse.ast, path);
      if (!newParent) {
        commitToHost(newSource);
        return null;
      }
      const newParentRange: SourceRange = {
        start: newParent.span.start.offset,
        end: newParent.span.end.offset,
      };
      commitToHost(newSource, [newParentRange]);
      return newParentRange;
    },
    [commitToHost],
  );

  // Dblclick on empty text placeholder: materialize an empty fill
  // (so the source has a SlotFill with `""`), and queue a baton
  // that the post-commit effect (below) consumes to enter text-
  // edit mode on the freshly rendered span. Block / slide empty
  // slots aren't materialized via dblclick — that needs an
  // insertion picker (slot-targeted insertion gestures, deferred).
  const startEmptyTextSlotEdit = useCallback(
    (target: EmptyTextSlotEditTarget): void => {
      const { parentSpan, slotName } = target;
      // Materialize first so we can capture the parent's NEW span
      // (post-format). materializeTextSlot calls commitToHost
      // synchronously; the host.subscribe handler queues a setState
      // but the re-render hasn't happened yet, so we still have a
      // window to set pendingTextEditRef before the post-commit
      // useEffect fires.
      const newParentRange = materializeTextSlot(parentSpan, slotName, '');
      if (!newParentRange) return;
      pendingTextEditRef.current = {
        parentStart: newParentRange.start,
        slotName,
      };
    },
    [materializeTextSlot],
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
      // Source authority is synchronous: a pending blur/IME callback must
      // never commit a draft over an external replacement.
      if (!internalSourceChangeRef.current) {
        richSessionRef.current?.finish('cancel');
        setRichEditing(null);
      }
      sourceRef.current = source;
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
          scope,
          slides: result.slides,
          diagnostics: result.diagnostics,
          fileName,
          meta: { name: result.meta.name, subtitle: result.meta.subtitle },
          source,
          shapes: result.shapes,
          slidesData: result.slidesData,
          // Merge registry tokens with source-declared ones from
          // `Deck.tokens`. Registry entries get wrapped as
          // `var(--name)` here so all values in the map are ready-
          // to-use CSS color strings — the palette doesn't need to
          // know which origin each came from. Source-declared wins
          // on name collision, matching loader resolution order.
          colorTokens: {
            ...Object.fromEntries(
              Object.keys(staticTokens).map((n) => [n, `var(--${n})`]),
            ),
            ...result.tokens,
          },
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
        // do across undo / redo boundaries). Scrub previews are
        // also internal but require span-tracking — when a numeric
        // value crosses a digit-count boundary (e.g. 100 → 99) the
        // splice shortens the source by a char and every span past
        // the splice shifts. The selection target's pre-scrub span
        // would then miss the shape in `state.shapes`, the inspector
        // would fall through to the slide view, and the locked
        // key span would unmount mid-drag. Reuse the same
        // position-key lookup as external-edit reconciliation to
        // re-derive selection spans against the new AST.
        //
        // We read `lastShapesRef` (synchronously-tracked) rather
        // than `prevState.shapes` (stateRef-tracked via useEffect),
        // because rapid scrub previews can batch multiple subscribe
        // calls inside a single React commit cycle. stateRef would
        // be stale across all of them; lastShapesRef updates inline.
        const prevShapesForPreserve = lastShapesRef.current;
        lastShapesRef.current = result.shapes;
        if (scrubPreSourceRef.current === null) {
          setSelected(pending ?? []);
        } else {
          setSelected((prevSelected) =>
            preserveSelectionAcrossExternalEdit(
              prevSelected,
              prevShapesForPreserve,
              result.shapes,
            ),
          );
        }
        return;
      }
      // External edits: also keep lastShapesRef current so a later
      // scrub session starts from the right baseline.
      lastShapesRef.current = result.shapes;
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
  // Single-slide select: replaces selection with [idx] and resets
  // the shift-range anchor. Used by source-cursor sync, keyboard
  // nav, and number-key direct-select.
  const select = useCallback(
    (idx: number) => {
      if (total === 0) return;
      const clamped = Math.max(0, Math.min(total - 1, idx));
      setActiveIdx(clamped);
      setSlideSelection([clamped]);
      setSlideAnchor(clamped);
    },
    [total],
  );
  // Strip-click select with modifier semantics.
  //   plain: replace → [idx]; anchor = idx; active = idx
  //   shift: range from anchor to idx; active = idx; anchor stays
  //   meta:  toggle idx in selection; active = idx (added) or
  //          last remaining (removed); anchor = idx
  const stripSelect = useCallback(
    (idx: number, mods: SlideClickModifiers) => {
      if (total === 0) return;
      const clamped = Math.max(0, Math.min(total - 1, idx));
      if (mods.shift) {
        const lo = Math.min(slideAnchor, clamped);
        const hi = Math.max(slideAnchor, clamped);
        const range: number[] = [];
        for (let i = lo; i <= hi; i++) range.push(i);
        setSlideSelection(range);
        setActiveIdx(clamped);
        return;
      }
      if (mods.meta) {
        const has = slideSelection.includes(clamped);
        if (has) {
          const next = slideSelection.filter((n) => n !== clamped);
          if (next.length === 0) {
            // Last item — keep at least one selected. Re-add idx.
            setSlideSelection([clamped]);
            setActiveIdx(clamped);
            setSlideAnchor(clamped);
            return;
          }
          setSlideSelection(next);
          setActiveIdx(next[next.length - 1]!);
          setSlideAnchor(clamped);
          return;
        }
        setSlideSelection([...slideSelection, clamped]);
        setActiveIdx(clamped);
        setSlideAnchor(clamped);
        return;
      }
      // Plain click.
      setSlideSelection([clamped]);
      setActiveIdx(clamped);
      setSlideAnchor(clamped);
    },
    [total, slideAnchor, slideSelection],
  );

  // Append an empty `Slide {}` to the deck and activate it. The
  // loader will surface placeholders for label / notes / content
  // so the user can fill them via the inspector / toolbar.
  const handleAddSlide = useCallback(() => {
    const result = commitSourceEdit(sourceRef.current, '<add-slide>', (ast) => {
      const idx = appendEmptySlide(ast);
      if (idx < 0) return null;
      return {};
    });
    if (!result) return;
    commitToHost(result.newSource);
    // The new slide is at the end of the list. The host subscribe
    // round-trip will replace `state`; queue the activation so it
    // runs after the new state lands.
    queueMicrotask(() => {
      const next = stateRef.current;
      if (!next) return;
      const newIdx = next.slides.length - 1;
      if (newIdx < 0) return;
      setActiveIdx(newIdx);
      setSlideSelection([newIdx]);
      setSlideAnchor(newIdx);
    });
  }, [commitToHost]);

  // Delete a set of slides in one commit (single undo entry).
  // Active slide collapses to the nearest remaining slide.
  const handleDeleteSlides = useCallback(
    (indices: ReadonlyArray<number>) => {
      if (indices.length === 0) return;
      const result = commitSourceEdit(
        sourceRef.current,
        '<delete-slides>',
        (ast) => (removeSlidesAtIndices(ast, indices) > 0 ? {} : null),
      );
      if (!result) return;
      commitToHost(result.newSource);
      // Pick the new active: smallest index that wasn't deleted
      // and is ≤ current activeIdx; if everything ≤ activeIdx
      // was deleted, pick the smallest survivor.
      const dropped = new Set(indices);
      const survivors: number[] = [];
      for (let i = 0; i < total; i++) {
        if (!dropped.has(i)) survivors.push(i);
      }
      if (survivors.length === 0) {
        // Deck would be empty — bail out of the deletion. The
        // commit already happened; the next render will show 0
        // slides and the host's loader-level guards will catch
        // it. Reset selection to [0].
        setActiveIdx(0);
        setSlideSelection([0]);
        setSlideAnchor(0);
        return;
      }
      // Map: original-index → new-index for survivors.
      const indexMap = new Map<number, number>();
      survivors.forEach((origIdx, newIdx) => indexMap.set(origIdx, newIdx));
      let newActive = indexMap.get(activeIdxRef.current);
      if (newActive === undefined) {
        // Active was deleted. Prefer the slide that took its slot
        // (same new-index in the survivor list) — i.e., the next
        // slide after the deleted active. Fall back to the last
        // survivor when the active was at the tail.
        let chosen = -1;
        for (const origIdx of survivors) {
          if (origIdx >= activeIdxRef.current) {
            chosen = indexMap.get(origIdx)!;
            break;
          }
        }
        if (chosen < 0) chosen = survivors.length - 1;
        newActive = chosen;
      }
      setActiveIdx(newActive);
      setSlideSelection([newActive]);
      setSlideAnchor(newActive);
    },
    [commitToHost, total],
  );

  // Reorder: move the slides at `fromIndices` to `toIndex` of the
  // pre-move list, preserving their relative order. Selection
  // follows the moved set.
  const handleReorderSlides = useCallback(
    (fromIndices: ReadonlyArray<number>, toIndex: number) => {
      const projected = projectReorderedIndices(total, fromIndices, toIndex);
      if (!projected) return; // no-op (drop inside the moved range)
      const result = commitSourceEdit(
        sourceRef.current,
        '<reorder-slides>',
        (ast) => (reorderSlides(ast, fromIndices, toIndex) ? {} : null),
      );
      if (!result) return;
      commitToHost(result.newSource);
      // Update selection + active to the new positions of the
      // moved slides. Active = the slide that was active before
      // the move (if it was in the moved set), else its new index
      // after the move (which equals projection if it was moved,
      // or shifted accordingly if it stayed put).
      setSlideSelection(projected);
      // Find new index of the previously-active slide.
      const prevActive = activeIdxRef.current;
      const sortedFrom = Array.from(new Set(fromIndices))
        .filter((i) => i >= 0 && i < total)
        .sort((a, b) => a - b);
      const movedIdx = sortedFrom.indexOf(prevActive);
      let newActive: number;
      if (movedIdx >= 0) {
        newActive = projected[movedIdx]!;
      } else {
        // Not in moved set — adjust for the splice.
        let shift = 0;
        for (const i of sortedFrom) {
          if (i < prevActive) shift--;
        }
        let adjusted = prevActive + shift;
        // Account for insertion: count moved items inserted at or
        // before adjusted's new home.
        const insertAt = projected[0]!;
        if (adjusted >= insertAt) adjusted += projected.length;
        newActive = adjusted;
      }
      setActiveIdx(newActive);
      setSlideAnchor(newActive);
    },
    [commitToHost, total],
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
        (t.isContentEditable || t.closest('.sw-rich-text-editor, .sw-text-session-actions') || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
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

  // Pending text-edit baton drainer. Fires after every state
  // update; if the previous tick queued an empty-text-slot
  // materialization, the new tree now contains the freshly-
  // rendered text-edit span — find it via (parentStart, slotName)
  // and enter edit mode on it. parentStart is stable across the
  // inside-body insertion (only the parent's end shifts).
  //
  // The lookup is retried on the next animation frame if the
  // first attempt comes up empty — React commits before paint
  // and rAF queues for the next frame, so by then any deferred
  // child rendering (portals, layout-effect-driven children) has
  // also flushed. Without this retry, an unlucky scheduling can
  // leave pendingTextEditRef set with no further state change to
  // trigger another pass.
  useEffect(() => {
    const pending = pendingTextEditRef.current;
    if (!pending) return;

    const tryEnter = (): boolean => {
      const parentEl = document.querySelector(
        `.sw-canvas-stage [data-sw-component][data-sw-span-start="${pending.parentStart}"]`,
      );
      if (!(parentEl instanceof HTMLElement)) return false;
      const slotEl = parentEl.querySelector(
        `[data-sw-slot-name="${pending.slotName}"]:not([data-sw-slot-empty])`,
      );
      if (!(slotEl instanceof HTMLElement)) return false;
      const textSpan = slotEl.querySelector('[data-sw-text-span-start]');
      if (!(textSpan instanceof HTMLElement)) return false;
      const start = parseInt(
        textSpan.getAttribute('data-sw-text-span-start') ?? '',
        10,
      );
      const end = parseInt(
        textSpan.getAttribute('data-sw-text-span-end') ?? '',
        10,
      );
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      pendingTextEditRef.current = null;
      setEditing({ node: textSpan, start, end, originalText: '' });
      return true;
    };

    if (tryEnter()) return;
    const raf = requestAnimationFrame(() => {
      tryEnter();
    });
    return () => cancelAnimationFrame(raf);
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

    let dragged = false;
    const updateThreshold = (e: PointerEvent) => {
      dragged ||= crossesDragThreshold(e.clientX - pointerStartX, e.clientY - pointerStartY);
      return dragged;
    };
    const onMove = (e: PointerEvent) => {
      if (!updateThreshold(e)) return;
      const dx = (e.clientX - pointerStartX) / scale;
      const dy = (e.clientY - pointerStartY) / scale;
      setGestureLive({ dx, dy });
    };

    // Escape mid-gesture cancels: drop the gesture state without
    // committing, ignoring any pending pointerup. The pointerup
    // handler below checks `cancelled` so even if Escape fires
    // between pointerup's event-loop dispatch and its handler
    // running, the commit is skipped.
    let cancelled = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancelled = true;
      setGestureMeta(null);
      setGestureLive(ZERO_LIVE);
    };

    const onUp = (e: PointerEvent) => {
      if (cancelled) return;
      const dx = (e.clientX - pointerStartX) / scale;
      const dy = (e.clientY - pointerStartY) / scale;
      // Once movement crosses the screen-space threshold it remains a
      // drag, even if the pointer returns near its starting position.
      if (!updateThreshold(e)) {
        setGestureMeta(null);
        setGestureLive(ZERO_LIVE);
        return;
      }
      const result = commitSourceEdit(sourceRef.current, label, (ast) => {
        // Keep references to the selected authored nodes before adapters
        // mutate them. Structural paths follow these nodes through nested
        // containers and layout reorders when source offsets change.
        const selectionSpans = selected.flatMap(target => target.kind === 'component' ? [target.span] : []);
        const selectComponents = (selectionSpans.length ? selectionSpans : spans).flatMap(span => {
          const component = findComponentAtSpan(ast, span.start, span.end);
          return component ? [component] : [];
        });
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
        }
        if (!any) return null;
        return { selectComponents };
      });
      if (result) {
        commitToHost(result.newSource, result.newSelections);
      }
      setGestureMeta(null);
      setGestureLive(ZERO_LIVE);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    const onCancel = () => {
      cancelled = true;
      setGestureMeta(null);
      setGestureLive(ZERO_LIVE);
    };
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey);
    if (cursor) document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey);
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
    const { pointerStartX, pointerStartY, scale, designStartX, designStartY, tool, containerSpan } = createPreview;

    const onMove = (e: PointerEvent) => {
      const designCurrentX = (e.clientX - pointerStartX) / scale + designStartX;
      const designCurrentY = (e.clientY - pointerStartY) / scale + designStartY;
      setCreatePreview((prev) =>
        prev ? { ...prev, designCurrentX, designCurrentY } : null,
      );
    };

    let cancelled = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      cancelled = true;
      setCreatePreview(null);
      // Bounce back to Select so the user isn't left in an
      // armed-tool state after Escape.
      setActiveTool(SELECT_TOOL);
    };

    const onUp = (e: PointerEvent) => {
      if (cancelled) return;
      const designCurrentX = (e.clientX - pointerStartX) / scale + designStartX;
      const designCurrentY = (e.clientY - pointerStartY) / scale + designStartY;
      const result = commitSourceEdit(sourceRef.current, '<create>', (ast) => {
        const freeform = findComponentAtSpan(ast, containerSpan.start, containerSpan.end);
        if (freeform?.name !== 'Freeform') return null;
        // Minimum-drag threshold — clicks without meaningful drag
        // don't commit anything. Uniform across components since
        // both rect and line previews are degenerate below ~5px.
        const dx = designCurrentX - designStartX;
        const dy = designCurrentY - designStartY;
        if (Math.hypot(dx, dy) < 5) return null;
        const insertion = components[tool]?.meta.insertion;
        if (!insertion) return null;
        const left = Math.min(designStartX, designCurrentX);
        const top = Math.min(designStartY, designCurrentY);
        const width = Math.abs(designCurrentX - designStartX);
        const height = Math.abs(designCurrentY - designStartY);
        const node = insertion.stub({
          gesture: 'modal',
          // Draw into the Freeform under the pointer, in the same
          // coordinate system used by the preview.
          targetSlotType: 'array<block>',
          rect: { x: left, y: top, width, height },
          dragStart: { x: designStartX, y: designStartY },
          dragEnd: { x: designCurrentX, y: designCurrentY },
        });
        if (!node) return null;
        const inserted = insertIntoArraySlot(freeform, 'children', Number.MAX_SAFE_INTEGER, node)
          || materializeSlotFill(freeform, 'children', 'array<block>', node);
        if (!inserted) return null;
        return { selectComponents: [node] };
      });
      if (result) {
        commitToHost(result.newSource, result.newSelections);
        setActiveTool(SELECT_TOOL);
      }
      setCreatePreview(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey);
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [createPreview, host]);

  const chooseInsertTool = (tool: Tool) => {
    setToolDrag(null);
    const entry = components[tool];
    const insertion = entry?.meta.insertion;
    if (!insertion || insertion.gestures.includes('modal')) {
      setActiveTool(tool);
      return;
    }
    setActiveTool(SELECT_TOOL);
    const target = selected.length === 1 ? selected[0] : null;
    if (target?.kind === 'empty-slot' && entry.meta.produces && acceptsTargetSlot(entry.meta.produces, target.slotType)) {
      const result = commitSourceEdit(sourceRef.current, '<insert>', ast => {
        const parent = findComponentAtSpan(ast, target.parentSpan.start, target.parentSpan.end);
        const node = insertion.stub({ gesture: 'drag', targetSlotType: target.slotType });
        return parent && node && materializeSlotFill(parent, target.slotName, target.slotType, node) ? { selectComponents: [node] } : null;
      });
      if (result) { commitToHost(result.newSource, result.newSelections); return; }
    }
    setToolDrag({ tool, committed: true, pointerStartX: 0, pointerStartY: 0,
      pointerCurrentX: 0, pointerCurrentY: 0, target: null, invalidHover: false });
  };

  // ─── Tool-drag lifecycle (drag from toolbar onto a slot) ─────────
  //
  // Initialized by ToolPalette's pointerdown on a drag-mode entry.
  // Document-level pointermove resolves the hovered drop target;
  // pointerup commits (or silently cancels).
  const handleToolDragStart = useCallback(
    (tool: string, e: ReactPointerEvent) => {
      // Pointerdown on the toolbar button propagates up through
      // `.sw-canvas-stage` to the freeform's gesture handlers.
      // Stop it here so the drag from the toolbar doesn't also
      // kick off a marquee / create-rect. preventDefault keeps
      // text from getting selected during the threshold window
      // before the cursor effect installs `userSelect: 'none'`.
      e.stopPropagation();
      e.preventDefault();
      setToolDrag({
        tool,
        committed: false,
        pointerStartX: e.clientX,
        pointerStartY: e.clientY,
        pointerCurrentX: e.clientX,
        pointerCurrentY: e.clientY,
        target: null,
        invalidHover: false,
      });
    },
    [],
  );

  useEffect(() => {
    if (!toolDrag) return;
    const insertion = components[toolDrag.tool]?.meta.insertion;
    const produces = components[toolDrag.tool]?.meta.produces;
    if (!insertion || !produces) {
      setToolDrag(null);
      return;
    }

    // Keep pointer state synchronous, including moves React hasn't rendered
    // yet. Source writes must stay in event handlers: React may replay state
    // updaters during render, so committing from one repeats the host write.
    let current = toolDrag;
    let finished = false;
    const onMove = (e: PointerEvent) => {
      if (finished) return;
      const x = e.clientX;
      const y = e.clientY;
      const committed =
        current.committed ||
        Math.hypot(
          x - current.pointerStartX,
          y - current.pointerStartY,
        ) >= TOOL_DRAG_THRESHOLD;
      if (!committed) {
        current = { ...current, pointerCurrentX: x, pointerCurrentY: y };
      } else {
        const { target, invalidHover } = hitTestDropTarget(x, y, produces);
        current = {
          ...current,
          committed: true,
          pointerCurrentX: x,
          pointerCurrentY: y,
          target,
          invalidHover,
        };
      }
      setToolDrag(current);
    };

    const onCancel = () => {
      finished = true;
      setToolDrag(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onCancel();
    };

    const onUp = (event: PointerEvent) => {
      if (finished) return;
      finished = true;
      setToolDrag(null);
      if (!current.committed) return;
      const target = hitTestDropTarget(event.clientX, event.clientY, produces).target;
      if (!target) return;
      const result = commitSourceEdit(
        sourceRef.current,
        '<tool-drag>',
        (ast) => {
          const parent = findComponentAtSpan(
            ast,
            target.parentStart,
            target.parentEnd,
          );
          if (!parent) return null;
          const node = insertion.stub({
            gesture: 'drag',
            targetSlotType: target.slotType,
            insertionIndex:
              target.kind === 'array-gap'
                ? target.insertionIndex
                : undefined,
          });
          if (!node) return null;
          const ok =
            target.kind === 'empty-slot'
              ? materializeSlotFill(
                  parent,
                  target.slotName,
                  target.slotType,
                  node,
                )
              : insertIntoArraySlot(
                  parent,
                  target.slotName,
                  target.insertionIndex,
                  node,
                );
          if (!ok) return null;
          return { selectComponents: [node] };
        },
      );
      if (result) commitToHost(result.newSource, result.newSelections);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey);
    };
    // Effect re-installs when the tool itself changes; pointer
    // coords live in this effect and are published for the preview without
    // reinstalling listeners on each move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolDrag?.tool, host]);

  // Cursor / user-select feedback while a tool-drag is active.
  // Separate from the lifecycle effect above so the cursor updates
  // on every state change (committed flag flip, valid/invalid
  // target transitions) without reinstalling document listeners.
  useEffect(() => {
    if (!toolDrag || !toolDrag.committed) return;
    let cursor = 'grabbing';
    if (toolDrag.invalidHover) cursor = 'not-allowed';
    else if (toolDrag.target) cursor = 'copy';
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // Re-run on any target transition. For empty-slot targets
    // we'd ideally key on `target.el`, but the union also has
    // array-gap targets with no `el`; the broader `kind +
    // insertion index` shape covers every transition either
    // arm can take.
  }, [
    toolDrag?.committed,
    toolDrag?.invalidHover,
    toolDrag?.target?.kind,
    toolDrag?.target?.parentStart,
    toolDrag?.target?.slotName,
    toolDrag?.target?.kind === 'array-gap'
      ? toolDrag.target.insertionIndex
      : undefined,
  ]);

  // ─── Marquee selection ──────────────────────────────────────────
  //
  // Pointerdown on empty Freeform space → marquee. setState per
  // pointermove drives the marquee and live selection. Always derive
  // selection from the gesture-start snapshot so shrinking a Shift
  // marquee removes preview hits without losing the original selection.
  useEffect(() => {
    if (!marquee) return;
    const { pointerStartX, pointerStartY, scale, designStartX, designStartY, shift, initialSelection } = marquee;

    let dragged = false;
    const updateSelection = (e: PointerEvent) => {
      dragged ||= crossesDragThreshold(e.clientX - pointerStartX, e.clientY - pointerStartY);
      const designCurrentX = (e.clientX - pointerStartX) / scale + designStartX;
      const designCurrentY = (e.clientY - pointerStartY) / scale + designStartY;
      // Click without meaningful drag — clear, or preserve with Shift.
      if (!dragged) {
        setSelected(shift ? initialSelection : []);
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
          const wrapper = document.querySelector(`.sw-canvas-stage [data-sw-span-start="${data.comp.span.start.offset}"][data-sw-span-end="${data.comp.span.end.offset}"]`);
          if (!wrapper || findPortalAncestor(wrapper) !== marquee.freeformDiv) continue;
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
      const next = shift ? [...initialSelection] : intersected;
      if (shift) {
        for (const target of intersected) {
          if (findTargetIndex(initialSelection, target) === -1) next.push(target);
        }
      }
      setSelected((current) =>
        current.length === next.length &&
        current.every((target, index) => selectionTargetsEqual(target, next[index]!))
          ? current
          : next,
      );
    };

    const onMove = (e: PointerEvent) => {
      updateSelection(e);
      if (!dragged) return;
      const designCurrentX = (e.clientX - pointerStartX) / scale + designStartX;
      const designCurrentY = (e.clientY - pointerStartY) / scale + designStartY;
      setMarquee((prev) =>
        prev ? { ...prev, designCurrentX, designCurrentY } : null,
      );
    };

    let cancelled = false;
    const onCancel = () => {
      cancelled = true;
      setSelected(initialSelection);
      setMarquee(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Consume the cancel before the window-level selection-clear handler.
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    const onUp = (e: PointerEvent) => {
      if (cancelled) return;
      updateSelection(e);
      setMarquee(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey);
    };
  }, [marquee]);

  // ─── Keyboard: Escape, Delete / Backspace, Cmd-Z / Cmd-Shift-Z ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || t.closest('.sw-rich-text-editor, .sw-text-session-actions') || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
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
        // source editor's recent edits (especially after a
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
        // If a gesture is in flight, the per-gesture effect's own
        // Escape handler owns the cancel — don't also clear
        // selection / reset tool here. Lets the user re-try the
        // gesture without re-selecting first.
        if (gestureMeta || createPreview || marquee || toolDrag) return;
        if (activeTool !== SELECT_TOOL) setActiveTool(SELECT_TOOL);
        if (selected.length > 0) setSelected([]);
        e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Canvas selection owns deletion even if a previously
        // clicked thumbnail still has keyboard focus.
        if (selected.length > 0) {
          const targets = selected;
          const result = commitSourceEdit(
            sourceRef.current,
            '<delete>',
            (ast) => {
              let any = false;
              for (const target of targets) {
                // Slot targets aren't deletable as components —
                // clear-slot semantics is a separate gesture
                // (deferred). Skip for now; only component
                // selections are deleted.
                if (target.kind !== 'component') continue;
                if (removeShapeAtSpan(ast, target.span)) any = true;
              }
              return any ? {} : null;
            },
          );
          if (result) {
            commitToHost(result.newSource);
            setSelected([]);
          }
          e.preventDefault();
          return;
        }
        // Without a canvas selection, delete the active slide.
        // Preserve bulk slide deletion when focus is in the strip.
        const focused = document.activeElement as HTMLElement | null;
        const onStrip = focused?.closest('.sw-thumb') != null;
        handleDeleteSlides(onStrip && slideSelection.length > 0
          ? slideSelection
          : [activeIdxRef.current]);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeTool,
    selected,
    host,
    gestureMeta,
    createPreview,
    marquee,
    toolDrag,
    slideSelection,
    handleDeleteSlides,
  ]);

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

  // Per-slide color swatches for the inspector palette. Computed
  // here (rather than after the `if (!state) return …` early exit
  // below) so hook order stays stable across initial-load and
  // ready renders — react warns about rendering more hooks on
  // later renders than earlier ones. Guards on `state` internally.
  const slideColors = useMemo(
    () => {
      const slide = state?.slidesData[activeIdx];
      const tokens = state?.colorTokens ?? {};
      return slide ? collectSlideColors(slide.comp, components, tokens) : [];
    },
    [state, activeIdx],
  );

  // The standalone source surface consumes source-backed projections of
  // this state. Keep the host's full source authoritative; the editor
  // receives only the ranges/value it needs to present its current mode.
  const editorProjection = useMemo<EditorPaneProjection>(() => {
    const slide = state?.slidesData[activeIdx];
    const activeSlide = slide
      ? {
          start: slide.comp.span.start.offset,
          end: slide.comp.span.end.offset,
        }
      : null;
    const notesFill = slide?.comp.fills.find((fill) => fill.name === 'notes');
    const notesValue = notesFill?.value;
    const notes = notesValue?.kind === 'string'
      ? {
          sourceRange: {
            start: notesValue.span.start.offset,
            end: notesValue.span.end.offset,
          },
          value: notesValue.value,
          multiline: notesValue.multiline,
        }
      : null;
    return {
      activeSlide,
      activeSlideIndex: activeSlide ? activeIdx : 0,
      totalSlides: state?.slidesData.length ?? 0,
      notes,
    };
  }, [state, activeIdx]);

  const renderedBottomExtra = typeof bottomExtra === 'function'
    ? bottomExtra(editorProjection)
    : bottomExtra;

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
  const boxShape = selectedShape?.comp.name === 'TextBox' ? selectedShape : singleTarget && (singleTarget.kind === 'slot' || singleTarget.kind === 'empty-slot')
    ? findShapeForRange(state.shapes, singleTarget.parentSpan) : null;
  const applyBoxSetting = (field: TextBoxDefault, setting: string | number | boolean) => {
    if (richEditing) {
      boxDraftRef.current = { ...boxDraftRef.current, [field]: setting };
      setBoxDraft(boxDraftRef.current);
      return;
    }
    if (boxShape?.comp.name !== 'TextBox') return;
    let path: ReturnType<typeof pathToComponent> = null;
    const result = commitSourceEdit(sourceRef.current, '<text-box-setting>', ast => {
      const comp = findComponentAtSpan(ast, boxShape.comp.span.start.offset, boxShape.comp.span.end.offset);
      if (!comp) return null;
      path = pathToComponent(ast, comp);
      const next = typeof setting === 'boolean' ? booleanLit(setting) : typeof setting === 'number' ? numberLit(setting) : field === 'color' && setting in state.colorTokens ? nameRef(setting) : stringLit(setting);
      const fill = comp.fills.find(fill => fill.name === field);
      if (fill) fill.value = next; else comp.fills.push(slotFill(field, next));
      return {};
    });
    if (!result) return;
    const restored = path ? componentByPath(parse(result.newSource, '<box-selection>').ast, path) : null;
    commitToHost(result.newSource, restored ? [{ start: restored.span.start.offset, end: restored.span.end.offset }] : undefined);
  };
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
  const emptySlotInfo: EmptySlotInfo | null = (() => {
    if (!singleTarget || singleTarget.kind !== 'empty-slot') return null;
    const parentShape = findShapeForRange(state.shapes, singleTarget.parentSpan);
    if (!parentShape) return null;
    return {
      slotName: singleTarget.slotName,
      slotType: singleTarget.slotType,
      parentShape,
    };
  })();
  // Active slide's AST + meta. Powers the hierarchy slide row and
  // the property panel's slide-selected / default-no-selection
  // views. Null when the deck has no slides (e.g., empty source).
  const activeSlide: SlideAstData | null =
    state.slidesData[activeIdx] ?? null;

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
      <ToolPalette
        placing={!!toolDrag?.committed}
        tools={toolEntries}
        onSelect={chooseInsertTool}
        onDragStart={handleToolDragStart}
      />
      <div className="sw-authoring-workspace">
        <div className="sw-main-workspace">
          <div className="sw-canvas-body">
            <SlideStrip
              slides={state.slides}
              activeIdx={activeIdx}
              selection={slideSelection}
              onSelect={stripSelect}
              onAddSlide={handleAddSlide}
              onReorder={handleReorderSlides}
              width={stripWidth}
            />
            <ResizeHandle
              size={stripWidth}
              setSize={setStripWidth}
              min={STRIP_WIDTH_MIN}
              max={STRIP_WIDTH_MAX}
            />
            {preparedSlide ? (
              <div className="sw-canvas-stage" onPointerDownCapture={event => { if (toolDrag) event.stopPropagation(); }}>
                {activeTool !== SELECT_TOOL && !toolDrag?.committed && <div className="sw-placement-hint sw-tool-status" role="status">Draw {activeTool} · Esc to cancel</div>}
                {toolDrag?.committed && <div className="sw-placement-hint" role="status">Click a compatible slot or gap to insert {toolDrag.tool} · Esc to cancel</div>}
                <TextDocumentSessionContext.Provider value={richEditing ? {
                  span: { start: richEditing.component.span.start.offset, end: richEditing.component.span.end.offset },
                  defaults: { ...boxDraft, ...(typeof boxDraft.color === 'string' ? { color: richEditing.colorTokens[boxDraft.color] ?? boxDraft.color } : {}) },
                  editor: <RichTextEditor snapshot={richEditing} registry={components}
                    onFormatting={setTextFormatting}
                    onReady={handle => { richSessionRef.current = handle; if (!handle) setTextFormatting(null); }}
                    onFinish={(intent, value, changed) => finishRichEditing(richEditing, intent, value, changed)} />,
                } : null}>
                <GestureProvider deltas={gestureDeltas}>
                  <ScaledCanvas
                    selectableSpans={selectableSpans}
                    currentSelection={selected}
                    onSelectRange={(range: SourceRange) => host.sendSelection(range)}
                    onTextEdit={(target) => setEditing(target)}
                    onTextDocumentEdit={startRichEditing}
                    onEmptyTextSlotEdit={startEmptyTextSlotEdit}
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
                        initialSelection: selected,
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
                    key={`selection-${activeIdx}`}
                    selected={selected}
                    shapes={state.shapes}
                    gestureDeltas={gestureDeltas}
                    renderHandles={activeTool === SELECT_TOOL && !gestureMeta && !marquee && !richEditing && !editing}
                    startGesture={startGesture}
                  />
                  <GestureOverlayLayer
                    key={`gesture-${activeIdx}`}
                    activeSpans={gestureMeta?.spans ?? EMPTY_SPANS}
                    shapes={state.shapes}
                    gestureDeltas={gestureDeltas}
                  />
                  <MarqueePreviewOverlay marquee={marquee} />
                  <CreatePreviewOverlay createPreview={createPreview} />
                  <ToolDragOverlay toolDrag={toolDrag} />
                </GestureProvider>
                </TextDocumentSessionContext.Provider>
              </div>
            ) : null}
          </div>
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
              style={{ width: renderedBottomExtra ? hierarchyWidth : '100%' }}
            >
              <HierarchyPanel
                shapes={state.shapes}
                activeIdx={activeIdx}
                activeSlide={activeSlide}
                selected={selected}
                onSelect={(target, modifiers) =>
                  applySelectionClick(target, modifiers, setSelected)
                }
                onJumpToSource={(range) => host.sendSelection(range)}
              />
            </div>
            {renderedBottomExtra && <ResizeHandle
              axis="x"
              size={hierarchyWidth}
              setSize={setHierarchyWidth}
              min={HIERARCHY_WIDTH_MIN}
              max={HIERARCHY_WIDTH_MAX}
            />}
            {renderedBottomExtra && <div className="sw-bottom-col sw-bottom-col-flex">
              {renderedBottomExtra}
            </div>}
          </div>
        </div>
        <ResizeHandle axis="x" invert size={propertiesWidth} setSize={setPropertiesWidth} min={PROPERTIES_WIDTH_MIN} max={PROPERTIES_WIDTH_MAX} />
        <aside className="sw-properties-sidebar" aria-label="Element properties" style={{ width: propertiesWidth }}>
          <GroupingControls selected={selected} shapes={state.shapes} disabled={!!richEditing || !!gestureMeta || !!createPreview || !!marquee || !!toolDrag} onCommit={commitToHost} source={state.source} />
          <AlignmentControls selected={selected} shapes={state.shapes} disabled={!!richEditing} onCommit={commitToHost} source={state.source} />
          <PropertiesPanel
            componentShape={selectedShape}
            slotInfo={slotInfo}
            emptySlotInfo={emptySlotInfo}
            activeSlide={activeSlide}
            multiCount={selected.length}
            source={state.source}
            onCommit={(newSource, newSelections) =>
              commitToHost(newSource, newSelections)
            }
            onScrubBegin={beginScrub}
            onScrubPreview={applyScrubPreview}
            onScrubEnd={endScrub}
            onMaterializeTextSlot={materializeTextSlot}
            onSelectComponent={(range) =>
              setSelected([componentTarget(range)])
            }
            onRemoveListItem={(range) => {
              const preSource = sourceRef.current;
              const result = commitSourceEdit(
                preSource,
                '<remove-list-item>',
                (ast) =>
                  removeListItemAtSpan(ast, range, 'any-kind')
                    ? {}
                    : null,
              );
              if (!result) return;
              // Preserve any selected component(s) by shifting
              // their spans relative to the edit. Inspector
              // changes should keep the parent selected — the
              // user is still working on it.
              const delta = result.newSource.length - preSource.length;
              const preserved: SourceRange[] = [];
              for (const t of selected) {
                if (t.kind !== 'component') continue;
                const s = t.span;
                if (s.end <= range.start) {
                  preserved.push({ start: s.start, end: s.end });
                } else if (s.start <= range.start && s.end >= range.end) {
                  preserved.push({
                    start: s.start,
                    end: s.end + delta,
                  });
                } else if (s.start >= range.end) {
                  preserved.push({
                    start: s.start + delta,
                    end: s.end + delta,
                  });
                }
                // selection straddling the edit gets dropped
              }
              commitToHost(
                result.newSource,
                preserved.length > 0 ? preserved : undefined,
              );
            }}
            shapes={state.shapes}
            colorTokens={state.colorTokens}
            slideColors={slideColors}
          />
          {(richEditing || boxShape?.comp.name === 'TextBox') && <div className="sw-text-session-actions" onKeyDown={event => event.stopPropagation()}
            onBlur={event => commitOnTextBlur(event.relatedTarget, () => richSessionRef.current?.finish('commit'))}>
            <BoxSettings onApply={applyBoxSetting} current={{ ...boxShape?.params, ...boxDraft }} />
            {richEditing && <>
            <FormattingToolbar session={richSessionRef} state={textFormatting} colorTokens={state.colorTokens} slideColors={slideColors} />
            <span>Editing text</span>
            <button type="button" onPointerDown={event => { if (!(document.activeElement instanceof HTMLInputElement)) event.preventDefault(); }} onClick={() => richSessionRef.current?.finish('commit')}>Done</button>
            <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => richSessionRef.current?.finish('cancel')}>Cancel</button>
            </>}
          </div>}
        </aside>
      </div>
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
    // Slide-target identity is "the active slide" — no span — so it
    // survives external edits unchanged. Slot-target preservation
    // is deferred (would need to re-derive the post-emit SlotFill
    // span); drop those for now.
    if (target.kind === 'slide') {
      out.push(target);
      continue;
    }
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
  if (activeTool === SELECT_TOOL) return;
  const insertion = components[activeTool]?.meta.insertion;
  // No insertion contract → no create gesture. Should be unreachable
  // (the toolbar only surfaces entries that opted in), but guard
  // anyway so a stale `activeTool` from a removed component doesn't
  // throw.
  if (!insertion) return;
  setCreatePreview({
    tool: activeTool,
    previewShape: insertion.modalPreview ?? 'rect',
    freeformDiv: target.containerEl,
    containerSpan: target.containerSpan,
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
  if (createPreview.previewShape === 'line') {
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

// ─── Tool-drag drop-target outline (portaled to body) ────────────
//
// Active while a drag-mode toolbar entry is being dragged AND the
// pointer is over a valid empty-slot placeholder. Positions an
// outline div over the placeholder's bounding rect with a label.
// Portaled to document.body (rather than the freeform) because
// drop targets may live in any positioned ancestor; body is the
// stable root.

function ToolDragOverlay({
  toolDrag,
}: {
  toolDrag: ToolDragState | null;
}): ReactNode {
  if (!toolDrag || !toolDrag.committed || !toolDrag.target) return null;
  const target = toolDrag.target;
  const rect =
    target.kind === 'empty-slot'
      ? target.el.getBoundingClientRect()
      : target.rect;
  const { parentName, slotName } = target;
  const baseLabel = parentName ? `${parentName}.${slotName}` : slotName;
  // For array-gap targets, surface the position so users can
  // tell "insert at index 2" from "insert at index 3" without
  // counting children manually.
  const label =
    target.kind === 'array-gap'
      ? `${baseLabel} (insert at #${target.insertionIndex})`
      : `Drop into ${baseLabel}`;
  return createPortal(
    <div
      className={
        'sw-drop-target-overlay' +
        (target.kind === 'array-gap' ? ' sw-drop-target-gap' : '')
      }
      style={{
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    >
      <span className="sw-drop-target-label">{label}</span>
    </div>,
    document.body,
  );
}
