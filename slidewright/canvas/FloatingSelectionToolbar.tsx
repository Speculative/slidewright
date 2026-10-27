import { useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

// Shared canvas-column positioning for source-backed selection controls.
export function FloatingSelectionToolbar({ bounds, className = '', ...props }: HTMLAttributes<HTMLDivElement> & {
  bounds(): Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | null;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; maxWidth: number } | null>(null);
  useLayoutEffect(() => {
    const canvas = document.querySelector('.sw-canvas-stage');
    const place = () => {
      const selection = bounds();
      const element = toolbar.current;
      if (!selection || !element) return;
      const column = canvas?.getBoundingClientRect();
      const minLeft = Math.max(8, (column?.left ?? 0) + 8);
      const maxRight = Math.min(window.innerWidth - 8, (column?.right ?? window.innerWidth) - 8);
      const maxWidth = Math.max(0, maxRight - minLeft);
      // Measure after wrapping to the available canvas width. A viewport-wide
      // toolbar can otherwise obscure the slide strip or properties sidebar.
      element.style.maxWidth = `${maxWidth}px`;
      const rect = element.getBoundingClientRect();
      const left = Math.max(minLeft, Math.min((selection.left + selection.right - rect.width) / 2, maxRight - rect.width));
      const above = selection.top - rect.height - 10;
      const top = Math.max(8, Math.min(above >= 8 ? above : selection.bottom + 10, window.innerHeight - rect.height - 8));
      setPosition(prior => prior?.left === left && prior.top === top && prior.maxWidth === maxWidth ? prior : { left, top, maxWidth });
    };
    place();
    const frame = requestAnimationFrame(place);
    const observer = new ResizeObserver(place);
    if (toolbar.current) observer.observe(toolbar.current);
    if (canvas) observer.observe(canvas);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [bounds]);
  return createPortal(<div {...props} ref={toolbar} role="toolbar"
    className={`sw-floating-toolbar sw-text-session-actions ${className}`}
    style={{ left: position?.left ?? 8, top: position?.top ?? 8, maxWidth: position?.maxWidth, visibility: position ? 'visible' : 'hidden' }}
    onPointerDown={event => event.stopPropagation()} />, document.body);
}
