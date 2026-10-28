import { useLayoutEffect, useState, type ReactElement } from 'react';
import type { Component, Value } from '../runtime/ast.js';
import { buildDifferences, buildObjects, objectId } from '../runtime/builds.js';
import type { SlideAstData } from '../runtime/loader.js';

interface Rectangle { left: number; top: number; width: number; height: number }
interface Indicator { id: string; object: Component; state: 'enters' | 'exits' | 'changes'; current: Rectangle; previous?: Rectangle }

function rectangle(container: Element | null, object: Component, origin: DOMRect, scale: number): Rectangle | undefined {
  const node = container?.querySelector(`[data-sw-component][data-sw-span-start="${object.span.start.offset}"][data-sw-span-end="${object.span.end.offset}"]`);
  if (!node) return undefined;
  const range = document.createRange(); range.selectNodeContents(node);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return undefined;
  return { left: (rect.left - origin.left) / scale, top: (rect.top - origin.top) / scale,
    width: rect.width / scale, height: rect.height / scale };
}

/** Compare against the preceding rendered thumbnail, which provides actual
 * layout geometry even for exited stack children and custom components. */
export function BuildChangesOverlay({ slide, slideIndex, onSelect, defaultValue }: {
  slide: SlideAstData; slideIndex: number; onSelect(object: Component): void;
  defaultValue?(object: Component, property: string): Value | undefined;
}): ReactElement | null {
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  useLayoutEffect(() => {
    if (slide.buildIndex === 0) { setIndicators([]); return; }
    const canvas = document.querySelector('.sw-canvas-stage .presentation-canvas');
    const slot = document.querySelector(`.sw-thumb-slot[data-slide-index="${slideIndex}"]`);
    const previous = slide.buildIndex === 1 ? slot?.querySelector(':scope > .sw-thumb .sw-thumb-frame')
      : slot?.querySelector(`.sw-build-thumb[data-build-index="${slide.buildIndex - 1}"] .sw-thumb-frame`);
    if (!canvas || !previous) return;
    const measure = () => {
      const origin = canvas.getBoundingClientRect();
      const oldOrigin = previous.getBoundingClientRect();
      const scale = origin.width / 1920;
      const oldScale = oldOrigin.width / 1920;
      if (!(scale > 0 && oldScale > 0)) return;
      const objects = new Map(buildObjects(slide.authoredComp).flatMap(object => objectId(object) ? [[objectId(object)!, object] as const] : []));
      let differences: ReturnType<typeof buildDifferences> = [];
      try { differences = buildDifferences(slide.authoredComp, slide.buildIndex, defaultValue); } catch { /* Invalid source has loader diagnostics. */ }
      setIndicators(differences.flatMap(change => {
        const object = objects.get(change.id);
        if (!object) return [];
        const now = rectangle(canvas, object, origin, scale);
        const before = rectangle(previous, object, oldOrigin, oldScale);
        const current = now ?? before;
        if (!current) return [];
        return [{ id: change.id, object, state: change.entering ? 'enters' : change.exiting ? 'exits' : 'changes', current, previous: before } as Indicator];
      }));
    };
    const observer = new ResizeObserver(measure); observer.observe(canvas); observer.observe(previous);
    measure();
    return () => observer.disconnect();
  }, [slide, slideIndex, defaultValue]);
  if (!indicators.length) return null;
  return <div className="sw-build-changes-overlay" aria-label="Changes from previous frame">
    {indicators.map(indicator => <div key={indicator.id} className={`sw-build-change-indicator ${indicator.state}`}
      data-build-change={indicator.state} style={{ left: indicator.current.left, top: indicator.current.top,
        width: indicator.current.width, height: indicator.current.height }}>
      <button type="button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelect(indicator.object); }}
        aria-label={`Select ${indicator.state === 'exits' ? 'exiting' : indicator.state === 'enters' ? 'entering' : 'changed'} ${indicator.object.name}`}>{indicator.state}</button>
    </div>)}
  </div>;
}
