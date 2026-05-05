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
// Comments aren't preserved yet — the parser currently skips them
// rather than attaching them to AST nodes. That work lands in a
// follow-up (v0.2.d). Until then, this emitter is exercised by
// property tests and is NOT used by the text-edit gesture (which
// continues to splice into the source string to keep comments).

import type {
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

export function emit(file: SourceFile): string {
  if (file.items.length === 0) return '';
  return file.items.map((c) => emitComponent(c, 0)).join('\n\n') + '\n';
}

// `emit*Inline` returns text whose first line carries no leading
// indent (the caller positions it on a `name: ` line, after a `[`,
// etc.) but whose later lines have absolute indent baked in.
// `emit*` adds the leading indent itself. Splitting these two roles
// keeps the recursion clean.

function emitComponent(comp: Component, level: number): string {
  return `${indent(level)}${emitComponentInline(comp, level)}`;
}

function emitComponentInline(comp: Component, level: number): string {
  if (comp.fills.length === 0 && comp.implicitChildren.length === 0) {
    return `${comp.name} {}`;
  }
  const lines: string[] = [`${comp.name} {`];
  for (const fill of comp.fills) {
    lines.push(emitSlotFill(fill, level + 1));
  }
  for (const child of comp.implicitChildren) {
    lines.push(emitComponent(child, level + 1));
  }
  lines.push(`${indent(level)}}`);
  return lines.join('\n');
}

function emitSlotFill(fill: SlotFill, level: number): string {
  return `${indent(level)}${fill.name}: ${emitValueInline(fill.value, level)}`;
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
