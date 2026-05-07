// SelectionTarget — discriminated union for the canvas selection model.
//
// Today the canvas can select two kinds of things:
//   - **components** — a Slidewright component invocation (Box,
//     VStack, CardRow, etc.). The selection's span is the
//     component's source span; the selection's behavior comes from
//     the component's `canvas` export (ShapeAdapter / LayoutAdapter
//     methods, inspector params).
//   - **slots** — a named slot fill on a component (e.g.,
//     CardRow.body, VStack.children). The selection's span is the
//     SlotFill node's source span; the selection identifies the
//     SLOT (the editing target), distinct from the value that
//     fills it. Slot selections enable operations like "replace
//     this slot's content" or "insert into this list slot."
//
// Selection state is `SelectionTarget[]` (multi-select supported
// for components; slot selections are single-only by current
// scope). Host.sendSelection still takes plain SourceRange — the
// host doesn't need to know about kinds.

import type { SourceRange } from './host.js';

export type SelectionTarget =
  | { kind: 'component'; span: SourceRange }
  | {
      kind: 'slot';
      // The SlotFill node's source span (covers `name: value` in
      // source). Used as the selection identity + for sendSelection
      // to the editor pane.
      span: SourceRange;
      // The parent component's source span. Lookup target for the
      // parent in the shapes registry / the AST when the slot's
      // commits need to mutate the parent.
      parentSpan: SourceRange;
      // The slot's name within the parent's schema. Combined with
      // parentSpan + the parent's slidewright metadata gives us
      // the slot's type for inspector rendering.
      slotName: string;
    };

// Two targets refer to the same selectable thing? Component
// targets compare by span; slot targets compare by the (parent,
// name) pair (the span is derived from those, so it's equivalent
// to compare any of the three).
export function selectionTargetsEqual(
  a: SelectionTarget,
  b: SelectionTarget,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.span.start !== b.span.start || a.span.end !== b.span.end) return false;
  if (a.kind === 'slot' && b.kind === 'slot') {
    return (
      a.parentSpan.start === b.parentSpan.start &&
      a.parentSpan.end === b.parentSpan.end &&
      a.slotName === b.slotName
    );
  }
  return true;
}

// Index of a target in a list, or -1 if not present.
export function findTargetIndex(
  targets: ReadonlyArray<SelectionTarget>,
  target: SelectionTarget,
): number {
  for (let i = 0; i < targets.length; i++) {
    if (selectionTargetsEqual(targets[i]!, target)) return i;
  }
  return -1;
}

// Convenience: build a component target from a SourceRange. Used
// at the many call sites that previously constructed bare
// SourceRanges into the selection state.
export function componentTarget(span: SourceRange): SelectionTarget {
  return { kind: 'component', span };
}
