import { PARAGRAPH_FIELDS } from '../../runtime/contract.js';
// Private ProseMirror adapter. Public registry/source contracts contain
// no ProseMirror types or positions. The authored AST is never mutated.
import { Fragment, Schema, type Mark, type MarkSpec, type Node as PMNode, type NodeSpec } from 'prosemirror-model';
import type { Component, Value } from '../../runtime/ast.js';
import type { ComponentRegistry } from '../../runtime/contract.js';
import type { Scope } from '../../runtime/scope.js';
import { listLit, makeComponent, nameRef, numberLit, slotFill, stringLit, booleanLit } from '../../runtime/ast-builders.js';
import { parse } from '../../runtime/parser.js';
import { emit } from '../../runtime/emitter.js';
import type { TextOrigin, TextValuePath } from './bindings.js';

export const STYLE_FIELDS = ['strokeWidth', 'strokeColor', 'color', 'font', 'size', 'weight', 'letterSpacing', 'italic', 'underline', 'strikethrough', 'href'] as const;
type StyleField = typeof STYLE_FIELDS[number];
type StyleValue = { value: string | number | boolean; authored: Value | null };
type Styles = Partial<Record<StyleField, StyleValue>>;
type Bound = TextOrigin & { projected?: PMNode | Fragment; styles?: Styles };
const orderedStyles = new Set(['decimal', 'decimal-leading-zero', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman']);
const blockBuiltins = new Set(['Paragraph', 'List', 'ListItem', 'Deck', 'Slide', 'Tokens']);
const fillValue = (comp: Component, name: string): Value | undefined => comp.fills.find(f => f.name === name)?.value;
const scalar = (v: Value | undefined, fallback: string | number | boolean): string | number | boolean =>
  v?.kind === 'string' || v?.kind === 'number' || v?.kind === 'boolean' ? v.value : v?.kind === 'name_ref' ? v.name : fallback;

function sameItems(before: Value | undefined, values: Value[]): boolean {
  return before?.kind === 'list' && before.items.length === values.length && before.items.every((v, i) => v === values[i]);
}
function inlineValue(before: Value | undefined, values: Value[]): Value {
  if (sameItems(before, values)) return before!;
  if (before && before.kind !== 'list' && values.length === 1) return values[0]!;
  return listLit(values);
}
function setFill(comp: Component, name: string, value: Value | undefined): Component {
  const old = comp.fills.find(f => f.name === name);
  if (old?.value === value || (!old && !value)) return comp;
  return {
    ...comp,
    fills: value
      ? old ? comp.fills.map(f => f === old ? { ...f, value } : f) : [...comp.fills, slotFill(name, value)]
      : comp.fills.filter(f => f !== old),
  };
}
function signature(styles: Styles): string {
  return JSON.stringify(STYLE_FIELDS.flatMap(name => styles[name] ? [[name, styles[name]!.value]] : []));
}
function styleDOM(name: StyleField, value: string | number | boolean): Record<string, string> {
  switch (name) {
    case 'strokeWidth': return { style: `-webkit-text-stroke-width:${value}px` };
    case 'strokeColor': return { style: `-webkit-text-stroke-color:${value}` };
    case 'color': return { style: `color:${value}` };
    case 'font': return { style: `font-family:${['body', 'display', 'mono'].includes(String(value)) ? `var(--font-${value})` : value}` };
    case 'size': return { style: `font-size:${value}px` };
    case 'weight': return { style: `font-weight:${value}` };
    case 'letterSpacing': return { style: `letter-spacing:${value}px` };
    case 'italic': return { style: `font-style:${value ? 'italic' : 'normal'}` };
    case 'underline': return { style: `text-decoration-line:${value ? 'underline' : 'none'}` };
    case 'strikethrough': return { style: `text-decoration-line:${value ? 'line-through' : 'none'}` };
    case 'href': return { href: String(value) };
  }
}
function componentSource(comp: Component): string {
  return emit({ kind: 'source_file', items: [comp], span: comp.span });
}
function clipboardComponent(dom: HTMLElement, expected?: string): Component | null {
  const result = parse(dom.getAttribute('data-sw-inline-source') ?? '', '<inline-clipboard>');
  const comp = result.ast.items[0];
  return result.diagnostics.some(d => d.severity === 'error') || result.ast.items.length !== 1 || !comp || (expected && comp.name !== expected) ? null : comp;
}

export interface ProjectionInput {
  content?: Value;
  registry: ComponentRegistry;
  scope?: Scope;
  colorTokens?: Record<string, string>;
}

export class TextProjection {
  readonly schema: Schema;
  readonly doc: PMNode;
  readonly origins = new Map<string, Bound>();
  private nextId = 0;
  private inlineTypes = new Map<string, string>();

  constructor(private input: ProjectionInput) {
    const origin = { origin: { default: null } };
    const listAttrs = { ...origin, style: { default: 'disc' }, start: { default: 1 } };
    const nodes: Record<string, NodeSpec> = {
      doc: { content: 'block+' },
      paragraph: {
        group: 'block', content: 'inline*',
        attrs: { ...origin, spaceBefore: { default: 0 }, spaceAfter: { default: 0 }, align: { default: null }, lineHeight: { default: null }, indent: { default: 0 }, firstLineIndent: { default: 0 } },
        parseDOM: [{ tag: 'p', getAttrs: dom => ({
          spaceBefore: parseFloat(dom.style.marginTop) || 0,
          indent: parseFloat(dom.style.marginLeft) || 0,
          firstLineIndent: parseFloat(dom.style.textIndent) || 0,
          spaceAfter: parseFloat(dom.style.marginBottom) || 0,
          align: dom.style.textAlign || null,
          lineHeight: parseFloat(dom.style.lineHeight) || null,
        }) }],
        toDOM: node => ['p', { style: `margin:${node.attrs.spaceBefore}px 0 ${node.attrs.spaceAfter}px ${node.attrs.indent}px;text-indent:${node.attrs.firstLineIndent}px;${node.attrs.align ? `text-align:${node.attrs.align};` : ''}${node.attrs.lineHeight ? `line-height:${node.attrs.lineHeight};` : ''}` }, 0],
      },
      bullet_list: { group: 'block', content: 'list_item+', attrs: listAttrs, parseDOM: [{ tag: 'ul' }], toDOM: node => ['ul', { style: `margin:0;padding-inline-start:1.35em;list-style-type:${node.attrs.style}` }, 0] },
      ordered_list: { group: 'block', content: 'list_item+', attrs: { ...listAttrs, style: { default: 'decimal' } }, parseDOM: [{ tag: 'ol', getAttrs: dom => ({ start: Number(dom.getAttribute('start') ?? 1), style: dom.style.listStyleType || 'decimal' }) }], toDOM: node => ['ol', { start: node.attrs.start, style: `margin:0;padding-inline-start:1.35em;list-style-type:${node.attrs.style}` }, 0] },
      // The DSL has inline item content and one optional nested list.
      // Do not admit arbitrary blocks and flatten them during lowering.
      list_item: { content: 'paragraph (bullet_list | ordered_list)?', defining: true, attrs: origin, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
      text: { group: 'inline' },
      hard_break: { inline: true, group: 'inline', selectable: false, toDOM: () => ['br'], parseDOM: [{ tag: 'br' }] },
      reference: {
        inline: true, group: 'inline', atom: true,
        attrs: { ...origin, name: { default: '' }, label: { default: '' } },
        toDOM: node => ['span', { 'data-sw-reference': node.attrs.name, contenteditable: 'false' }, node.attrs.label],
        parseDOM: [{ tag: 'span[data-sw-reference]', getAttrs: dom => {
          const name = dom.getAttribute('data-sw-reference') ?? '';
          return { name, label: String(this.input.scope?.bindings[name] ?? name) };
        } }],
      },
      opaque_inline: {
        inline: true, group: 'inline', atom: true,
        attrs: { ...origin, value: { default: null } },
        toDOM: node => ['span', { contenteditable: 'false', 'data-sw-inline-source': componentSource(node.attrs.value), 'data-sw-opaque': 'true' }, node.attrs.value.name],
        parseDOM: [{ tag: 'span[data-sw-opaque]', getAttrs: dom => {
          const value = clipboardComponent(dom);
          return value ? { value } : false;
        } }],
      },
    };
    for (const [name, component] of Object.entries(input.registry)) {
      if (component.meta.produces !== 'text') continue;
      const type = `inline_${this.inlineTypes.size}`;
      this.inlineTypes.set(name, type);
      const contract = component.meta.inlineEditing;
      const transparent = contract?.mode === 'transparent';
      if (transparent && component.meta.slots[contract.contentSlot]?.type !== 'text') throw new Error(`${name}: transparent contentSlot must name a text slot`);
      nodes[type] = {
        inline: true, group: 'inline', atom: !transparent, ...(transparent ? { content: 'inline*' } : {}),
        attrs: { ...origin, value: { default: null } },
        toDOM: node => ['span', {
          'data-sw-inline-type': name, 'data-sw-inline-source': componentSource(node.attrs.value),
          ...(!transparent ? { contenteditable: 'false' } : {}),
        }, transparent ? 0 : name],
        parseDOM: [{ tag: `span[data-sw-inline-type="${name}"]`, getAttrs: dom => {
          const value = clipboardComponent(dom, name);
          return value ? { value } : false;
        } }],
      };
    }
    const marks: Record<string, MarkSpec> = {};
    const cssNames: Record<StyleField, string> = { strokeWidth: '-webkit-text-stroke-width', strokeColor: '-webkit-text-stroke-color', color: 'color', font: 'font-family', size: 'font-size', weight: 'font-weight', letterSpacing: 'letter-spacing', italic: 'font-style', underline: 'text-decoration-line', strikethrough: 'text-decoration-line', href: '' };
    for (const name of STYLE_FIELDS) {
      marks[name] = {
        attrs: { value: {}, authored: { default: null } },
        toDOM: mark => [name === 'href' ? 'a' : 'span', styleDOM(name, mark.attrs.value), 0],
        parseDOM: name === 'href'
          ? [{ tag: 'a[href]', getAttrs: dom => ({ value: dom.getAttribute('href') }) }]
          : [{ style: cssNames[name], getAttrs: value => {
            if (name === 'italic') return value === 'italic' ? { value: true } : false;
            if (name === 'underline') return String(value).includes('underline') ? { value: true } : false;
            if (name === 'strikethrough') return String(value).includes('line-through') ? { value: true } : false;
            return { value: name === 'size' || name === 'letterSpacing' || name === 'strokeWidth' ? parseFloat(String(value)) : value };
          } }],
      };
      const tags = name === 'weight' ? ['strong', 'b'] : name === 'italic' ? ['em', 'i'] : name === 'underline' ? ['u'] : name === 'strikethrough' ? ['s', 'strike', 'del'] : [];
      marks[name]!.parseDOM = [...(marks[name]!.parseDOM ?? []), ...tags.map(tag => ({ tag, getAttrs: () => ({ value: name === 'weight' ? '700' : true }) }))];
    }
    // Provenance is separate from formatting. Distinct origins prevent
    // merging adjacent authored strings, without blocking continuous carets.
    marks.source = {
      attrs: { id: { default: null }, authoredId: { default: null }, ancestry: { default: [] } }, excludes: 'source',
      toDOM: mark => ['span', { 'data-sw-text-origin': mark.attrs.id ?? '' }, 0],
      // Never import session IDs from HTML pasted from another document.
    };
    this.schema = new Schema({ nodes, marks });
    const content = input.content;
    const blocks = content?.kind === 'list'
      ? content.items.map((value, index) => this.block(value, [{ kind: 'item', index }]))
      : content && content.kind !== 'omit' ? [this.paragraph(null, this.inline(content, [], []))] : [];
    this.doc = this.schema.node('doc', null, blocks.length ? blocks : [this.paragraph(null, [])]);
    this.doc.check();
  }

  private bind(value: Value, path: TextValuePath): Bound {
    const bound: Bound = { id: `origin-${++this.nextId}`, value, path };
    this.origins.set(bound.id, bound);
    return bound;
  }
  private spanStyles(comp: Component, inherited: Styles): Styles {
    const styles = { ...inherited };
    for (const name of STYLE_FIELDS) {
      const value = fillValue(comp, name);
      if (!value) continue;
      let resolved = scalar(value, '');
      if ((name === 'color' || name === 'strokeColor') && value.kind === 'color_oklch') resolved = `oklch(${value.l} ${value.c} ${value.h})`;
      if ((name === 'color' || name === 'strokeColor') && value.kind === 'name_ref') resolved = this.input.colorTokens?.[value.name] ?? `var(--${value.name})`;
      styles[name] = { value: resolved, authored: value };
    }
    return styles;
  }
  private marks(bound: Bound, ancestry: string[], styles: Styles): Mark[] {
    bound.styles = styles;
    return [this.schema.marks.source!.create({ id: bound.id, ancestry }), ...STYLE_FIELDS.flatMap(name => styles[name] ? [this.schema.marks[name]!.create(styles[name])] : [])];
  }
  private inline(value: Value, path: TextValuePath, ancestry: string[], styles: Styles = {}): PMNode[] {
    if (value.kind === 'list') return value.items.flatMap((v, index) => this.inline(v, [...path, { kind: 'item', index }], ancestry, styles));
    const bound = this.bind(value, path);
    if (value.kind === 'component' && value.name === 'Span') {
      const content = fillValue(value, 'content');
      const nodes = content ? this.inline(content, [...path, { kind: 'fill', name: 'content' }], [...ancestry, bound.id], this.spanStyles(value, styles)) : [];
      bound.projected = Fragment.from(nodes);
      return nodes;
    }
    const marks = this.marks(bound, ancestry, styles);
    let nodes: PMNode[];
    if (value.kind === 'string') {
      // Newlines are soft line breaks; paragraph boundaries are nodes.
      nodes = value.value.split('\n').flatMap((part, index) => [
        ...(index ? [this.schema.node('hard_break', null, undefined, marks)] : []),
        ...(part ? [this.schema.text(part, marks)] : []),
      ]);
    } else if (value.kind === 'name_ref') {
      const label = this.input.scope?.bindings[value.name];
      nodes = [this.schema.node('reference', { origin: bound.id, name: value.name, label: label === undefined ? value.name : String(label) }, undefined, marks)];
    } else if (value.kind === 'component') {
      const registered = this.input.registry[value.name];
      if (blockBuiltins.has(value.name) || (registered && registered.meta.produces !== 'text')) throw new Error(`${value.name} is not inline text`);
      const contract = registered?.meta.inlineEditing;
      const children = contract?.mode === 'transparent' ? fillValue(value, contract.contentSlot) : undefined;
      nodes = [this.schema.node(this.inlineTypes.get(value.name) ?? 'opaque_inline', { origin: bound.id, value },
        children ? this.inline(children, [...path, { kind: 'fill', name: contract!.mode === 'transparent' ? contract!.contentSlot : '' }], []) : undefined, marks)];
    } else throw new Error(`Cannot project ${value.kind} as inline content`);
    bound.projected = Fragment.from(nodes);
    return nodes;
  }
  private paragraph(bound: Bound | null, children: PMNode[]): PMNode {
    const comp = bound?.value.kind === 'component' ? bound.value : undefined;
    const attrs: Record<string, unknown> = { origin: bound?.id ?? null };
    for (const name of PARAGRAPH_FIELDS) {
      const value = comp ? fillValue(comp, name) : undefined;
      if (value) attrs[name] = scalar(value, 0);
    }
    return this.schema.node('paragraph', attrs, children);
  }
  private block(value: Value, path: TextValuePath): PMNode {
    if (value.kind !== 'component') throw new Error('Document blocks must be Paragraph or List components');
    const bound = this.bind(value, path);
    let node: PMNode;
    if (value.name === 'Paragraph') {
      const content = fillValue(value, 'content');
      node = this.paragraph(bound, content ? this.inline(content, [...path, { kind: 'fill', name: 'content' }], []) : []);
    } else if (value.name === 'List') {
      const items = fillValue(value, 'items');
      if (items?.kind !== 'list') throw new Error('List.items must be a list');
      const style = String(scalar(fillValue(value, 'style'), 'disc'));
      const children = items.items.map((item, index) => this.item(item, [...path, { kind: 'fill', name: 'items' }, { kind: 'item', index }]));
      node = this.schema.node(orderedStyles.has(style) ? 'ordered_list' : 'bullet_list', { origin: bound.id, style, start: scalar(fillValue(value, 'start'), 1) },
        children.length ? children : [this.schema.node('list_item', null, this.paragraph(null, []))]);
    } else throw new Error(`${value.name} is not a document block`);
    bound.projected = node;
    return node;
  }
  private item(value: Value, path: TextValuePath): PMNode {
    if (value.kind !== 'component' || value.name !== 'ListItem') throw new Error('List entries must be ListItem components');
    const bound = this.bind(value, path);
    const content = fillValue(value, 'content');
    const children = fillValue(value, 'children');
    const node = this.schema.node('list_item', { origin: bound.id }, [
      this.paragraph(bound, content ? this.inline(content, [...path, { kind: 'fill', name: 'content' }], []) : []),
      ...(children && children.kind !== 'omit' ? [this.block(children, [...path, { kind: 'fill', name: 'children' }])] : []),
    ]);
    bound.projected = node;
    return node;
  }

  lower(doc: PMNode): Value {
    doc.check();
    if (doc.eq(this.doc) && this.input.content) return this.input.content;
    const used = new Set<string>();
    const derivedFrom = new WeakMap<Value, Value>();
    const original = (id: unknown): Bound | undefined => typeof id === 'string' ? this.origins.get(id) : undefined;
    const fresh = (bound: Bound | undefined, name: string): Component => {
      const value = bound?.value;
      if (!value || value.kind !== 'component') return makeComponent(name, []);
      const reused = used.has(bound!.id);
      used.add(bound!.id);
      return reused ? { ...value, leadingComments: undefined, trailingComments: undefined } : value;
    };
    const styleMap = (node: PMNode): Styles => Object.fromEntries(node.marks.filter(m => STYLE_FIELDS.includes(m.type.name as StyleField)).map(m => [m.type.name, { value: m.attrs.value, authored: m.attrs.authored }])) as Styles;
    const provenance = (node: PMNode) => node.marks.find(m => m.type.name === 'source');
    const authoredId = (node: PMNode) => { const source = provenance(node); return source?.attrs.authoredId ?? source?.attrs.id; };
    const fieldValue = (style: StyleValue): Value => style.authored ?? (typeof style.value === 'number' ? numberLit(style.value) : typeof style.value === 'boolean' ? booleanLit(style.value) : stringLit(style.value));
    const nodesOf = (fragment: Fragment): PMNode[] => { const result: PMNode[] = []; fragment.forEach(node => result.push(node)); return result; };
    const contentValue = (before: Value | undefined, values: Value[]): Value => {
      // Empty authored runs have no PM node or caret width. Preserve
      // them at surviving source neighbors instead of dropping them when
      // another run in the same semantic owner changes.
      if (before?.kind === 'list') {
        const entries = [...values];
        for (let index = 0; index < before.items.length; index++) {
          const value = before.items[index]!;
          const bound = [...this.origins.values()].find(origin => origin.value === value);
          if (!(bound?.projected instanceof Fragment) || bound.projected.size !== 0 || entries.includes(value)) continue;
          const next = before.items.slice(index + 1);
          const position = entries.findIndex(entry => next.includes(derivedFrom.get(entry) ?? entry));
          entries.splice(position < 0 ? entries.length : position, 0, value);
        }
        values = entries;
      }
      return inlineValue(before, values);
    };
    const leaf = (node: PMNode): Value => {
      const bound = original(authoredId(node) ?? node.attrs.origin);
      if (node.isText || node.type.name === 'hard_break') {
        const text = node.isText ? node.text! : '\n';
        return bound?.value.kind === 'string' ? bound.value.value === text ? bound.value : { ...bound.value, value: text } : stringLit(text);
      }
      if (node.type.name === 'reference') return bound?.value.kind === 'name_ref' && bound.value.name === node.attrs.name ? bound.value : nameRef(node.attrs.name);
      const value: Component | undefined = node.attrs.value;
      if (!value || value.kind !== 'component') throw new Error('Missing authored inline value');
      if (blockBuiltins.has(value.name)) throw new Error('Document blocks cannot be written back as inline content');
      if (this.input.registry[value.name] && this.input.registry[value.name]!.meta.produces !== 'text') throw new Error('Inline write-back must produce text');
      if (node.type.name !== 'opaque_inline' && this.inlineTypes.get(value.name) !== node.type.name) throw new Error('Inline write-back must retain its registered component type');
      const contract = this.input.registry[value.name]?.meta.inlineEditing;
      if (contract?.mode !== 'transparent') return value;
      if (bound?.projected instanceof Fragment && bound.projected.eq(Fragment.from(node))) return bound.value;
      return setFill(value, contract.contentSlot, contentValue(fillValue(value, contract.contentSlot), inline(nodesOf(node.content))));
    };
    const inline = (nodes: PMNode[], depth = 0, inherited: Styles = {}): Value[] => {
      const output: Value[] = [];
      for (let index = 0; index < nodes.length;) {
        const node = nodes[index]!;
        const source = provenance(node);
        const bound = original(authoredId(node));
        const styles = styleMap(node);
        const ancestry: string[] = source?.attrs.ancestry ?? [];
        const unchangedStyle = signature(styles) === signature(bound?.styles ?? {});
        const ownerId = unchangedStyle ? ancestry[depth] : undefined;
        if (ownerId) {
          let end = index + 1;
          while (end < nodes.length) {
            const candidate = nodes[end]!;
            const candidateSource = provenance(candidate);
            if (candidateSource?.attrs.ancestry[depth] !== ownerId || signature(styleMap(candidate)) !== signature(original(authoredId(candidate))?.styles ?? {})) break;
            end++;
          }
          const group = nodes.slice(index, end);
          const owner = original(ownerId)!;
          const base = fresh(owner, 'Span');
          if (base === owner.value && owner.projected instanceof Fragment && owner.projected.eq(Fragment.from(group))) output.push(base);
          else {
            const values = inline(group, depth + 1, this.spanStyles(base, inherited));
            const rebuilt = setFill(base, 'content', contentValue(fillValue(base, 'content'), values));
            derivedFrom.set(rebuilt, owner.value);
            output.push(rebuilt);
          }
          index = end;
          continue;
        }
        // Consecutive fragments of one authored string (including soft
        // breaks) become one string again, even if PM split its nodes.
        let value = leaf(node);
        let end = index + 1;
        if (value.kind === 'string') {
          while (end < nodes.length) {
            const next = nodes[end]!;
            const nextSource = provenance(next);
            if ((!next.isText && next.type.name !== 'hard_break') || authoredId(next) !== authoredId(node) || JSON.stringify(nextSource?.attrs.ancestry ?? []) !== JSON.stringify(ancestry) || signature(styleMap(next)) !== signature(styles)) break;
            value = { ...value, value: value.value + (next.isText ? next.text! : '\n') };
            end++;
          }
          if (bound?.value.kind === 'string' && bound.value.value === value.value) value = bound.value;
        }
        const extra = Object.fromEntries(STYLE_FIELDS.flatMap(name => styles[name] && styles[name]!.value !== inherited[name]?.value ? [[name, styles[name]!]] : [])) as Styles;
        if (!unchangedStyle && ancestry.length) {
          // Formatting changed: split this region from its original Span,
          // preserving the original wrapper/comment owner with new marks.
          const base = fresh(original(ancestry[0]), 'Span');
          const stripped = { ...base, fills: base.fills.filter(f => !STYLE_FIELDS.includes(f.name as StyleField)) };
          value = setFill(stripped, 'content', listLit([value]));
          for (const name of STYLE_FIELDS) if (styles[name]) value = setFill(value as Component, name, fieldValue(styles[name]!));
        } else if (Object.keys(extra).length) {
          value = makeComponent('Span', [slotFill('content', listLit([value])), ...STYLE_FIELDS.flatMap(name => extra[name] ? [slotFill(name, fieldValue(extra[name]!))] : [])]);
        }
        if (bound) derivedFrom.set(value, bound.value);
        output.push(value);
        index = end;
      }
      return output;
    };
    const block = (node: PMNode): Component => {
      const bound = original(node.attrs.origin);
      if (bound?.value.kind === 'component' && bound.projected && !(bound.projected instanceof Fragment) && bound.projected.eq(node) && !used.has(bound.id)) {
        used.add(bound.id);
        return bound.value;
      }
      if (node.type.name === 'paragraph') {
        let value = fresh(bound, 'Paragraph');
        if (value.name === 'ListItem') value = { ...value, name: 'Paragraph', fills: value.fills.filter(fill => fill.name !== 'children') };
        value = setFill(value, 'content', contentValue(fillValue(value, 'content'), inline(nodesOf(node.content))));
        for (const name of PARAGRAPH_FIELDS) {
          const current = node.attrs[name];
          const prior = fillValue(value, name);
          if (scalar(prior, name === 'align' || name === 'lineHeight' ? '' : 0) === (current ?? '')) continue;
          value = setFill(value, name, current === null ? undefined : typeof current === 'number' ? numberLit(current) : stringLit(current));
        }
        return value;
      }
      if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
        let value = fresh(bound, 'List');
        const items = nodesOf(node.content).map(item);
        value = setFill(value, 'items', sameItems(fillValue(value, 'items'), items) ? fillValue(value, 'items')! : listLit(items));
        const currentStyle = node.type.name === 'ordered_list'
          ? orderedStyles.has(node.attrs.style) ? node.attrs.style : 'decimal'
          : orderedStyles.has(node.attrs.style) ? 'disc' : node.attrs.style;
        if (scalar(fillValue(value, 'style'), 'disc') !== currentStyle) value = setFill(value, 'style', stringLit(currentStyle));
        if (scalar(fillValue(value, 'start'), 1) !== node.attrs.start) value = setFill(value, 'start', numberLit(node.attrs.start));
        return value;
      }
      throw new Error(`Cannot lower block ${node.type.name}`);
    };
    const item = (node: PMNode): Component => {
      const bound = original(node.attrs.origin) ?? original(node.firstChild?.attrs.origin);
      if (bound?.value.kind === 'component' && bound.projected && !(bound.projected instanceof Fragment) && bound.projected.eq(node) && !used.has(bound.id)) {
        used.add(bound.id);
        return bound.value;
      }
      let value = fresh(bound, 'ListItem');
      if (value.name === 'Paragraph') value = { ...value, name: 'ListItem' };
      value = setFill(value, 'content', contentValue(fillValue(value, 'content'), inline(nodesOf(node.firstChild!.content))));
      for (const name of PARAGRAPH_FIELDS) {
        const current = node.firstChild!.attrs[name];
        const prior = fillValue(value, name);
        if (scalar(prior, name === 'align' || name === 'lineHeight' ? '' : 0) === (current ?? '')) continue;
        value = setFill(value, name, current === null ? undefined : typeof current === 'number' ? numberLit(current) : stringLit(current));
      }
      const nested = node.childCount > 1 ? block(node.child(1)) : undefined;
      value = setFill(value, 'children', nested ?? (fillValue(value, 'children')?.kind === 'omit' ? fillValue(value, 'children') : undefined));
      return value;
    };
    const blocks = nodesOf(doc.content).map(block);
    return sameItems(this.input.content, blocks) ? this.input.content! : listLit(blocks);
  }
}
