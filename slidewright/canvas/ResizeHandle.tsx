// Slidewright canvas — drag handle for resizing a sibling pane.
//
// Generic on axis ('x' for horizontal drag → width changes, 'y' for
// vertical drag → height changes). The `invert` flag flips the sign
// of the delta — used when the handle sits on the *trailing* edge
// of the resizable element (e.g., the editor pane below the canvas:
// dragging the divider DOWN shrinks the editor since its bottom is
// pinned to the panel edge).
//
// Captures pointer + freezes body cursor/selection during drag so the
// resize feels solid even when the cursor briefly leaves the handle.

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

interface Props {
  axis?: 'x' | 'y';
  invert?: boolean;
  size: number;
  setSize: (n: number) => void;
  min: number;
  max: number;
}

export function ResizeHandle({
  axis = 'x',
  invert = false,
  size,
  setSize,
  min,
  max,
}: Props): ReactElement {
  const [dragging, setDragging] = useState(false);
  const startCoord = useRef(0);
  const startSize = useRef(0);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const coord = axis === 'y' ? e.clientY : e.clientX;
      const delta = coord - startCoord.current;
      const signed = invert ? -delta : delta;
      const next = Math.max(min, Math.min(max, startSize.current + signed));
      setSize(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = axis === 'y' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, axis, invert, min, max, setSize]);

  return (
    <div
      className={
        'sw-resize-handle' +
        (axis === 'y' ? ' axis-y' : ' axis-x') +
        (dragging ? ' dragging' : '')
      }
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={
        axis === 'y' ? 'Resize editor pane' : 'Resize slide strip'
      }
      onPointerDown={(e) => {
        startCoord.current = axis === 'y' ? e.clientY : e.clientX;
        startSize.current = size;
        setDragging(true);
        e.preventDefault();
      }}
    />
  );
}
