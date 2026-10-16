import { measureLayoutSnapshot } from './layout-measurement.js';
import type { Component, SourceFile, Value } from '../runtime/ast.js';
import type { ShapeData } from '../runtime/loader.js';
import { listLit, makeComponent, numberLit, slotFill } from '../runtime/ast-builders.js';
import { parse } from '../runtime/parser.js';
import { commitSourceEdit, componentByPath, findComponentAtSpan, pathToComponent } from './ast-edits.js';
import type { SelectionTarget } from './selection-target.js';
import type { ShapeAdapter } from './shape-adapter.js';
import { isLayoutAdapter } from './layout-adapter.js';
import { spanKey } from './gesture-context.js';

function children(node: Component): Value[] | null {
  const fill = node.fills.find(fill => fill.name === 'children');
  return fill ? fill.value.kind === 'list' ? fill.value.items : null : node.implicitChildren;
}

function parentChildren(ast: SourceFile, node: Component) {
  const path = pathToComponent(ast, node);
  if (!path) return null;
  const last = path.at(-1);
  const previous = path.at(-2);
  const explicit = last?.kind === 'item' && previous?.kind === 'fill' && previous.name === 'children';
  if (!explicit && last?.kind !== 'implicit') return null;
  const parent = componentByPath(ast, path.slice(0, explicit ? -2 : -1));
  if (!parent || !['Freeform', 'Group'].includes(parent.name)) return null;
  const items = children(parent);
  return items?.includes(node) ? { parent, items } : null;
}

function shape(shapes: ReadonlyMap<string, ShapeData>, node: Component) {
  const data = shapes.get(spanKey({ start: node.span.start.offset, end: node.span.end.offset }));
  if (!data || !data.canvas || isLayoutAdapter(data.canvas)) return null;
  const adapter = data.canvas as ShapeAdapter;
  const bounds = adapter.measureBounds ? measureLayoutSnapshot({ start: node.span.start.offset, end: node.span.end.offset })?.layout : adapter.calculateBounds(data.params);
  return bounds && Object.values(bounds).every(Number.isFinite) ? { data, adapter, bounds } : null;
}

// Rebase through the registered adapter, including arrows and custom shapes.
// Refuse authored bindings and preserve fractional coordinates exactly.
function translate(node: Component, shapes: ReadonlyMap<string, ShapeData>, dx: number, dy: number): boolean {
  const resolved = shape(shapes, node);
  if (!resolved) return false;
  const { data, adapter, bounds } = resolved;
  const preview = adapter.applyGesture(data.params, { kind: 'translate', dx, dy });
  for (const [name, value] of Object.entries(preview)) {
    if (value === data.params[name]) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const fill = node.fills.find(fill => fill.name === name);
    if (fill && fill.value.kind !== 'number') return false;
    if (fill) fill.value = numberLit(value);
    else node.fills.push(slotFill(name, numberLit(value)));
  }
  const actual = adapter.calculateBounds(preview);
  return !!actual && Math.abs(actual.left - bounds.left - dx) < 0.001 && Math.abs(actual.top - bounds.top - dy) < 0.001;
}

export function editGrouping(source: string, selected: readonly SelectionTarget[], shapes: ReadonlyMap<string, ShapeData>, ungroup = false) {
  return commitSourceEdit(source, '<grouping>', ast => {
    if (!selected.length || selected.some(target => target.kind !== 'component')) return null;
    const nodes = selected.flatMap(target => {
      if (target.kind !== 'component') return [];
      const node = findComponentAtSpan(ast, target.span.start, target.span.end);
      return node ? [node] : [];
    });
    if (nodes.length !== selected.length || new Set(nodes).size !== nodes.length) return null;
    const context = parentChildren(ast, nodes[0]!);
    if (!context || nodes.some(node => parentChildren(ast, node)?.parent !== context.parent)) return null;
    const { items } = context;
    if (ungroup) {
      if (nodes.some(node => node.name !== 'Group')) return null;
      const selectComponents: Component[] = [];
      // Work in source order, preserving each group's exact sibling position.
      for (const node of [...items]) {
        if (node.kind !== 'component' || !nodes.includes(node)) continue;
        const members = children(node);
        const resolved = shape(shapes, node);
        if (!members || !resolved) return null;
        // Extra authored Group properties cannot be silently discarded.
        if (node.fills.some(fill => !['x', 'y', 'width', 'height', 'children'].includes(fill.name))) return null;
        if (node.fills.some(fill => ['x', 'y'].includes(fill.name) && fill.value.kind !== 'number')) return null;
        const restored: Component[] = [];
        for (const member of members) {
          if (member.kind !== 'component' || !translate(member, shapes, Number(resolved.data.params.x), Number(resolved.data.params.y))) return null;
          restored.push(member);
        }
        if (!restored.length) return null;
        restored[0]!.leadingComments = [...(node.leadingComments ?? []),
          ...node.fills.flatMap(fill => fill.leadingComments ?? []), ...(restored[0]!.leadingComments ?? [])];
        const last = restored.at(-1)!;
        last.trailingComments = [...(last.trailingComments ?? []), ...(node.trailingComments ?? [])];
        items.splice(items.indexOf(node), 1, ...restored);
        selectComponents.push(...restored);
      }
      return { selectComponents };
    }
    if (nodes.length < 2) return null;
    const members = items.filter((item): item is Component => item.kind === 'component' && nodes.includes(item));
    const resolved = members.map(node => shape(shapes, node));
    if (resolved.some(item => !item)) return null;
    const bounds = resolved.map(item => item!.bounds);
    const x = Math.min(...bounds.map(b => b.left));
    const y = Math.min(...bounds.map(b => b.top));
    const width = Math.max(1, ...bounds.map(b => b.left + b.width - x));
    const height = Math.max(1, ...bounds.map(b => b.top + b.height - y));
    for (const member of members) if (!translate(member, shapes, -x, -y)) return null;
    const group = makeComponent('Group', [slotFill('x', numberLit(x)), slotFill('y', numberLit(y)),
      slotFill('width', numberLit(width)), slotFill('height', numberLit(height)), slotFill('children', listLit(members))]);
    // Place the group at its topmost member's stacking position.
    const insertion = items.indexOf(members.at(-1)!);
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (i === insertion) items.splice(i, 1, group);
      else if (item?.kind === 'component' && members.includes(item)) items.splice(i, 1);
    }
    return { selectComponents: [group] };
  });
}

export function groupingAvailability(source: string, selected: readonly SelectionTarget[]) {
  const ast = parse(source, '<grouping-availability>').ast;
  const nodes = selected.flatMap(target => {
    if (target.kind !== 'component') return [];
    const node = findComponentAtSpan(ast, target.span.start, target.span.end);
    return node ? [node] : [];
  });
  const context = nodes[0] && parentChildren(ast, nodes[0]);
  const siblings = nodes.length === selected.length && !!context && nodes.every(node => parentChildren(ast, node)?.parent === context.parent);
  return { group: siblings && nodes.length > 1, ungroup: siblings && nodes.length > 0 && nodes.every(node => node.name === 'Group') };
}
