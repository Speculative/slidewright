// Lower mutable AST edits to source splices. Unchanged authored nodes retain
// their original spelling, whitespace, comments and string boundaries. This
// writer owns no document state; its baseline is the parsed source revision.
import type { Comment, Node, SourceFile, Value } from '../runtime/ast.js';
import { tokenize } from '../runtime/lexer.js';
import { emitValue } from '../runtime/emitter.js';
import { sourceChanges, type SourceChange } from '../runtime/document.js';

const semantic = (node: unknown): string => JSON.stringify(node, (key, value) => {
  if (key === 'span' || key === 'bodySpan' ||
      ((key === 'leadingComments' || key === 'trailingComments') && !value?.length)) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  }
  return value;
});
const same = (a: unknown, b: unknown): boolean => semantic(a) === semantic(b);
const indent = (level: number): string => '  '.repeat(level);
const leading = (node: Node): readonly Comment[] | undefined => 'leadingComments' in node ? node.leadingComments : undefined;

function children(node: Node): Node[] {
  switch (node.kind) {
    case 'source_file': return node.items;
    case 'component': return [...node.fills, ...node.implicitChildren];
    case 'slot_fill': return [node.value];
    case 'list': return node.items;
    default: return [];
  }
}
function apply(source: string, changes: readonly SourceChange[], base = 0): string {
  let output = '';
  let cursor = 0;
  for (const change of changes) {
    const start = change.start - base;
    const end = change.end - base;
    if (start < cursor || end < start || end > source.length) throw new Error('Overlapping authored source edits');
    output += source.slice(cursor, start) + change.insert;
    cursor = end;
  }
  return output + source.slice(cursor);
}

export class SourceEditWriter {
  private readonly before: SourceFile;
  private readonly origins = new WeakMap<Node, Node>();
  private readonly spans = new Map<string, Node>();
  constructor(private readonly source: string, ast: SourceFile) {
    this.before = structuredClone(ast);
    const remember = (node: Node, before: Node): void => {
      this.origins.set(node, before);
      this.spans.set(this.key(before), before);
      const oldChildren = children(before);
      children(node).forEach((child, index) => remember(child, oldChildren[index]!));
    };
    remember(ast, this.before);
  }

  write(ast: SourceFile): { newSource: string; changes: SourceChange[] } {
    const changes: SourceChange[] = [];
    for (const change of this.diff(this.before, ast, 0).sort((a, b) => a.start - b.start)) {
      const previous = changes.at(-1);
      if (previous && change.start === previous.end) {
        changes[changes.length - 1] = { start: previous.start, end: change.end, insert: previous.insert + change.insert };
      } else changes.push(change);
    }
    return { newSource: apply(this.source, changes), changes };
  }

  private key(node: Node): string { return `${node.kind}:${node.span.start.offset}:${node.span.end.offset}`; }
  private origin(node: Node): Node | undefined {
    const authored = this.origins.get(node);
    if (authored) return authored;
    // A duplicated subtree may be a deep clone. Reuse its authored bytes only
    // when the entire semantic value still matches; never trust a copied span.
    const candidate = this.spans.get(this.key(node));
    return candidate && same(candidate, node) ? candidate : undefined;
  }
  private start(node: Node, includeLeading: boolean): number {
    return includeLeading && leading(node)?.length
      ? Math.min(node.span.start.offset, ...leading(node)!.map(comment => comment.span.start.offset))
      : node.span.start.offset;
  }
  private pairable(before: readonly Node[], after: readonly Node[]): boolean {
    return before.length === after.length && after.every((node, index) =>
      !this.origins.has(node) || this.origins.get(node) === before[index]);
  }
  private patch(before: Node, text: string, includeLeading: boolean): SourceChange[] {
    const start = this.start(before, includeLeading);
    return sourceChanges(this.source.slice(start, before.span.end.offset), text)
      .map(change => ({ ...change, start: change.start + start, end: change.end + start }));
  }

  private diff(before: Node, after: Node, level: number, includeLeading = true): SourceChange[] {
    if (same(before, after)) return [];
    if (includeLeading && !same(leading(before), leading(after))) {
      return this.patch(before, this.withLeading(after, level), true);
    }
    if (before.kind === 'source_file' && after.kind === 'source_file' &&
        same(before.trailingComments, after.trailingComments)) {
      return this.sequence(before.items, after.items, 0, before.span.start.offset);
    }
    if (before.kind === 'component' && after.kind === 'component' && before.name === after.name &&
        same(before.trailingComments, after.trailingComments) &&
        before.fills.length === after.fills.length && before.fills.every((fill, i) => fill.name === after.fills[i]!.name) &&
        this.pairable(before.implicitChildren, after.implicitChildren)) {
      return [
        ...before.fills.flatMap((fill, index) => this.diff(fill, after.fills[index]!, level + 1)),
        ...before.implicitChildren.flatMap((node, index) => this.diff(node, after.implicitChildren[index]!, level + 1)),
      ];
    }
    if (before.kind === 'component' && after.kind === 'component' && before.name === after.name &&
        same(before.trailingComments, after.trailingComments)) {
      return this.sequence([...before.fills, ...before.implicitChildren],
        [...after.fills, ...after.implicitChildren], level + 1, before.bodySpan.start.offset + 1);
    }
    if (before.kind === 'slot_fill' && after.kind === 'slot_fill' && before.name === after.name) {
      return this.diff(before.value, after.value, level);
    }
    if (before.kind === 'list' && after.kind === 'list') {
      if (this.pairable(before.items, after.items)) {
        return before.items.flatMap((node, index) => this.diff(node, after.items[index]!, level + 1));
      }
      return this.sequence(before.items, after.items, level + 1, before.span.start.offset + 1);
    }
    return this.patch(before, includeLeading ? this.withLeading(after, level) : this.fresh(after, level), includeLeading);
  }

