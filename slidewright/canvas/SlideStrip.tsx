// Slidewright canvas — vertical thumbnail strip.
//
// Each thumbnail is the same Slide component rendered into a small
// frame via CSS transform: scale(...). Sizing strategy:
//   - The frame is sized by CSS (width: 100%, aspect-ratio: 1920/1080),
//     so it fills the strip's content area minus the thumbnail border
//     regardless of the strip's padding or other layout choices.
//   - A ResizeObserver on a representative frame measures its actual
//     rendered width and sets --thumb-scale on the strip element so
//     the inner section.slide's transform: scale matches.
// This keeps JS and CSS authoritative for non-overlapping concerns:
// CSS owns layout, JS owns the scale-to-design-space ratio.
//
// v0.4: multi-select + drag-reorder. Click modifiers:
//   - plain click: replace selection with [idx]; activeIdx = idx
//   - shift+click: range from selection anchor to idx; activeIdx = idx
//   - cmd/ctrl+click: toggle idx in selection; activeIdx = idx
// Drag-reorder uses pointer events directly. An insertion line
// appears between thumbs; release commits a source reorder.
//
// No virtualization yet — v0-reference has 2 slides, and the strip's
// layout is independent per-thumbnail so windowing will be a clean
// drop-in once we hit decks large enough to need it.
//
// Note on slide visibility: styles.css's
// `.presentation-canvas > section.slide` rules apply absolute
// positioning + visibility-hidden-unless-active, but those rules
// only kick in *inside* a .presentation-canvas wrapper. The strip
// uses its own wrapper class (.sw-thumb-frame) so each slide
// renders at its natural 1920x1080 size and the active visibility
// gating doesn't apply — every thumbnail is visible regardless of
// the `active` prop.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactElement } from 'react';

import { prepareSlide } from './App.js';

const DESIGN_W = 1920;
const DRAG_THRESHOLD = 4;

export interface SlideClickModifiers {
  shift: boolean;
  meta: boolean; // cmd on mac / ctrl on win/linux
}

interface Props {
  slides: ReactElement[];
  activeIdx: number;
  selection: ReadonlyArray<number>;
  onSelect: (idx: number, mods: SlideClickModifiers) => void;
  onAddSlide: () => void;
  onReorder: (fromIndices: ReadonlyArray<number>, toIndex: number) => void;
  width: number;
}

interface DragState {
  // The slide the user pointer-downed on. The "group" being moved
  // is `selection` if `originIdx` ∈ `selection`, else just
  // [originIdx].
  originIdx: number;
  // Pointer coords at gesture start — needed to detect the
  // threshold crossing.
  startX: number;
  startY: number;
  // Modifiers captured at pointerdown. If the gesture never
  // crosses the drag threshold, pointerup routes to onSelect
  // with these modifiers (so shift/cmd+click work without an
  // accidental drag swallowing the modifiers).
  shift: boolean;
  meta: boolean;
  // After threshold: which gap index the pointer is currently
  // over. 0 ≤ insertionIndex ≤ slides.length.
  insertionIndex: number | null;
}

