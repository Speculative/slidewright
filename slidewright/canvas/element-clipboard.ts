import type { Component, SourceFile, Value } from '../runtime/ast.js';
import { emit } from '../runtime/emitter.js';
import { parse } from '../runtime/parser.js';
import { commitSourceEdit, componentByPath, findActiveSlideFreeform, findComponentAtSpan, pathToComponent } from './ast-edits.js';
import type { SelectionTarget } from './selection-target.js';

export const ELEMENT_CLIPBOARD_TYPE = 'application/x-slidewright-elements';
const HEADER = '// Slidewright elements v1\n';

function children(node: Component): Value[] | null {
  const fill = node.fills.find(fill => fill.name === 'children');
  return fill ? fill.value.kind === 'list' ? fill.value.items : null : node.implicitChildren;
}

function selectedNode(ast: SourceFile, target: SelectionTarget): Component | null {
  if (target.kind === 'slide') return null;
  const span = target.kind === 'component' ? target.span : target.parentSpan;
  return findComponentAtSpan(ast, span.start, span.end);
}

// Find the nearest authored element in a freely positioned children list.
// Inline descendants and slots resolve to that element; group children stop
// at their own boundary rather than ascending to the enclosing group.
function enclosingElement(ast: SourceFile, target: SelectionTarget) {
  const node = selectedNode(ast, target);
  const path = node && pathToComponent(ast, node);
  if (!path) return null;
  let child: Component | null = null;
  for (let length = path.length; length > 0; length--) {
    const parent = componentByPath(ast, path.slice(0, length));
    if (!parent) continue;
    if (child && ['Freeform', 'Group'].includes(parent.name) && children(parent)?.includes(child)) {
      return { node: child, parent };
    }
    child = parent;
  }
  return null;
}

export function copyElements(source: string, selected: readonly SelectionTarget[]): string | null {
  const parsed = parse(source, '<copy-elements>');
  if (parsed.diagnostics.some(d => d.severity === 'error')) return null;
  const nodes = [...new Set(selected.flatMap(target => {
    const resolved = enclosingElement(parsed.ast, target);
    return resolved ? [resolved.node] : [];
  }))].sort((a, b) => a.span.start.offset - b.span.start.offset);
  // Selecting both a group and one of its descendants copies the group once.
  const items = nodes.filter(node => !nodes.some(other => other !== node &&
    other.span.start.offset <= node.span.start.offset && other.span.end.offset >= node.span.end.offset));
  return items.length ? HEADER + emit({ kind: 'source_file', items, span: parsed.ast.span }) : null;
}

export function pasteElements(source: string, selected: readonly SelectionTarget[], slideIdx: number, clipboard: string) {
  if (!clipboard.startsWith(HEADER)) return null;
  const parsed = parse(clipboard.slice(HEADER.length), '<paste-elements>');
  if (parsed.diagnostics.some(d => d.severity === 'error') || !parsed.ast.items.length) return null;
  return commitSourceEdit(source, '<paste-elements>', ast => {
    const target = selected[0];
    const node = target && selectedNode(ast, target);
    const explicitContainer = node && ['Freeform', 'Group'].includes(node.name) &&
      (node.name === 'Freeform' || (target?.kind !== 'component' && target?.kind !== 'slide' && target?.slotName === 'children'));
    const parent = explicitContainer ? node : target ? enclosingElement(ast, target)?.parent : null;
    const destination = parent ?? findActiveSlideFreeform(ast, slideIdx);
    const items = destination && children(destination);
    if (!items) return null;
    items.push(...parsed.ast.items);
    return { selectComponents: parsed.ast.items };
  });
}
