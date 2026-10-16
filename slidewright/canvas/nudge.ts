import type { ShapeData } from '../runtime/loader.js';
import { numberLit, slotFill } from '../runtime/ast-builders.js';
import { commitSourceEdit, componentByPath, findComponentAtSpan, pathToComponent } from './ast-edits.js';
import { spanKey } from './gesture-context.js';
import { isLayoutAdapter } from './layout-adapter.js';
import type { SelectionTarget } from './selection-target.js';
import type { ShapeAdapter } from './shape-adapter.js';

export function nudgeSelection(source: string, selected: readonly SelectionTarget[], shapes: ReadonlyMap<string, ShapeData>, dx: number, dy: number) {
  return commitSourceEdit(source, '<nudge>', ast => {
    if (!selected.length) return null;
    const selectComponents = [];
    let container;
    for (const target of selected) {
      if (target.kind !== 'component') return null;
      const node = findComponentAtSpan(ast, target.span.start, target.span.end);
      const data = shapes.get(spanKey(target.span));
      if (!node || !data?.canvas || isLayoutAdapter(data.canvas)) return null;
      const path = pathToComponent(ast, node);
      const last = path?.at(-1);
      const previous = path?.at(-2);
      const explicit = last?.kind === 'item' && previous?.kind === 'fill' && previous.name === 'children';
      if (!path || (!explicit && last?.kind !== 'implicit')) return null;
      const parent = componentByPath(ast, path.slice(0, explicit ? -2 : -1));
      if (!parent || !['Freeform', 'Group'].includes(parent.name) || (container && container !== parent)) return null;
      container = parent;

      // Use the registered translation contract for rectangles, endpoints,
      // groups and custom shapes. Preserve fractions and materialize defaults.
      const adapter = data.canvas as ShapeAdapter;
      const before = adapter.calculateBounds(data.params);
      const preview = adapter.applyGesture(data.params, { kind: 'translate', dx, dy });
      const after = adapter.calculateBounds(preview);
      if (!before || !after || !Number.isFinite(after.left) || !Number.isFinite(after.top) ||
          Math.abs(after.left - before.left - dx) > 0.001 || Math.abs(after.top - before.top - dy) > 0.001) return null;
      for (const [name, value] of Object.entries(preview)) {
        if (value === data.params[name]) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        const fill = node.fills.find(fill => fill.name === name);
        // Derived positions remain source-owned; do not overwrite bindings.
        if (fill && fill.value.kind !== 'number') return null;
        if (fill) fill.value = numberLit(value);
        else node.fills.push(slotFill(name, numberLit(value)));
      }
      selectComponents.push(node);
    }
    return { selectComponents };
  });
}