export function SlideStrip({
  slides,
  activeIdx,
  selection,
  onSelect,
  onAddSlide,
  onReorder,
  width,
}: Props): ReactElement {
  const stripRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const probe = probeRef.current;
    if (!strip || !probe) return;
    const update = () => {
      const w = probe.clientWidth;
      if (w > 0) {
        strip.style.setProperty('--thumb-scale', String(w / DESIGN_W));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [slides.length]);

  // Drag lifecycle: pointermove updates insertionIndex; pointerup
  // commits. Attached on the document so the drag survives the
  // pointer briefly leaving the strip.
  useEffect(() => {
    if (!drag) return;
    const stripEl = stripRef.current;
    if (!stripEl) return;
    const onMove = (e: globalThis.PointerEvent) => {
      // Threshold gate — keep insertionIndex null until past it
      // so a plain click doesn't enter drag mode.
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      // Compute the gap index from the pointer's Y relative to the
      // thumb midpoints. The strip is vertical and thumbs flow
      // top-to-bottom; the gap above thumb i has the same Y as
      // thumb i's top edge.
      const thumbs = Array.from(
        stripEl.querySelectorAll<HTMLElement>('.sw-thumb'),
      );
      let idx = thumbs.length; // after-last by default
      for (let i = 0; i < thumbs.length; i++) {
        const rect = thumbs[i]!.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          idx = i;
          break;
        }
      }
      setDrag((prev) => (prev ? { ...prev, insertionIndex: idx } : prev));
    };
    const onUp = () => {
      const d = drag;
      const idx = d.insertionIndex;
      setDrag(null);
      if (idx !== null) {
        // Past-threshold drag: commit reorder, do not select.
        const moving = selection.includes(d.originIdx)
          ? selection.slice()
          : [d.originIdx];
        onReorder(moving, idx);
      } else {
        // Below-threshold pointerup is a click — route to select
        // with the modifiers captured at pointerdown. (We don't
        // rely on the React `click` event because it fires after
        // pointerup with no clean way to suppress it from a
        // committed drag without a ref dance.)
        onSelect(d.originIdx, { shift: d.shift, meta: d.meta });
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [drag, onReorder, onSelect, selection]);

  const selSet = new Set(selection);

  return (
    <div
      className="sw-strip"
      role="listbox"
      aria-label="Slides"
      ref={stripRef}
      style={{ width: `${width}px` }}
      aria-multiselectable
    >
      {slides.map((slide, i) => (
        <div key={i} className="sw-thumb-slot">
          {drag?.insertionIndex === i ? <InsertionLine /> : null}
          <SlideThumb
            slide={slide}
            idx={i}
            active={i === activeIdx}
            selected={selSet.has(i)}
            dragging={
              drag !== null &&
              drag.insertionIndex !== null &&
              (selSet.has(drag.originIdx)
                ? selSet.has(i)
                : i === drag.originIdx)
            }
            onPointerDown={(e) => {
              // Left button only; ignore right-click + middle-click.
              if (e.button !== 0) return;
              // Capture modifiers now; the click vs drag decision
              // happens at pointerup based on threshold-crossing.
              setDrag({
                originIdx: i,
                startX: e.clientX,
                startY: e.clientY,
                shift: e.shiftKey,
                meta: e.metaKey || e.ctrlKey,
                insertionIndex: null,
              });
            }}
            frameRef={i === 0 ? probeRef : undefined}
          />
        </div>
      ))}
      {drag?.insertionIndex === slides.length ? (
        // Wrap in .sw-thumb-slot so the line inherits width:100%
        // the same way the inter-thumb indicators do. As a direct
        // flex child of .sw-strip (which uses align-items: center
        // for the thumb buttons), align-self: stretch didn't reach
        // the visible width path even though the element took
        // layout space.
        <div className="sw-thumb-slot">
          <InsertionLine />
        </div>
      ) : null}
      <button
        type="button"
        className="sw-add-slide"
        onClick={onAddSlide}
        aria-label="Add slide"
        title="Add slide below current (Ctrl+M)"
        aria-keyshortcuts="Control+m Meta+m"
      >
        + Slide
      </button>
    </div>
  );
}

function InsertionLine(): ReactElement {
  return <div className="sw-strip-insertion" aria-hidden />;
}

function SlideThumb({
  slide,
  idx,
  active,
  selected,
  dragging,
  onPointerDown,
  frameRef,
}: {
  slide: ReactElement;
  idx: number;
  active: boolean;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  frameRef?: React.RefObject<HTMLDivElement | null>;
}): ReactElement {
  const prepared = prepareSlide(slide);
  const cls = ['sw-thumb'];
  if (active) cls.push('active');
  if (selected) cls.push('selected');
  if (dragging) cls.push('dragging');
  const style: CSSProperties = dragging ? { opacity: 0.5 } : {};
  return (
    <button
      type="button"
      className={cls.join(' ')}
      onPointerDown={onPointerDown}
      aria-label={`Slide ${idx + 1}`}
      aria-selected={selected}
      role="option"
      style={style}
    >
      <div className="sw-thumb-frame" ref={frameRef}>
        {prepared}
      </div>
      <div className="sw-thumb-num">{idx + 1}</div>
    </button>
  );
}
