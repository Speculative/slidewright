// Layout-component canvas metadata.
//
// Layouts (HStack, VStack, future Grid / ZStack) participate in the
// canvas as selectable + inspectable components, but their position
// and bounds are determined by parent layout — not by params alone
// — so they can't satisfy the ShapeAdapter contract's
// `calculateBounds(params)` requirement. A small discriminator type
// gets them into the loader's shapes registry alongside ShapeAdapter
// entries; consumers branch on `kind` at the use site.
//
// Tight cut: just selection + inspector. The framework DOM-measures
// bounds for layouts; no Handles, no applyGesture, no commit. The
// type stays sparse on purpose — it grows when the immediate-
// follow-up reorder + the wider-cut gap-drag / insertion gestures
// pin down what a real LayoutAdapter actually needs.

export interface LayoutMeta {
  kind: 'layout';
}

// Type guard. Use at any site that pulls `data.canvas` from the
// shapes registry to discriminate shape vs. layout entries.
export function isLayoutMeta(canvas: unknown): canvas is LayoutMeta {
  return (
    typeof canvas === 'object' &&
    canvas !== null &&
    (canvas as { kind?: unknown }).kind === 'layout'
  );
}
