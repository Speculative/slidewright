// SelectionTarget — discriminated union for the canvas selection model.
//
// Today the canvas can select four kinds of things:
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
//   - **empty slots** — a named slot on a component with no fill
//     in source. No own span (there's no SlotFill node yet).
//     Identity is `(parentSpan, slotName)`. Editor surfaces these
//     as placeholders so users can click into them; commits that
//     fill an empty slot materialize a SlotFill in the parent's
//     body.
//   - **slide** — the active slide as an implicit container. Has
//     no span (the slide is the active-index abstraction, not a
//     fixed node); the inspector reads `slidesData[activeIdx]`
//     when this kind is selected. Selection-layer does not draw an
//     outline for slide targets — the slide is the canvas itself,
//     not a thing within the canvas. Also serves as the default
//     inspector context when nothing else is selected.
//
// Selection state is `SelectionTarget[]` (multi-select supported
// for components; slot / empty-slot selections are single-only by
// current scope). Host.sendSelection still takes plain SourceRange
// for filled targets; empty-slot selections don't sync to the
// editor pane (no source span to put a cursor at).

import type { SlotType } from '../runtime/contract.js';
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
    }
  | {
      kind: 'empty-slot';
      // Parent component's source span (identity + commit target).
      parentSpan: SourceRange;
      // Slot name within the parent's schema.
      slotName: string;
      // Slot's declared type — carried on the target so the canvas
      // dblclick handler can route by type without re-resolving the
      // parent's schema (text → materialize-and-edit; others → no-op
      // for now, deferred to slot-targeted insertion).
      slotType: SlotType;
    }
  | { kind: 'slide' };

// Two targets refer to the same selectable thing? Component
// targets compare by span; slot / empty-slot targets compare by
// the (parentSpan, slotName) pair — the slot's own span (when it
// has one) is derived from the same pair, so the (parent, name)
// comparison is the canonical identity for both.
export function selectionTargetsEqual(
  a: SelectionTarget,
  b: SelectionTarget,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'component' && b.kind === 'component') {
    return a.span.start === b.span.start && a.span.end === b.span.end;
  }
  if (
    (a.kind === 'slot' || a.kind === 'empty-slot') &&
    (b.kind === 'slot' || b.kind === 'empty-slot')
  ) {
    return (
      a.parentSpan.start === b.parentSpan.start &&
      a.parentSpan.end === b.parentSpan.end &&
      a.slotName === b.slotName
    );
  }
  if (a.kind === 'slide' && b.kind === 'slide') return true;
  return false;
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

export function slideTarget(): SelectionTarget {
  return { kind: 'slide' };
}
