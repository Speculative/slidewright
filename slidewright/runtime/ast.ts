// Slidewright AST node shapes. The hand-rolled parser
// (slidewright/runtime/parser.ts) produces these; the renderer and
// validator consume them. Shapes track grammar.js (the spec-of-record).

export type Pos = { offset: number; line: number; column: number };
export type Span = { start: Pos; end: Pos };

// Comment trivia attached to AST nodes. The parser collects comment
// tokens (skipped at lex time prior to v0.2.d) and attaches them as
// leading or trailing on adjacent nodes per SLIDEWRIGHT.md / Comments:
//   - Comments above a node → leading of that node.
//   - Comments after the last child of a parent → trailing of the
//     parent (emitted before the closing `}` / `]`).
// Same-line trailing comments aren't yet distinguished — they'd
// currently be attached as leading of the next sibling. Cosmetic
// regression in those cases; structural round-trip still holds.
export interface Comment {
  kind: 'line' | 'block';
  // Full text including delimiters (`//...` or `/* ... */`). Emitted
  // verbatim by the canonical formatter.
  text: string;
  span: Span;
}

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
  leadingComments?: Comment[];
  trailingComments?: Comment[];
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
  leadingComments?: Comment[];
  trailingComments?: Comment[];
}

export interface SlotFill {
  kind: 'slot_fill';
  name: string;
  value: Value;
  span: Span;
  leadingComments?: Comment[];
  trailingComments?: Comment[];
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
