import { useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

// Shared viewport positioning for source-backed selection controls.
export function FloatingSelectionToolbar({ bounds, className = '', ...props }: HTMLAttributes<HTMLDivElement> & {
  bounds(): Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | null;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const selection = bounds();
      const element = toolbar.current;
      if (!selection || !element) return;
      const rect = element.getBoundingClientRect();
      const left = Math.max(8, Math.min((selection.left + selection.right - rect.width) / 2, window.innerWidth - rect.width - 8));
      const above = selection.top - rect.height - 10;
      const top = Math.max(8, Math.min(above >= 8 ? above : selection.bottom + 10, window.innerHeight - rect.height - 8));
      setPosition(prior => prior?.left === left && prior.top === top ? prior : { left, top });
    };
    place();
    const frame = requestAnimationFrame(place);
    const observer = new ResizeObserver(place);
    if (toolbar.current) observer.observe(toolbar.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [bounds]);
  return createPortal(<div {...props} ref={toolbar} role="toolbar"
    className={`sw-floating-toolbar sw-text-session-actions ${className}`}
    style={{ left: position?.left ?? 8, top: position?.top ?? 8, visibility: position ? 'visible' : 'hidden' }}
    onPointerDown={event => event.stopPropagation()} />, document.body);
}
