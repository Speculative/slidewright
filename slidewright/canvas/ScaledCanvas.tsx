// Slidewright canvas — ScaledCanvas.
//
// A 1920x1080 design surface scaled to fit the available viewport via a
// CSS transform. ResizeObserver-driven so the canvas re-fits as the
// container resizes. Mirrors src/Presentation.jsx's geometry without
// the rest of its concerns (popout notes, localStorage, document title,
// keyboard nav).

import { cloneElement, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

const DESIGN_W = 1920;
const DESIGN_H = 1080;

export function ScaledCanvas({ children }: { children: ReactNode }): ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const fit = () => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      if (w === 0 || h === 0) return;
      setScale(Math.min(w / DESIGN_W, h / DESIGN_H));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // Mirror the existing scaffold's class structure so styles.css's
  // `.presentation`, `.presentation-canvas`, and `section.slide.active`
  // rules apply. The slide arrives unprepped (no `active` prop);
  // cloneElement adds it so the .active visibility rule kicks in.
  const slideEl = isReactElement(children)
    ? cloneElement(children, { active: true } as Record<string, unknown>)
    : children;

  return (
    <div className="presentation" ref={wrapperRef}>
      <div
        className="presentation-canvas"
        style={{
          width: `${DESIGN_W}px`,
          height: `${DESIGN_H}px`,
          transform: `scale(${scale})`,
          ['--deck-design-w' as string]: `${DESIGN_W}px`,
          ['--deck-design-h' as string]: `${DESIGN_H}px`,
        }}
      >
        {slideEl}
      </div>
    </div>
  );
}

function isReactElement(node: ReactNode): node is ReactElement {
  return (
    node !== null &&
    typeof node === 'object' &&
    'type' in (node as object) &&
    'props' in (node as object)
  );
}
