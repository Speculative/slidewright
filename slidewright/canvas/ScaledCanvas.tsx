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

import type { SourceRange } from './host.js';

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

interface Props {
  children: ReactNode;
  onSelectRange?: (range: SourceRange) => void;
  onTextEdit?: (target: TextEditTarget) => void;
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
  // selectable shape's source range (or null if the click landed
  // on the canvas background — clear selection there) plus
  // modifier state. The host decides what to do with the click —
  // replace, toggle (shift), or keep (drag of existing selection).
  onSelectShape?: (
    range: SourceRange | null,
    modifiers: { shift: boolean },
  ) => void;
  // Fired when pointer goes down on empty Freeform space in select
  // mode (v0.2.j). The handler renders a marquee preview during
  // pointermove and, on release, sets selection to all shapes
  // intersecting the rectangle.
  onMarqueeStart?: (target: MarqueeStart) => void;
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

// Shapes that respond to Select-mode clicks. Wider than the
// draggable set: Arrow is selectable (for Delete, future endpoint
// editing) without supporting body drag, and v0.4-tight-cut
// HStack / VStack are selectable + inspectable but not yet
// gesture-able.
const SELECTABLE_SELECTOR =
  '[data-sw-component="Box"], [data-sw-component="TextBox"], [data-sw-component="Arrow"], [data-sw-component="HStack"], [data-sw-component="VStack"]';

export function ScaledCanvas({
  children,
  onSelectRange,
  onTextEdit,
  onDragStart,
  onCreateStart,
  onSelectShape,
  onMarqueeStart,
  onChildDragStart,
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
  //   - component-span ancestor (data-sw-span-*)  → selection sync
  // Single clicks happen too easily during navigation; making the
  // source-affecting actions explicit (double-click) keeps the user
  // in control of when text becomes editable / when their editor
  // caret moves.
  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as Element | null;
    if (!target?.closest) return;

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

    if (!onSelectRange) return;
    const node = target.closest('[data-sw-span-start]');
    if (!node) return;
    const start = parseInt(node.getAttribute('data-sw-span-start') ?? '', 10);
    const end = parseInt(node.getAttribute('data-sw-span-end') ?? '', 10);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      onSelectRange({ start, end });
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

    // Select-mode dispatch: emit selection state regardless of
    // whether the shape is draggable, then start a drag if it is.
    // Box/TextBox: select + drag. Arrow: select only.
    // Click on background (no shape ancestor): clear selection.
    const modifiers = { shift: event.shiftKey };
    const selectable = target.closest(SELECTABLE_SELECTOR);
    if (selectable instanceof HTMLElement) {
      const start = parseInt(selectable.getAttribute('data-sw-span-start') ?? '', 10);
      const end = parseInt(selectable.getAttribute('data-sw-span-end') ?? '', 10);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        onSelectShape?.({ start, end }, modifiers);
      }
      // Shift-click is a selection-modifier gesture (toggle), not a
      // drag-initiating click. Skip the drag dispatch so a shift-
      // click on a draggable shape doesn't kick off a body drag of
      // the post-toggle selection on the same pointerdown.
      if (modifiers.shift) {
        event.preventDefault();
        return;
      }
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
        onDragStart &&
        Number.isFinite(start) &&
        Number.isFinite(end)
      ) {
        event.preventDefault();
        onDragStart({
          node: draggable,
          start,
          end,
          pointerStartX: event.clientX,
          pointerStartY: event.clientY,
          scale,
        });
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