  // Keep a longest ordered subsequence of authored entries as anchors. Edits
  // occupy only the gaps between them, so insertions, disjoint deletions and
  // reorders retain stationary owners instead of replacing a whole list/body.
  private sequence(before: readonly Node[], after: readonly Node[], level: number, opening: number): SourceChange[] {
    const indices = new Map(before.map((node, index) => [node, index]));
    const candidates = after.flatMap((node, to) => {
      const original = this.origins.get(node);
      const from = original && indices.get(original);
      return from === undefined ? [] : [{ from, to }];
    });
    const tails: number[] = [];
    const previous: number[] = [];
    candidates.forEach((candidate, index) => {
      let low = 0;
      let high = tails.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (candidates[tails[mid]!]!.from < candidate.from) low = mid + 1;
        else high = mid;
      }
      previous[index] = low ? tails[low - 1]! : -1;
      tails[low] = index;
    });
    const anchors: { from: number; to: number }[] = [];
    for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) anchors.push(candidates[index]!);
    anchors.reverse();
    anchors.push({ from: before.length, to: after.length });
    let from = 0;
    let to = 0;
    let left: Node | undefined;
    const changes: SourceChange[] = [];
    const simple = (node: Node | undefined) => node?.kind === 'string' && !node.multiline;
    const comma = (trivia: string) => tokenize(trivia, '<source-trivia>').tokens.some(token => token.kind === 'comma');
    for (const anchor of anchors) {
      const removed = before.slice(from, anchor.from);
      const added = after.slice(to, anchor.to);
      const right = before[anchor.from];
      if (removed.length || added.length) {
        const start = removed.length ? this.start(removed[0]!, true)
          : right ? this.start(right, true) : left?.span.end.offset ?? opening;
        const end = removed.at(-1)?.span.end.offset ?? start;
        const rightStart = right ? this.start(right, true) : end;
        const prefix = left ? this.source.slice(left.span.end.offset, start) : '';
        const suffix = this.source.slice(end, rightStart);
        let insert = '';
        if (added.length) {
          if (simple(left) && simple(added[0]) && !comma(prefix)) insert += ',';
          if (!removed.length && !right) insert += `\n${indent(level)}`;
          insert += added.map((node, index) => this.withLeading(node, level) +
            (simple(node) && simple(added[index + 1]) ? ',' : '')).join(`\n${indent(level)}`);
          if (simple(added.at(-1)) && simple(right) && !comma(suffix)) insert += ',';
          const offset = right ? this.start(right, true) : -1;
          const rawIndent = offset < 0 ? '' : this.source.slice(this.source.lastIndexOf('\n', offset - 1) + 1, offset);
          insert += `\n${right && /^[ \t]*$/.test(rawIndent) ? rawIndent : indent(Math.max(0, level - 1))}`;
        } else if (simple(left) && simple(right) && !comma(prefix + suffix)) insert = ',';
        for (const change of sourceChanges(this.source.slice(start, end), insert)) {
          changes.push({ ...change, start: change.start + start, end: change.end + start });
        }
      }
      if (right) changes.push(...this.diff(right, after[anchor.to]!, level));
      left = right;
      from = anchor.from + 1;
      to = anchor.to + 1;
    }
    return changes;
  }

  private bare(node: Node, level: number): string {
    const before = this.origin(node);
    if (!before) return this.fresh(node, level);
    const start = before.span.start.offset;
    const source = this.source.slice(start, before.span.end.offset);
    return apply(source, this.diff(before, node, level, false).sort((a, b) => a.start - b.start), start);
  }
  private withLeading(node: Node, level: number): string {
    const before = this.origin(node);
    let prefix = '';
    if (before && same(leading(before), leading(node))) {
      prefix = this.source.slice(this.start(before, true), before.span.start.offset);
    } else if (leading(node)?.length) {
      prefix = leading(node)!.map(comment => comment.text).join(`\n${indent(level)}`) + `\n${indent(level)}`;
    }
    return prefix + this.bare(node, level);
  }
  private fresh(node: Node, level: number): string {
    switch (node.kind) {
      case 'source_file': {
        const parts = node.items.map(item => this.withLeading(item, 0));
        if (node.trailingComments?.length) parts.push(node.trailingComments.map(comment => comment.text).join('\n'));
        return parts.join('\n\n') + (parts.length ? '\n' : '');
      }
      case 'component': {
        if (!node.fills.length && !node.implicitChildren.length && !node.trailingComments?.length) return `${node.name} {}`;
        const lines = [
          ...node.fills.map(fill => indent(level + 1) + this.withLeading(fill, level + 1)),
          ...node.implicitChildren.map(child => indent(level + 1) + this.withLeading(child, level + 1)),
          ...(node.trailingComments ?? []).map(comment => indent(level + 1) + comment.text),
        ];
        return `${node.name} {\n${lines.join('\n')}\n${indent(level)}}`;
      }
      case 'slot_fill': return `${node.name}: ${this.bare(node.value, level)}`;
      case 'list': {
        if (!node.items.length) return '[]';
        return `[\n${node.items.map((item, index) => {
          const next = node.items[index + 1];
          const separator = item.kind === 'string' && !item.multiline && next?.kind === 'string' && !next.multiline ? ',' : '';
          return indent(level + 1) + this.withLeading(item, level + 1) + separator;
        }).join('\n')}\n${indent(level)}]`;
      }
      default: return emitValue(node as Value, level);
    }
  }
}

export function sameAuthoredValue(before: unknown, after: unknown): boolean { return same(before, after); }
