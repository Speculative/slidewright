// Canonical emitter — walks an AST and produces brace-block source
// per SLIDEWRIGHT.md / Round-trip discipline. Output is deterministic
// from the AST: a given tree always produces the same string.
//
// Conventions:
//   - 2-space indent per nesting level.
//   - Component / list bodies are multi-line (one item per line).
//   - Empty bodies stay inline: `Foo {}`, `[]`.
//   - Top-level components separated by a blank line.
//   - Simple strings emitted via JSON.stringify (handles escaping).
//   - Triple-quoted strings re-indented to (level + 1) spaces; the
//     value comes from the lexer post-dedent, so emit + parse is a
//     fixed point.
//
// Comments (v0.2.d): `leadingComments` are emitted on their own
// line(s) before the node; `trailingComments` (end-of-block, from
// the parser's pendingLeading drained at `}` / EOF) are emitted
// inside the body before the closing brace. Same-line trailing
// comments aren't yet distinguished from leading-of-next-sibling —
// cosmetic regression in those cases; structural round-trip holds.

import type {
  Comment,
  Component,
  ListLit,
  SlotFill,
  SourceFile,
  Value,
} from './ast.js';

const INDENT_STEP = 2;

function indent(level: number): string {
  return ' '.repeat(level * INDENT_STEP);
}

function emitCommentLine(comment: Comment, level: number): string {
  return `${indent(level)}${comment.text}`;
}

function emitLeadingComments(
  comments: readonly Comment[] | undefined,
  level: number,
): string {
  if (!comments || comments.length === 0) return '';
  return comments.map((c) => emitCommentLine(c, level)).join('\n') + '\n';
}

function emitTrailingComments(
  comments: readonly Comment[] | undefined,
  level: number,
): string {
  if (!comments || comments.length === 0) return '';
  // Trailing-of-parent comments live inside the brace body, indented
  // to the body's level rather than the parent's. Caller (emitComponent
  // / emitListInline) provides the inner indent level.
  return comments.map((c) => emitCommentLine(c, level)).join('\n') + '\n';
}

export function emit(file: SourceFile): string {
  const parts: string[] = [];
  if (file.items.length === 0) {
    // Edge case: comment-only file. Emit comments and nothing else.
    parts.push(emitLeadingComments(file.leadingComments, 0).trimEnd());
    parts.push(emitLeadingComments(file.trailingComments, 0).trimEnd());
    return parts.filter((p) => p.length > 0).join('\n') + (parts.some((p) => p.length > 0) ? '\n' : '');
  }
  // Top-level: each component (with its own leading comments) goes
  // on its own block, separated by blank lines.
  parts.push(file.items.map((c) => emitComponent(c, 0)).join('\n\n'));
  if (file.trailingComments && file.trailingComments.length > 0) {
    parts.push(file.trailingComments.map((c) => emitCommentLine(c, 0)).join('\n'));
  }
  return parts.join('\n\n') + '\n';
}

// `emit*Inline` returns text whose first line carries no leading
// indent (the caller positions it on a `name: ` line, after a `[`,
// etc.) but whose later lines have absolute indent baked in.
// `emit*` adds the leading indent itself. Splitting these two roles
// keeps the recursion clean.

function emitComponent(comp: Component, level: number): string {
  const lead = emitLeadingComments(comp.leadingComments, level);
  return `${lead}${indent(level)}${emitComponentInline(comp, level)}`;
}

function emitComponentInline(comp: Component, level: number): string {
  const hasFills = comp.fills.length > 0;
  const hasChildren = comp.implicitChildren.length > 0;
  const hasTrailing =
    comp.trailingComments !== undefined && comp.trailingComments.length > 0;
  if (!hasFills && !hasChildren && !hasTrailing) {
    return `${comp.name} {}`;
  }
  const lines: string[] = [`${comp.name} {`];
  for (const fill of comp.fills) {
    lines.push(emitSlotFill(fill, level + 1));
  }
  for (const child of comp.implicitChildren) {
    lines.push(emitComponent(child, level + 1));
  }
  if (comp.trailingComments) {
    for (const c of comp.trailingComments) {
      lines.push(emitCommentLine(c, level + 1));
    }
  }
  lines.push(`${indent(level)}}`);
  return lines.join('\n');
}

function emitSlotFill(fill: SlotFill, level: number): string {
  const lead = emitLeadingComments(fill.leadingComments, level);
  return `${lead}${indent(level)}${fill.name}: ${emitValueInline(fill.value, level)}`;
}

function emitValueInline(value: Value, level: number): string {
  switch (value.kind) {
    case 'string':
      return value.multiline
        ? emitMultilineString(value.value, level)
        : JSON.stringify(value.value);
    case 'number':
      return String(value.value);
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'omit':
      return 'omit';
    case 'name_ref':
      return value.name;
    case 'list':
      return emitListInline(value, level);
    case 'component':
      return emitComponentInline(value, level);
  }
}

function emitListInline(list: ListLit, level: number): string {
  if (list.items.length === 0) return '[]';
  const lines: string[] = ['['];
  for (const item of list.items) {
    lines.push(`${indent(level + 1)}${emitValueInline(item, level + 1)}`);
  }
  lines.push(`${indent(level)}]`);
  return lines.join('\n');
}

function emitMultilineString(value: string, level: number): string {
  const inner = indent(level + 1);
  const close = indent(level);
  // Empty lines stay empty (no trailing whitespace) — matches the
  // lexer's dedent which strips the common leading indent from
  // non-empty lines and leaves empty lines as-is.
  const body = value
    .split('\n')
    .map((l) => (l.length > 0 ? `${inner}${l}` : ''))
    .join('\n');
  return `"""\n${body}\n${close}"""`;
}
