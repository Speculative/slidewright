// Low-level AST-node builders for use by component modules.
//
// Components export an `insertion.stub` factory (see contract.ts /
// ComponentMeta) that returns a fresh `Component` AST node when the
// toolbar inserts that component. The factory composes nodes from
// the helpers in this module rather than hand-rolling object
// literals. All nodes carry a zero span — they're not in any source
// yet; the canonical emitter assigns real spans after the splice
// round-trips through emit + reparse.
//
// This module sits in `runtime/` (not `canvas/`) because component
// modules import from `runtime/`, not `canvas/`. The canvas-side
// `ast-edits.ts` continues to host the higher-level mutators
// (`appendShapeToFreeform`, `removeShapeAtSpan`, path walking, etc.)
// that depend on canvas concepts.
//
// Helpers return nodes with `kind` set to the AST union's literal
// tag. The compiler enforces that callers don't construct
// ill-shaped nodes — this module is the only blessed path to
// well-typed AST construction from outside the parser.
//
// Helpers are intentionally narrow (one helper per literal kind +
// the two structural nodes `Component` / `SlotFill`). Composition
// happens at the call site so each component's stub reads like a
// transcription of the source it would produce.

import type {
  BooleanLit,
  ColorLit,
  Component,
  ListLit,
  NameRef,
  NullLit,
  NumberLit,
  OmitLit,
  Pos,
  SlotFill,
  Span,
  StringLit,
  Value,
} from './ast.js';

const ZERO_POS: Pos = { offset: 0, line: 0, column: 0 };
const ZERO_SPAN: Span = { start: ZERO_POS, end: ZERO_POS };

export function stringLit(value: string, multiline = false): StringLit {
  return { kind: 'string', value, multiline, span: ZERO_SPAN };
}

export function numberLit(value: number): NumberLit {
  return { kind: 'number', value, span: ZERO_SPAN };
}

export function booleanLit(value: boolean): BooleanLit {
  return { kind: 'boolean', value, span: ZERO_SPAN };
}

export function nullLit(): NullLit {
  return { kind: 'null', span: ZERO_SPAN };
}

export function omitLit(): OmitLit {
  return { kind: 'omit', span: ZERO_SPAN };
}

export function colorLit(l: number, c: number, h: number): ColorLit {
  return { kind: 'color_oklch', l, c, h, span: ZERO_SPAN };
}

export function listLit(items: Value[]): ListLit {
  return { kind: 'list', items, span: ZERO_SPAN };
}

export function nameRef(name: string): NameRef {
  return { kind: 'name_ref', name, span: ZERO_SPAN };
}

export function slotFill(name: string, value: Value): SlotFill {
  return { kind: 'slot_fill', name, value, span: ZERO_SPAN };
}

export function makeComponent(
  name: string,
  fills: SlotFill[],
  implicitChildren: Component[] = [],
): Component {
  return {
    kind: 'component',
    name,
    fills,
    implicitChildren,
    span: ZERO_SPAN,
    bodySpan: ZERO_SPAN,
  };
}
