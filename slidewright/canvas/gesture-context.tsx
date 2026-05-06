// Gesture context — the React channel by which App's gesture state
// reaches the loader-wrapped shapes deep in the slide tree.
//
// During an active gesture, App holds a `Map<spanKey, ShapeDelta>`
// mapping each affected shape's source span to its per-shape
// delta. The map is published via this context. Each shape's
// ShapeProjection wrapper (in the loader's output) reads its own
// span's delta — if any — and passes it to the adapter's
// applyGesture.
//
// React's reconciliation handles everything else: setState on
// pointermove → context value changes → all consumers re-render →
// shapes re-render with adjusted params → selection visuals,
// handles, group bbox (also context-aware) re-render in lockstep.
// No imperative DOM mutation. No "we forgot to update X" sync gap.

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import type { ShapeDelta, ShapeSpan } from './shape-adapter.js';

// Stable string key for a span. Used as the Map key so two
// objects with the same {start, end} hit the same entry.
export function spanKey(span: ShapeSpan): string {
  return `${span.start}-${span.end}`;
}

interface GestureContextValue {
  deltas: ReadonlyMap<string, ShapeDelta>;
}

const EMPTY: GestureContextValue = { deltas: new Map() };

const GestureContext = createContext<GestureContextValue>(EMPTY);

export function GestureProvider({
  deltas,
  children,
}: {
  deltas: ReadonlyMap<string, ShapeDelta> | null;
  children: ReactNode;
}): ReactNode {
  // Stable identity for the empty-map case so a shape with no
  // gesture doesn't churn its context-derived state.
  const value = deltas && deltas.size > 0 ? { deltas } : EMPTY;
  return (
    <GestureContext.Provider value={value}>{children}</GestureContext.Provider>
  );
}

// Look up the current per-shape delta for a span, or null if no
// active gesture or this shape isn't a target.
export function useShapeDelta(span: ShapeSpan): ShapeDelta | null {
  const ctx = useContext(GestureContext);
  return ctx.deltas.get(spanKey(span)) ?? null;
}
