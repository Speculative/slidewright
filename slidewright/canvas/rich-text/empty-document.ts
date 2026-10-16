import type { Component, SourceFile, Value } from '../../runtime/ast.js';
import { componentByPath, pathToComponent } from '../ast-edits.js';

// Unknown components and references may render meaningful content without a
// literal string. Preserve them rather than treating them as empty text.
export function isEmptyTextDocument(value: Value | undefined): boolean {
  if (!value || value.kind === 'omit' || value.kind === 'null') return true;
  if (value.kind === 'string') return value.value.trim().length === 0;
  if (value.kind === 'list') return value.items.every(isEmptyTextDocument);
  if (value.kind !== 'component' || !['Paragraph', 'Span', 'List', 'ListItem'].includes(value.name)) return false;
  return value.fills.filter(fill => ['content', 'items', 'children'].includes(fill.name))
    .every(fill => isEmptyTextDocument(fill.value)) && value.implicitChildren.every(isEmptyTextDocument);
}

export function removeEmptyFreeformTextBox(ast: SourceFile, component: Component, content: Value | undefined): boolean {
  if (component.name !== 'TextBox' || !isEmptyTextDocument(content)) return false;
  const path = pathToComponent(ast, component);
  if (!path) return false;
  const last = path.at(-1), previous = path.at(-2);
  const explicit = last?.kind === 'item' && previous?.kind === 'fill' && previous.name === 'children';
  if (!explicit && last?.kind !== 'implicit') return false;
  const parent = componentByPath(ast, path.slice(0, explicit ? -2 : -1));
  if (parent?.name !== 'Freeform') return false;
  const fill = parent.fills.find(fill => fill.name === 'children');
  const items = explicit ? fill?.value.kind === 'list' ? fill.value.items : null : parent.implicitChildren;
  const index = items?.indexOf(component) ?? -1;
  if (!items || index < 0) return false;
  items.splice(index, 1);
  return true;
}
