import type { SourceChange } from '../runtime/document.js';
import { measureLayoutSnapshot } from './layout-measurement.js';
import {
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import type { ShapeData } from '../runtime/loader.js';
import { numberLit, slotFill } from '../runtime/ast-builders.js';
import { parse } from '../runtime/parser.js';
import type { SelectionTarget } from './selection-target.js';
import type { Bounds, ShapeAdapter } from './shape-adapter.js';
import type { SourceRange } from './host.js';
import { commitSourceEdit, componentByPath, pathToComponent, findComponentAtSpan } from './ast-edits.js';
import { isLayoutAdapter } from './layout-adapter.js';
import { spanKey } from './gesture-context.js';

type Command = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical';
const COMMAND_ICONS: Record<Command, LucideIcon> = {
  left: AlignHorizontalJustifyStart, center: AlignHorizontalJustifyCenter, right: AlignHorizontalJustifyEnd,
  top: AlignVerticalJustifyStart, middle: AlignVerticalJustifyCenter, bottom: AlignVerticalJustifyEnd,
  horizontal: AlignHorizontalSpaceBetween, vertical: AlignVerticalSpaceBetween,
};
interface Item { span: SourceRange; data: ShapeData; adapter: ShapeAdapter; bounds: Bounds }
interface Context { items: Item[]; container: HTMLElement }

// Only siblings in a positioning container share a coordinate system.
// Flow-layout children must be arranged through their layout's properties.
function resolveSelection(selected: readonly SelectionTarget[], shapes: ReadonlyMap<string, ShapeData>): Context | null {
  const items: Item[] = [];
  let container: HTMLElement | null = null;
  for (const target of selected) {
    if (target.kind !== 'component') return null;
    const data = shapes.get(spanKey(target.span));
    if (!data || !data.canvas || isLayoutAdapter(data.canvas)) return null;
    const adapter = data.canvas as ShapeAdapter;
    const bounds = adapter.measureBounds ? measureLayoutSnapshot({ start: data.comp.span.start.offset, end: data.comp.span.end.offset })?.layout : adapter.calculateBounds(data.params);
    if (!bounds || !Object.values(bounds).every(Number.isFinite)) return null;
    const wrapper = document.querySelector(`.sw-canvas-stage [data-sw-span-start="${target.span.start}"][data-sw-span-end="${target.span.end}"]`);
    const parent = wrapper?.parentElement?.closest('[data-sw-component]');
    if (!parent || !['Freeform', 'Group'].includes(parent.getAttribute('data-sw-component') ?? '')) return null;
    const positioned = parent.firstElementChild;
    if (!(positioned instanceof HTMLElement) || container && container !== positioned) return null;
    container = positioned;
    items.push({ span: target.span, data, adapter, bounds });
  }
  return container && items.length ? { items, container } : null;
}

function translations(items: Item[], command: Command, reference: Bounds): { item: Item; dx: number; dy: number }[] {
  const horizontal = ['left', 'center', 'right', 'horizontal'].includes(command);
  const start = horizontal ? 'left' : 'top';
  const size = horizontal ? 'width' : 'height';
  if (command === 'horizontal' || command === 'vertical') {
    const sorted = [...items].sort((a, b) => a.bounds[start] - b.bounds[start]);
    const first = sorted[0]!.bounds[start];
    const last = sorted[sorted.length - 1]!.bounds;
    const gap = (last[start] + last[size] - first - sorted.reduce((sum, item) => sum + item.bounds[size], 0)) / (sorted.length - 1);
    let cursor = first;
    return sorted.map(item => {
      const delta = cursor - item.bounds[start];
      cursor += item.bounds[size] + gap;
      return { item, dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta };
    });
  }
  const factor = command === 'center' || command === 'middle' ? 0.5 : command === 'right' || command === 'bottom' ? 1 : 0;
  return items.map(item => {
    const delta = reference[start] + factor * reference[size] - item.bounds[start] - factor * item.bounds[size];
    return { item, dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta };
  });
}

export function AlignmentControls({ selected, shapes, source, disabled, onCommit }: {
  selected: readonly SelectionTarget[];
  shapes: ReadonlyMap<string, ShapeData>;
  source: string;
  disabled: boolean;
  onCommit(source: string, selections?: SourceRange[], changes?: readonly SourceChange[]): void;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [reference, setReference] = useState<'selection' | 'container'>('selection');
  const [message, setMessage] = useState('');
  useLayoutEffect(() => {
    setContext(resolveSelection(selected, shapes));
    setMessage('');
  }, [selected, shapes]);
  function apply(command: Command) {
    // Resolve again at invocation: a source update or resize may have changed the DOM.
    const current = resolveSelection(selected, shapes);
    if (!current || disabled) return;
    const { items, container } = current;
    if ((command === 'horizontal' || command === 'vertical') && items.length < 3) return;
    const left = Math.min(...items.map(item => item.bounds.left));
    const top = Math.min(...items.map(item => item.bounds.top));
    const right = Math.max(...items.map(item => item.bounds.left + item.bounds.width));
    const bottom = Math.max(...items.map(item => item.bounds.top + item.bounds.height));
    const bounds = items.length === 1 || reference === 'container'
      ? { left: 0, top: 0, width: container.clientWidth, height: container.clientHeight }
      : { left, top, width: right - left, height: bottom - top };
    const moves = translations(items, command, bounds);
    if (moves.every(move => Math.abs(move.dx) < 0.01 && Math.abs(move.dy) < 0.01)) return;
    const paths: NonNullable<ReturnType<typeof pathToComponent>>[] = [];
    const result = commitSourceEdit(source, '<arrange-selection>', ast => {
      for (const item of items) {
        const node = findComponentAtSpan(ast, item.span.start, item.span.end);
        const path = node && pathToComponent(ast, node);
        if (!path) return null;
        paths.push(path);
      }
      for (const { item, dx, dy } of moves) {
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
        const node = findComponentAtSpan(ast, item.span.start, item.span.end);
        if (!node) return null;
        const delta = { kind: 'translate' as const, dx, dy };
        const preview = item.adapter.applyGesture(item.data.params, delta);
        for (const [name, value] of Object.entries(preview)) {
          if (value === item.data.params[name] || typeof value !== 'number') continue;
          const fill = node.fills.find(fill => fill.name === name);
          // Preserve authored bindings rather than silently breaking them.
          if (fill && fill.value.kind !== 'number') return null;
          if (!fill && typeof item.data.params[name] === 'number') {
            node.fills.push(slotFill(name, numberLit(item.data.params[name] as number)));
          }
        }
        if (!item.adapter.commit(ast, item.span, delta, item.data.slideIdx)) return null;
        const params = { ...item.data.params };
        for (const fill of node.fills) if (fill.value.kind === 'number') params[fill.name] = fill.value.value;
        const actual = item.adapter.calculateBounds(params);
        if (!actual || Math.abs(actual.left - item.bounds.left - dx) > 0.51 || Math.abs(actual.top - item.bounds.top - dy) > 0.51) return null;
      }
      return {};
    });
    if (!result || result.newSource === source) { setMessage('These positions cannot be edited directly.'); return; }
    const ast = parse(result.newSource, '<arrange-selection-after>').ast;
    const selections = paths.flatMap(path => {
      const node = componentByPath(ast, path);
      return node ? [{ start: node.span.start.offset, end: node.span.end.offset }] : [];
    });
    onCommit(result.newSource, selections, result.changes);
  }
  if (!selected.some(target => target.kind === 'component')) return null;
  const unavailable = disabled || !context;
  return <section className="sw-alignment" aria-label="Selection alignment">
    <div className="sw-sidebar-heading">{selected.length > 1 ? `${selected.length} selected` : 'Arrange'}</div>
    <label>Align to <select aria-label="Align to" value={context?.items.length === 1 ? 'container' : reference}
      disabled={unavailable || context?.items.length === 1} onChange={event => setReference(event.target.value as typeof reference)}>
      <option value="selection">Selection</option><option value="container">Container</option>
    </select></label>
    <div className="sw-alignment-buttons">
      {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(command => {
        const label = command === 'center' ? 'Align horizontal center' : command === 'middle' ? 'Align vertical center' : `Align ${command}`;
        const Icon = COMMAND_ICONS[command];
        return <button className="sw-icon-button" key={command} type="button" title={label} aria-label={label} disabled={unavailable} onClick={() => apply(command)}>
          <Icon size={20} aria-hidden="true" focusable="false" />
        </button>;
      })}
    </div>
    <div className="sw-distribute-buttons">{(['horizontal', 'vertical'] as const).map(command => {
      const label = `Distribute ${command} space`;
      const Icon = COMMAND_ICONS[command];
      return <button type="button" className="sw-icon-button" key={command} aria-label={label} title={label}
        disabled={unavailable || (context?.items.length ?? 0) < 3} onClick={() => apply(command)}>
        <Icon size={20} aria-hidden="true" focusable="false" />
      </button>;
    })}</div>
    {!context && selected.length > 0 && <p>Select freely positioned siblings to arrange. Use layout properties for stack children.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
