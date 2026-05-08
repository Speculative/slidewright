// Slidewright canvas — ScaledCanvas.
//
// A 1920x1080 design surface scaled to fit the available viewport via a
// CSS transform. ResizeObserver-driven so the canvas re-fits as the
// container resizes. Mirrors src/Presentation.jsx's geometry without
// the rest of its concerns (popout notes, localStorage, document title,
// keyboard nav).
//
// Slide-prop preparation (active, actLabel) is App's responsibility
// (slidewright/canvas/App.tsx) — ScaledCanvas just scales whatever
// React node it's given.
//
// Selection-sync (v0.1e): clicks anywhere in the rendered slide bubble
// up to .presentation; we walk to the nearest [data-sw-span-start]
// ancestor (placed by loader.ts/wrapWithSpan around each component
// invocation) and forward the source range to the host.

import { useLayoutEffect, useRef, useState } from 'react';
import type {
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from 'react';

import type { SlotType } from '../runtime/contract.js';
import type { SourceRange } from './host.js';
import {
  findTargetIndex,
  type SelectionTarget,
} from './selection-target.js';

const DESIGN_W = 1920;
const DESIGN_H = 1080;
// Visual margin between the slide and the panel edges. The slide
// shrinks to fit (clientWidth - 2*MARGIN); existing flex centering on
// .presentation puts the result in the middle of the surrounding white
// space, so the margin shows as a uniform gutter.
const MARGIN = 16;

export interface TextEditTarget {
  // The DOM node we'll make contentEditable. Editing happens in-place
  // on the styled element itself so font, color, and the surrounding
  // CSS transform all carry over for free — no overlay needed.
  node: HTMLElement;
  start: number;
  end: number;
  originalText: string;
}

export interface DragStart {
  // The DOM node being dragged (the loader-wrapped data-sw-component
  // div for a positioned shape). Used by the drag handler to apply
  // imperative style updates during the gesture.
  node: HTMLElement;
  start: number;        // AST source span start
  end: number;          // AST source span end
  pointerStartX: number;
  pointerStartY: number;
  scale: number;        // canvas scale at drag start (constant during gesture)
}

export interface CreateStart {
  // The container element new shapes will land inside (in v0.2.f the
  // Freeform's rendered div). Coordinates are design-space pixels
  // *relative to this container*, not the outer 1920x1080 canvas —
  // the Freeform sits inside .slide-inner which has padding from
  // styles.css, so canvas coords would be offset from the actual
  // Freeform origin.
  //
  // The handler is expected to append the preview overlay to this
  // element (so both the preview and the final Box render in the
  // same coordinate system), and to use the same coord system when
  // emitting source.
  containerEl: HTMLElement;
  pointerStartX: number;
  pointerStartY: number;
  designStartX: number;
  designStartY: number;
  scale: number;
}

// Marquee-selection gesture (v0.2.j). Pointerdown on empty
// Freeform space in select mode kicks one off. Same coordinate
// rules as CreateStart — design-space pixels are *relative to the
// Freeform's positioned div*, not the outer canvas.
export interface MarqueeStart {
  freeformDiv: HTMLElement;
  pointerStartX: number;
  pointerStartY: number;
  designStartX: number;
  designStartY: number;
  scale: number;
  shift: boolean;
}

// Layout-intercept gesture (v0.4 reorder). Pointerdown on a
// component whose immediate parent is another component opens this
// dispatch path: the host looks up the parent's adapter and asks
// `interceptChildDrag(childSpan, event)`. If the layout takes
// ownership (returns non-null init), the host dispatches a layout-
// owned opaque gesture and returns true; ScaledCanvas then skips
// body-drag. Returning false falls through to existing dispatch.
export interface ChildDragStart {
  childSpan: SourceRange;
  parentSpan: SourceRange;
  // The parent component's wrapper element (the loader's
  // display:contents div). Adapter uses this to enumerate its
  // children's DOM rects at gesture start.
  parentEl: HTMLElement;
  pointerStartX: number;
  pointerStartY: number;
  scale: number;
  event: PointerEvent;
}

// Empty-text-slot dblclick target. The handler should materialize a
// SlotFill for the slot and enter text-edit mode on the new span
// once it renders. ScaledCanvas can't do the materialization itself
// (it has no access to source / commit pipeline) so the work happens
// host-side.
export interface EmptyTextSlotEditTarget {
  parentSpan: SourceRange;
  slotName: string;
}

interface Props {
  children: ReactNode;
  onSelectRange?: (range: SourceRange) => void;
  onTextEdit?: (target: TextEditTarget) => void;
  // Fired when the user double-clicks an empty *text* slot
  // placeholder. Routes to a "materialize + enter edit" pipeline
  // App-side. Other slot types (block, slide) currently fall
  // through to selection-only on dblclick — insertion is the next
  // milestone.
  onEmptyTextSlotEdit?: (target: EmptyTextSlotEditTarget) => void;
  // Fired when pointer goes down on a positioned shape (currently
  // anything matching [data-sw-component="Box"], future shape
  // primitives will share this dispatch). The handler is responsible
  // for the rest of the gesture lifecycle — pointermove / pointerup
  // listeners are typically attached to document.
  onDragStart?: (target: DragStart) => void;
  // Fired when pointer goes down anywhere on the canvas while a
  // creation tool is active (activeTool !== 'select'). Same gesture
  // lifecycle — handler attaches its own move/up listeners.
  onCreateStart?: (target: CreateStart) => void;
  // Fired when pointer goes down in Select mode. Argument is the
  // resolved selection target (or null if the click landed on
  // canvas background — clear selection there) plus modifier
  // state. ScaledCanvas resolves the target via its drill rule
  // (chain-walk, drill on consecutive clicks); the host just
  // applies replace / toggle / keep based on modifiers.
  onSelectShape?: (
    target: SelectionTarget | null,
    modifiers: { shift: boolean },
  ) => void;
  // Current selection state — used for the drill comparison.
  // Each click compares the click's chain to this; if any current
  // entry is in the chain, drill to next-inner. Otherwise reset
  // to chain's outermost.
  currentSelection: ReadonlyArray<SelectionTarget>;
  // Fired when pointer goes down on empty Freeform space in select
  // mode (v0.2.j). The handler renders a marquee preview during
  // pointermove and, on release, sets selection to all shapes
  // intersecting the rectangle.
  onMarqueeStart?: (target: MarqueeStart) => void;
  // Map keyed by `${start}-${end}` span identifying selectable
  // components (those with a `canvas` export — the loader
  // populates the shapes registry from this). The pointerdown
  // handler walks up the DOM from event.target and selects the
  // innermost component whose span is in this map. Map (rather
  // than Set) so we accept the shapes registry directly without
  // an extra wrapping step.
  selectableSpans: ReadonlyMap<string, unknown>;
  // Fired when pointer goes down on a component whose immediate
  // parent is also a component (v0.4 reorder). The handler looks
  // up the parent's adapter; if it's a LayoutAdapter with
  // `interceptChildDrag` and the call returns non-null init, the
  // handler dispatches a layout-owned opaque gesture and returns
  // true. ScaledCanvas then skips body-drag. Returning false
  // falls through to existing dispatch.
  onChildDragStart?: (target: ChildDragStart) => boolean;
  activeTool?: 'select' | 'box' | 'textbox' | 'arrow';
}

// Components whose drag-to-move gesture is supported. Box and
// TextBox use `x`/`y` slot fills with width/height; Arrow uses
// `x1/y1/x2/y2` and gets translated by App's drag effect by
// applying the same delta to both endpoints. Endpoint handles
// (resize one endpoint at a time) live on the selection overlay
// and dispatch their own gesture, separately from this body-drag.
const DRAGGABLE_SELECTOR =
  '[data-sw-component="Box"], [data-sw-component="TextBox"], [data-sw-component="Arrow"]';

// Walk up from `target` collecting the alternating component /
// slot chain — outermost-first. Components are included if their
// span is in `selectableSpans` (they have a `canvas` export and
// the loader registered them). Slots are included whenever a
// `data-sw-slot-name` wrapper appears on the path.
//
// Drilling: each successive click without modifiers drills one
// level inward through this chain. The first click resolves to
// the chain's outermost; if the current selection is in the
// chain, the dispatch picks the next-deeper element. Clicking
// outside any selectable produces an empty chain (clear-selection).
function buildSelectableChain(
  target: Element,
  selectableSpans: ReadonlyMap<string, unknown>,
): SelectionTarget[] {
  const chain: SelectionTarget[] = [];
  let el: Element | null = target;
  while (el) {
    if (el instanceof HTMLElement) {
      // Slot wrapper? data-sw-slot-name present means this is a
      // slot-fill container the loader stamped.
      const slotName = el.getAttribute('data-sw-slot-name');
      if (slotName !== null) {
        const isEmpty = el.getAttribute('data-sw-slot-empty') === 'true';
        if (isEmpty) {
          // Empty slot — identity is (parentSpan, slotName); the
          // parent's span attrs are stamped on the placeholder
          // wrapper directly (no need to walk to a parent
          // component, since we may be inside one of its inner
          // wrappers and the data is right here). Slot type lets
          // the dblclick handler route by type.
          const pStart = el.getAttribute('data-sw-slot-parent-start');
          const pEnd = el.getAttribute('data-sw-slot-parent-end');
          const slotType = el.getAttribute('data-sw-slot-type');
          if (
            pStart &&
            pEnd &&
            slotType &&
            selectableSpans.has(`${pStart}-${pEnd}`)
          ) {
            chain.push({
              kind: 'empty-slot',
              parentSpan: {
                start: parseInt(pStart, 10),
                end: parseInt(pEnd, 10),
              },
              slotName,
              slotType: slotType as SlotType,
            });
          }
        } else {
          const slotStart = el.getAttribute('data-sw-slot-span-start');
          const slotEnd = el.getAttribute('data-sw-slot-span-end');
          // Find the slot's parent component (the next ancestor
          // carrying data-sw-component). Only include the slot if
          // the parent is itself selectable — slots on non-
          // selectable parents (like Freeform's children) aren't
          // meaningful drill targets.
          const parentComp = el.parentElement?.closest('[data-sw-component]');
          if (
            slotStart &&
            slotEnd &&
            parentComp instanceof HTMLElement
          ) {
            const pStart = parentComp.getAttribute('data-sw-span-start');
            const pEnd = parentComp.getAttribute('data-sw-span-end');
            if (
              pStart &&
              pEnd &&
              selectableSpans.has(`${pStart}-${pEnd}`)
            ) {
              chain.push({
                kind: 'slot',
                span: {
                  start: parseInt(slotStart, 10),
                  end: parseInt(slotEnd, 10),
                },
                parentSpan: {
                  start: parseInt(pStart, 10),
                  end: parseInt(pEnd, 10),
                },
                slotName,
              });
            }
          }
        }
      } else if (el.hasAttribute('data-sw-component')) {
        const start = el.getAttribute('data-sw-span-start');
        const end = el.getAttribute('data-sw-span-end');
        if (start && end && selectableSpans.has(`${start}-${end}`)) {
          chain.push({
            kind: 'component',
            span: {
              start: parseInt(start, 10),
              end: parseInt(end, 10),
            },
          });
        }
      }
    }
    el = el.parentElement;
  }
  // Walked innermost-first; reverse so chain[0] is the outermost.
  return chain.reverse();
}

// Resolve a click against a selectable chain to the next selection
// target. Drill rule: if any current selection is in the chain,
// pick the deepest matching index + 1 (drill one level). Otherwise
// pick the outermost (chain[0]). Empty chain → null (clear).
function drillSelection(
  chain: SelectionTarget[],
  current: ReadonlyArray<SelectionTarget>,
): SelectionTarget | null {
  if (chain.length === 0) return null;
  let drillIdx = -1;
  for (const sel of current) {
    const idx = findTargetIndex(chain, sel);
    if (idx > drillIdx) drillIdx = idx;
  }
  if (drillIdx === -1) return chain[0]!;
  // Drill one further; cap at deepest if at the end already.
  return chain[drillIdx + 1] ?? chain[drillIdx]!;
}

// Innermost component target in a chain — last component, ignoring
// any trailing slot. Used for double-click selection: double-click
// snaps directly to "the thing under the cursor" rather than
// drilling one level. Returns null if the chain has no components
// (slots-only chains shouldn't happen given how slots are filtered,
// but guarded anyway).
function innermostComponent(
  chain: SelectionTarget[],
): SelectionTarget | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i]!.kind === 'component') return chain[i]!;
  }
  return null;
}

