// Revision-local bounded parsing. Existing complete components are safe lexer
// boundaries only while their enclosing context and both boundaries survive.
// Any uncertainty uses the ordinary full parser, including invalid input.
import type { Component, Span } from './ast.js';
import type { DocumentOccurrence, DocumentSnapshot, SourceMapping } from './document.js';
import { parse, type ParseResult } from './parser.js';
import { lineStarts, position } from './source-positions.js';

export interface ParseWork {
  fullParses: number;
  componentParses: number;
  parsedCharacters: number;
}
export interface DocumentParse extends ParseResult { parsing: ParseWork }

// Keep unchanged subtrees when their global positions do not move. Shifted
// trees are copied so earlier frozen snapshots retain accurate locations.
function relocate<T>(value: T, mapSpan: (span: Span) => Span, replacements = new Map<object, Component>()): T {
  if (!value || typeof value !== 'object') return value;
  const replacement = replacements.get(value);
  if (replacement) return replacement as T;
  if ('start' in value && 'end' in value && typeof value.start === 'object' && value.start && 'offset' in value.start) {
    return mapSpan(value as unknown as Span) as T;
  }
  const entries = Object.entries(value).map(([key, child]) => [key, relocate(child, mapSpan, replacements)] as const);
  if (entries.every(([key, child]) => child === (value as Record<string, unknown>)[key])) return value;
  return (Array.isArray(value) ? entries.map(([, child]) => child) : Object.fromEntries(entries)) as T;
}

export function parseDocument(source: string, file: string, before?: DocumentSnapshot, mapping?: SourceMapping): DocumentParse {
  const parsing: ParseWork = { fullParses: 0, componentParses: 0, parsedCharacters: 0 };
  const full = (): DocumentParse => {
    parsing.fullParses++;
    parsing.parsedCharacters += source.length;
    return { ...parse(source, file), parsing };
  };
  if (!before || !mapping || mapping.replacement || before.diagnostics.length || !mapping.changes.length) return full();

  const owners = new Set<DocumentOccurrence>();
  // Include every change, even pure insertions. Strict containment prevents
  // treating a boundary edit as a component-local lexical change.
  for (const change of mapping.changes) {
    const owner = before.occurrences.filter(item => item.range.start < change.start && item.range.end > change.end)
      .sort((a, b) => a.range.end - a.range.start - (b.range.end - b.range.start))[0];
    if (!owner) return full();
    owners.add(owner);
  }
  const roots = [...owners].filter(owner => ![...owners].some(other => other !== owner &&
    other.range.start <= owner.range.start && other.range.end >= owner.range.end));
  // Parsing a top-level component amounts to parsing the deck. Keep that path
  // explicit instead of reporting a whole-deck parse as a bounded success.
  if (roots.some(owner => owner.parent === null)) return full();

  const starts = lineStarts(source);
  const spanAt = (span: Span, from: number, to: number): Span => {
    const start = position(starts, from);
    const end = position(starts, to);
    return start.offset === span.start.offset && start.line === span.start.line && start.column === span.start.column &&
      end.offset === span.end.offset && end.line === span.end.line && end.column === span.end.column ? span : { start, end };
  };
  const mapOld = (span: Span): Span => {
    const range = mapping.mapRange({ start: span.start.offset, end: span.end.offset });
    if (!range) throw new Error('Location crosses a bounded parse boundary');
    return spanAt(span, range.start, range.end);
  };
  const replacements = new Map<object, Component>();
  for (const owner of roots) {
    const range = mapping.mapRange(owner.range);
    if (!range) return full();
    const fragment = source.slice(range.start, range.end);
    parsing.componentParses++;
    parsing.parsedCharacters += fragment.length;
    const parsed = parse(fragment, file);
    const component = parsed.ast.items[0];
    if (parsed.diagnostics.length || parsed.ast.items.length !== 1 || !component ||
        component.span.start.offset !== 0 || component.span.end.offset !== fragment.length) return full();
    const replacement = relocate(component, span => spanAt(span, range.start + span.start.offset, range.start + span.end.offset));
    // Leading trivia belongs to the surrounding grammar, outside this slice.
    // Preserve its original attachment and relocate it with the rest of the AST.
    if (owner.component.leadingComments) replacement.leadingComments = [...relocate(owner.component.leadingComments, mapOld)];
    replacements.set(owner.component, replacement);
  }
  try {
    return { ast: relocate(before.ast, mapOld, replacements) as ParseResult['ast'], diagnostics: [], parsing };
  } catch {
    // Recovery must never publish a mixture of obsolete and current positions.
    return full();
  }
}
