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

import { measureLayoutSnapshot } from './layout-measurement.js';
import { createElement, useContext, useMemo, useRef, type ReactElement } from 'react';

import type { WrapShape, WrapShapeInput } from '../runtime/loader.js';
import { SourceLocationContext, useSourceAdapter, useSourceComponent } from '../runtime/source-location.js';
import type { ComponentRenderProps } from '../runtime/contract.js';
import { ComponentEditingContext } from '../runtime/component-editing.js';
import { ComponentEditHostContext } from './component-editing.js';

import { useShapeDelta, spanKey } from './gesture-context.js';
import { useComponentPreview } from './component-preview.js';
import type { LayoutAdapter } from './layout-adapter.js';
import type { ShapeAdapter } from './shape-adapter.js';
import { TextDocumentEditorContext, TextDocumentSessionContext } from './text-document-context.js';

function ShapeProjection(input: WrapShapeInput): ReactElement {
  const editHost = useContext(ComponentEditHostContext);
  const sourceLocation = useContext(SourceLocationContext);
  const currentComp = useSourceComponent(input.comp);
  const preview = useComponentPreview(spanKey({ start: currentComp.span.start.offset, end: currentComp.span.end.offset }));
  const { comp, loaded, slots, params, slotsState } = preview ?? { ...input, comp: currentComp };
  const { cellKey } = input;
  const session = useContext(TextDocumentSessionContext);
  const editor = session?.span.start === comp.span.start.offset && session.span.end === comp.span.end.offset ? session.editor : null;
  // Accept either a ShapeAdapter (applyGesture required) or a
  // LayoutAdapter (applyGesture optional — only set when the layout
  // has a gesture that mutates its own params, e.g., gap-drag).
  const currentAdapter = useSourceAdapter(comp, loaded.canvas);
  const adapter = (preview ? loaded.canvas : currentAdapter) as ShapeAdapter | LayoutAdapter | undefined;
  const delta = useShapeDelta({
    start: comp.span.start.offset,
    end: comp.span.end.offset,
  });
  // Freeze intrinsic size once so repeated preview renders do not compound
  // a transform against their own previous DOM dimensions.
  const originalSize = useRef<{ width: number; height: number } | null>(null);
  if (!delta) originalSize.current = null;
  if (delta && (adapter as ShapeAdapter | undefined)?.measureBounds && !originalSize.current) {
    const bounds = measureLayoutSnapshot({ start: comp.span.start.offset, end: comp.span.end.offset })?.layout;
    if (bounds) originalSize.current = bounds;
  }
  const gestureParams = originalSize.current ? { ...params, __measuredWidth: originalSize.current.width, __measuredHeight: originalSize.current.height } : params;
  const adjustedParams =
    adapter?.applyGesture && delta
      ? adapter.applyGesture(gestureParams, delta)
      : params;
  const defaults = editor ? session?.defaults : undefined;
  const rendered = useMemo(() => createElement(TextDocumentEditorContext.Provider, { value: editor },
    createElement(loaded.render, {
      slots: slots as ComponentRenderProps['slots'],
      params: defaults ? { ...adjustedParams, ...defaults } : adjustedParams,
      slotsState,
      key: cellKey,
    })), [loaded.render, slots, adjustedParams, slotsState, cellKey, editor, defaults]);
  return createElement(
    loaded.meta.produces === 'text' ? 'span' : 'div',
    {
      key: cellKey,
      'data-sw-component': comp.name,
      'data-sw-span-start': comp.span.start.offset,
      'data-sw-span-end': comp.span.end.offset,
      style: { display: 'contents' },
    },
    createElement(ComponentEditingContext.Provider, { value: preview ? null : editHost?.(currentComp) ?? null },
      createElement(SourceLocationContext.Provider, { value: preview ? null : sourceLocation }, rendered)),
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
