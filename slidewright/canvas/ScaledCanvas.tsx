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
import type { MouseEvent, ReactElement, ReactNode } from 'react';

import type { SourceRange } from './host.js';

const DESIGN_W = 1920;
const DESIGN_H = 1080;
// Visual margin between the slide and the panel edges. The slide
// shrinks to fit (clientWidth - 2*MARGIN); existing flex centering on
// .presentation puts the result in the middle of the surrounding white
// space, so the margin shows as a uniform gutter.
const MARGIN = 16;

interface Props {
  children: ReactNode;
  onSelectRange?: (range: SourceRange) => void;
}

export function ScaledCanvas({ children, onSelectRange }: Props): ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
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

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!onSelectRange) return;
    const target = event.target as Element | null;
    if (!target?.closest) return;
    const node = target.closest('[data-sw-span-start]');
    if (!node) return;
    const start = parseInt(node.getAttribute('data-sw-span-start') ?? '', 10);
    const end = parseInt(node.getAttribute('data-sw-span-end') ?? '', 10);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      onSelectRange({ start, end });
    }
  };

  // Outline scales with the CSS transform, so we divide by scale to
  // get a roughly constant 2px-visible border around the slide
  // regardless of the panel size.
  const outlineWidth = scale > 0 ? 2 / scale : 2;

  return (
    <div className="presentation" ref={wrapperRef} onClick={handleClick}>
      <div
        className="presentation-canvas"
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
