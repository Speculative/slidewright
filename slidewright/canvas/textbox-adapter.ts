import type { ShapeAdapter } from './shape-adapter.js';
import { makeRectAdapter } from './rect-adapter.js';
import { measureLayoutSnapshot } from './layout-measurement.js';
import { findComponentAtSpan } from './ast-edits.js';
import { numberLit, slotFill, stringLit } from '../runtime/ast-builders.js';

export function textBoxSizing(params: Record<string, unknown>): string {
  if (['auto-width', 'auto-height', 'fixed'].includes(String(params.sizing))) return String(params.sizing);
  return typeof params.width === 'number' ? typeof params.height === 'number' ? 'fixed' : 'auto-height' : 'auto-width';
}

export function makeTextBoxAdapter(): ShapeAdapter {
  const rect = makeRectAdapter({ width: 320, height: 120 });
  // Rendered dimensions travel only through gesture/selection params.
  // They never become source fields until a resize constrains the box.
  const measuredParams = (params: Record<string, unknown>) => ({
    ...params, sizing: textBoxSizing(params),
    width: params.__measuredWidth ?? params.width,
    height: params.__measuredHeight ?? params.height,
  });
  return {
    ...rect,
    measureBounds: true,
    calculateBounds: params => rect.calculateBounds(measuredParams(params)),
    Handles: props => rect.Handles({ ...props, params: measuredParams(props.params) }),
    applyGesture(params, delta) {
      if (delta.kind === 'translate') return rect.applyGesture(params, delta);
      const next = rect.applyGesture(measuredParams(params), delta);
      const direction = delta.kind === 'opaque' ? (delta.delta as { direction?: string } | null)?.direction : undefined;
      return { ...next, __measuredWidth: undefined, __measuredHeight: undefined,
        sizing: (direction === 'e' || direction === 'w') && textBoxSizing(params) !== 'fixed' ? 'auto-height' : 'fixed' };
    },
    commit(ast, span, delta, slideIdx) {
      const target = findComponentAtSpan(ast, span.start, span.end);
      if (!target) return null;
      for (const name of ['x', 'y']) {
        if (!target.fills.some(fill => fill.name === name)) target.fills.push(slotFill(name, numberLit(0)));
      }
      if (delta.kind !== 'translate') {
        const originalParams = Object.fromEntries(target.fills.flatMap(fill => fill.value.kind === 'number' || fill.value.kind === 'string' ? [[fill.name, fill.value.value]] : []));
        const bounds = measureLayoutSnapshot(span)?.layout;
        for (const [name, fallback] of [['width', bounds?.width ?? 320], ['height', bounds?.height ?? 120]] as const) {
          const fill = target.fills.find(fill => fill.name === name);
          // The DOM already shows the final transform preview. Recover its
          // starting size before the shared adapter applies that transform.
          const original = delta.kind === 'transform' ? fallback / Math.abs(name === 'width' ? delta.sx : delta.sy) : fallback;
          if (delta.kind === 'transform' && fill) fill.value = numberLit(original);
          else if (!fill) target.fills.push(slotFill(name, numberLit(original)));
        }
        const direction = delta.kind === 'opaque' ? (delta.delta as { direction?: string } | null)?.direction : undefined;
        const mode = stringLit((direction === 'e' || direction === 'w') && textBoxSizing(originalParams) !== 'fixed' ? 'auto-height' : 'fixed');
        const fill = target.fills.find(fill => fill.name === 'sizing');
        if (fill) fill.value = mode; else target.fills.push(slotFill('sizing', mode));
      }
      return rect.commit(ast, span, delta, slideIdx);
    },
  };
}
