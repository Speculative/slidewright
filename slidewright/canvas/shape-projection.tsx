// Canvas-side shape wrapper. The loader passes this `wrapShape`
// when running in the canvas; each component invocation gets
// rendered through ShapeProjection, which:
//   1. Adds the data-sw-component / data-sw-span-* marker attrs
//      (same as the default loader wrap — selection sync still
//      uses these to identify shapes from clicks).
//   2. Reads gesture context. If there's an active per-shape
//      delta for this span, calls adapter.applyGesture(params,
//      delta) to get adjusted params, then renders the shape's
//      React component with those.
//
// The result: shapes are pure functions of (source params + active
// gesture delta). React handles re-rendering automatically. No
// imperative DOM mutation during gestures.

import { createElement, type ReactElement } from 'react';

import type { WrapShape, WrapShapeInput } from '../runtime/loader.js';
import type { ComponentRenderProps } from '../runtime/contract.js';

import { useShapeDelta } from './gesture-context.js';
import type { LayoutAdapter } from './layout-adapter.js';
import type { ShapeAdapter } from './shape-adapter.js';

function ShapeProjection(input: WrapShapeInput): ReactElement {
  const { comp, loaded, slots, params, cellKey } = input;
  // Accept either a ShapeAdapter (applyGesture required) or a
  // LayoutAdapter (applyGesture optional — only set when the layout
  // has a gesture that mutates its own params, e.g., gap-drag).
  const adapter = loaded.canvas as ShapeAdapter | LayoutAdapter | undefined;
  const delta = useShapeDelta({
    start: comp.span.start.offset,
    end: comp.span.end.offset,
  });
  const adjustedParams =
    adapter?.applyGesture && delta
      ? adapter.applyGesture(params, delta)
      : params;
  return createElement(
    'div',
    {
      key: `wrap-${comp.span.start.offset}`,
      'data-sw-component': comp.name,
      'data-sw-span-start': comp.span.start.offset,
      'data-sw-span-end': comp.span.end.offset,
      style: { display: 'contents' },
    },
    createElement(loaded.render, {
      slots: slots as ComponentRenderProps['slots'],
      params: adjustedParams,
      key: cellKey,
    }),
  );
}

// `wrapShape` plumbs through the loader. Returns a React element
// for each component invocation. We return a `<ShapeProjection>`
// element (not call it directly) so it appears in the React tree
// as a function component — required for hooks (useContext) to
// work.
export const wrapShape: WrapShape = (input) => {
  return createElement(ShapeProjection, {
    ...input,
    key: `wrap-${input.comp.span.start.offset}`,
  });
};
