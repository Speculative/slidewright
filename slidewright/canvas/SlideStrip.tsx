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

import { cloneElement, useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';

const DESIGN_W = 1920;

interface Props {
  slides: ReactElement[];
  activeIdx: number;
  onSelect: (idx: number) => void;
  actLabel: string;
  width: number;
}

export function SlideStrip({
  slides,
  activeIdx,
  onSelect,
  actLabel,
  width,
}: Props): ReactElement {
  const stripRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      className="sw-strip"
      role="listbox"
      aria-label="Slides"
      ref={stripRef}
      style={{ width: `${width}px` }}
    >
      {slides.map((slide, i) => (
        <SlideThumb
          key={i}
          slide={slide}
          idx={i}
          active={i === activeIdx}
          onClick={() => onSelect(i)}
          actLabel={actLabel}
          frameRef={i === 0 ? probeRef : undefined}
        />
      ))}
    </div>
  );
}

function SlideThumb({
  slide,
  idx,
  active,
  onClick,
  actLabel,
  frameRef,
}: {
  slide: ReactElement;
  idx: number;
  active: boolean;
  onClick: () => void;
  actLabel: string;
  frameRef?: React.RefObject<HTMLDivElement | null>;
}): ReactElement {
  // Same prep as the main canvas slide — the chrome reads `active`
  // and `actLabel`, and the loader has already injected `idx`.
  const prepared = cloneElement(slide, {
    active: true,
    actLabel,
  } as Record<string, unknown>);
  return (
    <button
      type="button"
      className={'sw-thumb' + (active ? ' active' : '')}
      onClick={onClick}
      aria-label={`Slide ${idx + 1}`}
      aria-selected={active}
      role="option"
    >
      <div className="sw-thumb-frame" ref={frameRef}>
        {prepared}
      </div>
      <div className="sw-thumb-num">{idx + 1}</div>
    </button>
  );
}
