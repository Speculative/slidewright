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
  activeTool?: 'select' | 'box';
}

const DRAGGABLE_SELECTOR = '[data-sw-component="Box"]';

export function ScaledCanvas({
  children,
  onSelectRange,
  onTextEdit,
  onDragStart,
  onCreateStart,
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

    // Creation tools take precedence over drag-to-move: in 'box'
    // mode, pointerdown over a Freeform drags out a new shape (even
    // if the click lands on top of an existing Box inside the
    // Freeform). The container we hand to the create handler is the
    // Freeform's rendered div — the same coordinate system the
    // shapes render in. Without this, preview and final placement
    // would disagree by the slide-inner padding.
    if (activeTool === 'box' && onCreateStart) {
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

    if (!onDragStart) return;
    const node = target.closest(DRAGGABLE_SELECTOR);
    if (!(node instanceof HTMLElement)) return;
    const start = parseInt(node.getAttribute('data-sw-span-start') ?? '', 10);
    const end = parseInt(node.getAttribute('data-sw-span-end') ?? '', 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    event.preventDefault();
    onDragStart({
      node,
      start,
      end,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      scale,
    });
  };

  // Outline scales with the CSS transform, so we divide by scale to
  // get a roughly constant 2px-visible border around the slide
  // regardless of the panel size.
  const outlineWidth = scale > 0 ? 2 / scale : 2;

  return (
    <div
      className={'presentation' + (activeTool === 'box' ? ' tool-box' : '')}
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