// Walk up from `target` to find the innermost selectable component
// element. Used for body-drag dispatch (drag only fires when the
// click resolves to a draggable shape; checking against `selectable`
// keeps us consistent with the chain-walk's selection rules).
function findSelectable(
  target: Element,
  selectableSpans: ReadonlyMap<string, unknown>,
): HTMLElement | null {
  let el: Element | null = target;
  while (el) {
    if (
      el instanceof HTMLElement &&
      el.hasAttribute('data-sw-component')
    ) {
      const start = el.getAttribute('data-sw-span-start');
      const end = el.getAttribute('data-sw-span-end');
      if (start && end && selectableSpans.has(`${start}-${end}`)) {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

export function ScaledCanvas({
  children,
  onSelectRange,
  onTextEdit,
  onEmptyTextSlotEdit,
  onDragStart,
  onCreateStart,
  onSelectShape,
  onMarqueeStart,
  onChildDragStart,
  selectableSpans,
  currentSelection,
  activeTool = 'select',
}: Props): ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const fit = () => {
      const w = wrapper.clientWidth - MARGIN * 2;
      const h = wrapper.clientHeight - MARGIN * 2;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / DESIGN_W, h / DESIGN_H));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // Double-click dispatch:
  //   - text-span ancestor (data-sw-text-span-*) → in-place edit
  //   - empty text slot placeholder            → materialize + edit
  // Source-jump (move editor cursor to the clicked range) used to
  // live here too but conflicted with text-edit on text spans;
  // it now lives on Ctrl/Cmd+click in handlePointerDown — same
  // mental model as VS Code's "go to definition."
  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as Element | null;
    if (!target?.closest) return;

    // Override drilling on double-click: snap selection to the
    // innermost component under the cursor. Done here (not on
    // pointerdown via event.detail) because Firefox doesn't
    // propagate the click count into pointerdown.detail. The trade
    // is one frame of flicker through chain[1] before dblclick
    // fires and snaps to innermost; final state is correct
    // cross-browser.
    const chain = buildSelectableChain(target, selectableSpans);
    if (chain.length > 0) {
      const resolved =
        innermostComponent(chain) ?? chain[chain.length - 1]!;
      onSelectShape?.(resolved, { shift: false });
    }

    // Empty *text* slot? Materialize-and-edit. Pre-empts the
    // selection-sync fall-through below — there's no real source
    // span to put the editor caret at yet (the slot doesn't exist
    // in source), and the subsequent commit will set selection
    // anyway.
    const emptySlot = target.closest('[data-sw-slot-empty="true"]');
    if (
      emptySlot instanceof HTMLElement &&
      emptySlot.getAttribute('data-sw-slot-type') === 'text' &&
      onEmptyTextSlotEdit
    ) {
      const pStart = parseInt(
        emptySlot.getAttribute('data-sw-slot-parent-start') ?? '',
        10,
      );
      const pEnd = parseInt(
        emptySlot.getAttribute('data-sw-slot-parent-end') ?? '',
        10,
      );
      const slotName = emptySlot.getAttribute('data-sw-slot-name') ?? '';
      if (Number.isFinite(pStart) && Number.isFinite(pEnd) && slotName) {
        onEmptyTextSlotEdit({
          parentSpan: { start: pStart, end: pEnd },
          slotName,
        });
        event.preventDefault();
        return;
      }
    }

    const textNode = target.closest('[data-sw-text-span-start]');
    if (textNode instanceof HTMLElement && onTextEdit) {
      const start = parseInt(textNode.getAttribute('data-sw-text-span-start') ?? '', 10);
      const end = parseInt(textNode.getAttribute('data-sw-text-span-end') ?? '', 10);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        onTextEdit({
          node: textNode,
          start,
          end,
          originalText: textNode.textContent ?? '',
        });
        event.preventDefault();
        return;
      }
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // Only the primary mouse button initiates a gesture; let middle /
    // right click pass through for browser-default behavior.
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (!target?.closest) return;

    // Shed focus from any editor-side text input as soon as the user
    // touches the canvas. Canvas content is mostly non-focusable
    // divs, so a click here doesn't naturally move focus — leaving
    // a previously-clicked editor textarea focused, which then
    // swallows Cmd-Z (routing it to the textarea's native — and
    // usually empty — undo instead of our canvas handler).
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))
    ) {
      active.blur();
    }

    // Ctrl/Cmd+click: jump editor cursor to the clicked source span
    // (same mental model as VS Code "go to definition"). Fires only
    // when an actual source-bearing element was clicked. preventDefault
    // suppresses the body-drag / selection that would otherwise follow.
    if ((event.ctrlKey || event.metaKey) && onSelectRange) {
      const node = target.closest('[data-sw-span-start]');
      if (node) {
        const start = parseInt(node.getAttribute('data-sw-span-start') ?? '', 10);
        const end = parseInt(node.getAttribute('data-sw-span-end') ?? '', 10);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          onSelectRange({ start, end });
          event.preventDefault();
          return;
        }
      }
    }

    // Creation tools take precedence over drag-to-move: any tool
    // other than 'select' makes pointerdown over a Freeform drag
    // out a new shape, even if the click lands on top of an
    // existing one. The container we hand to the create handler is
    // the Freeform's rendered div — the same coordinate system the
    // shapes render in. Without this, preview and final placement
    // would disagree by the slide-inner padding.
    if (activeTool !== 'select' && onCreateStart) {
      const freeformWrapper = target.closest('[data-sw-component="Freeform"]');
      const freeformDiv = freeformWrapper?.firstElementChild;
      if (freeformDiv instanceof HTMLElement) {
        const rect = freeformDiv.getBoundingClientRect();
        const designStartX = (event.clientX - rect.left) / scale;
        const designStartY = (event.clientY - rect.top) / scale;
        event.preventDefault();
        onCreateStart({
          containerEl: freeformDiv,
          pointerStartX: event.clientX,
          pointerStartY: event.clientY,
          designStartX,
          designStartY,
          scale,
        });
        return;
      }
      // No Freeform under the pointer — fall through; the gesture
      // becomes a no-op (drag-to-move would also miss since
      // activeTool !== 'select').
    }

    // Select-mode dispatch: build the selectable chain from the
    // click target, drill against current selection, emit the
    // resolved target. Click on background (empty chain) → clear.
    // Shift-click toggles the chain's outermost in multi-select
    // (skips drilling — multi-select operates on whole-units).
    const modifiers = { shift: event.shiftKey };
    const chain = buildSelectableChain(target, selectableSpans);
    if (chain.length > 0) {
      const resolved = modifiers.shift
        ? chain[0]!
        : drillSelection(chain, currentSelection);
      onSelectShape?.(resolved, modifiers);
      // Shift-click is a selection-modifier gesture (toggle), not a
      // drag-initiating click. Skip the drag dispatch.
      if (modifiers.shift) {
        event.preventDefault();
        return;
      }
      // Body-drag / layout-intercept only fire if the resolved
      // target is a component (not slot). Slots aren't draggable.
      if (
        resolved &&
        (resolved.kind === 'slot' || resolved.kind === 'empty-slot')
      ) {
        event.preventDefault();
        return;
      }
      // Existing: identify the innermost selectable component
      // for body-drag (only fires if resolved component matches
      // an existing draggable selector match — unchanged).
      const selectable = findSelectable(target, selectableSpans);
      // Layout-intercept (v0.4 reorder). Walk up to find the
      // innermost component AND its parent component. If the
      // host's onChildDragStart says yes, dispatch returned and
      // skip body-drag.
      if (onChildDragStart) {
        const innerComp = target.closest('[data-sw-component]');
        const parentComp = innerComp?.parentElement?.closest('[data-sw-component]');
        if (innerComp instanceof HTMLElement && parentComp instanceof HTMLElement) {
          const childStart = parseInt(innerComp.getAttribute('data-sw-span-start') ?? '', 10);
          const childEnd = parseInt(innerComp.getAttribute('data-sw-span-end') ?? '', 10);
          const parentStart = parseInt(parentComp.getAttribute('data-sw-span-start') ?? '', 10);
          const parentEnd = parseInt(parentComp.getAttribute('data-sw-span-end') ?? '', 10);
          if (
            Number.isFinite(childStart) &&
            Number.isFinite(childEnd) &&
            Number.isFinite(parentStart) &&
            Number.isFinite(parentEnd)
          ) {
            const handled = onChildDragStart({
              childSpan: { start: childStart, end: childEnd },
              parentSpan: { start: parentStart, end: parentEnd },
              parentEl: parentComp,
              pointerStartX: event.clientX,
              pointerStartY: event.clientY,
              scale,
              event: event.nativeEvent,
            });
            if (handled) {
              event.preventDefault();
              return;
            }
          }
        }
      }
      const draggable = target.closest(DRAGGABLE_SELECTOR);
      if (
        draggable instanceof HTMLElement &&
        draggable === selectable &&
        onDragStart
      ) {
        const dStart = parseInt(
          draggable.getAttribute('data-sw-span-start') ?? '',
          10,
        );
        const dEnd = parseInt(
          draggable.getAttribute('data-sw-span-end') ?? '',
          10,
        );
        if (Number.isFinite(dStart) && Number.isFinite(dEnd)) {
          event.preventDefault();
          onDragStart({
            node: draggable,
            start: dStart,
            end: dEnd,
            pointerStartX: event.clientX,
            pointerStartY: event.clientY,
            scale,
          });
        }
      }
      return;
    }

    // Background click — pointer landed somewhere that isn't a
    // shape. If we're inside a Freeform in select mode, start a
    // marquee gesture (the host figures out on pointerup whether
    // it was a click-to-clear or a drag-to-select). Outside any
    // Freeform (e.g., margin around the slide), fall through to
    // the older clear-selection dispatch.
    if (activeTool === 'select' && onMarqueeStart) {
      const freeformWrapper = target.closest('[data-sw-component="Freeform"]');
      const freeformDiv = freeformWrapper?.firstElementChild;
      if (freeformDiv instanceof HTMLElement) {
        const rect = freeformDiv.getBoundingClientRect();
        const designStartX = (event.clientX - rect.left) / scale;
        const designStartY = (event.clientY - rect.top) / scale;
        event.preventDefault();
        onMarqueeStart({
          freeformDiv,
          pointerStartX: event.clientX,
          pointerStartY: event.clientY,
          designStartX,
          designStartY,
          scale,
          shift: modifiers.shift,
        });
        return;
      }
    }

    // Don't preventDefault — the host may want browser-default
    // click semantics for things outside shapes.
    onSelectShape?.(null, modifiers);
  };

  // Outline scales with the CSS transform, so we divide by scale to
  // get a roughly constant 2px-visible border around the slide
  // regardless of the panel size.
  const outlineWidth = scale > 0 ? 2 / scale : 2;

  return (
    <div
      className={
        'presentation' + (activeTool !== 'select' ? ' tool-drawing' : '')
      }
      ref={wrapperRef}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
    >
      <div
        className="presentation-canvas"
        ref={canvasRef}
        style={{
          width: `${DESIGN_W}px`,
          height: `${DESIGN_H}px`,
          transform: `scale(${scale})`,
          outline: `${outlineWidth}px solid rgba(0, 0, 0, 0.35)`,
          ['--deck-design-w' as string]: `${DESIGN_W}px`,
          ['--deck-design-h' as string]: `${DESIGN_H}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
