import { useLayoutEffect, useRef } from 'react';

type View = 'print' | 'breakpoint';
interface Snapshot { view: View; element: HTMLElement; capturedAt: number }
// Each canvas owns its handoff. Thumbnails, previews and exports cannot consume
// the audience canvas's snapshot, and detached canvases can be collected.
const snapshots = new WeakMap<Element, Snapshot>();

/** Crossfade only when navigating between the two calculator debugging views. */
export function useCalculatorSlideTransition(view: View) {
  const ref = useRef<HTMLDivElement>(null);
  const handoff = useRef<Snapshot | undefined>(undefined);
  useLayoutEffect(() => {
    const body = ref.current;
    const canvas = body?.closest('.sw-canvas-stage .presentation-canvas');
    if (!body || !canvas) return;
    const captured = snapshots.get(canvas);
    // Retain the incoming handoff across StrictMode's effect replay.
    if (captured && captured.view !== view) handoff.current = captured;
    const previous = handoff.current;
    snapshots.delete(canvas);
    let outgoing: HTMLElement | undefined;
    let fadeIn: Animation | undefined;
    let fadeOut: Animation | undefined;
    if (previous && previous.view !== view && performance.now() - previous.capturedAt < 1000
      && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      outgoing = previous.element;
      outgoing.setAttribute('data-demo-slide-transition', 'outgoing');
      outgoing.setAttribute('aria-hidden', 'true');
      outgoing.inert = true;
      Object.assign(outgoing.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: `${body.offsetHeight}px`, pointerEvents: 'none', zIndex: '1' });
      body.parentElement!.append(outgoing);
      const timing = { duration: 700, easing: 'ease-in-out' };
      fadeIn = body.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      fadeOut = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], timing);
      fadeOut.onfinish = () => outgoing?.remove();
    }
    return () => {
      fadeIn?.cancel(); fadeOut?.cancel(); outgoing?.remove();
      const element = body.cloneNode(true) as HTMLElement;
      // Snapshot markup is visual only: do not duplicate live identities,
      // accessibility labels or selectors used by the editor and tests.
      for (const node of [element, ...element.querySelectorAll('*')]) {
        for (const attribute of [...node.attributes]) {
          if (attribute.name.startsWith('data-') || attribute.name === 'id' || attribute.name === 'aria-label') node.removeAttribute(attribute.name);
        }
      }
      const snapshot = { view, element, capturedAt: performance.now() };
      snapshots.set(canvas, snapshot);
      // Only the next view mounted in this commit may use the handoff.
      // Visiting an unrelated slide must not leave a stale print view behind.
      queueMicrotask(() => {
        if (snapshots.get(canvas) === snapshot) snapshots.delete(canvas);
      });
    };
  }, [view]);
  return ref;
}
