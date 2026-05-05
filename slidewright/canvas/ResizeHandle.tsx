// Slidewright canvas — vertical drag handle between the slide strip
// and the main canvas. Drives an externally-held strip width state
// via pointer events.
//
// Captures pointer + freezes body cursor/selection during drag so the
// resize feels solid even when the cursor briefly leaves the handle.

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

interface Props {
  width: number;
  setWidth: (w: number) => void;
  min: number;
  max: number;
}

export function ResizeHandle({ width, setWidth, min, max }: Props): ReactElement {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const delta = e.clientX - startX.current;
      const next = Math.max(min, Math.min(max, startW.current + delta));
      setWidth(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, min, max, setWidth]);

  return (
    <div
      className={'sw-resize-handle' + (dragging ? ' dragging' : '')}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize slide strip"
      onPointerDown={(e) => {
        startX.current = e.clientX;
        startW.current = width;
        setDragging(true);
        e.preventDefault();
      }}
    />
  );
}
