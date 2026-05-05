// Slidewright AST node shapes. The hand-rolled parser
// (slidewright/runtime/parser.ts) produces these; the renderer and
// validator consume them. Shapes track grammar.js (the spec-of-record).

export type Pos = { offset: number; line: number; column: number };
export type Span = { start: Pos; end: Pos };

export type Node =
  | SourceFile
  | Component
  | SlotFill
  | Value;

export type Value =
  | StringLit
  | NumberLit
  | BooleanLit
  | NullLit
  | ListLit
  | NameRef
  | Component;

export interface SourceFile {
  kind: 'source_file';
  items: Component[];
  span: Span;
}

export interface Component {
  kind: 'component';
  name: string;
  fills: SlotFill[];
  implicitChildren: Component[];
  span: Span;
  // Source span of the brace body (for diagnostics that need to point at
  // the body specifically rather than the whole component).
  bodySpan: Span;
}

export interface SlotFill {
  kind: 'slot_fill';
  name: string;
  value: Value;
  span: Span;
}

export interface StringLit {
  kind: 'string';
  value: string;
  multiline: boolean;
  span: Span;
}

export interface NumberLit {
  kind: 'number';
  value: number;
  span: Span;
}

export interface BooleanLit {
  kind: 'boolean';
  value: boolean;
  span: Span;
}

export interface NullLit {
  kind: 'null';
  span: Span;
}

export interface ListLit {
  kind: 'list';
  items: Value[];
  span: Span;
}

export interface NameRef {
  kind: 'name_ref';
  name: string;
  span: Span;
}
