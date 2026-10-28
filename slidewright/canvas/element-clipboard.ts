import type { Component, SourceFile, Value } from '../runtime/ast.js';
import { makeComponent, numberLit, slotFill, stringLit } from '../runtime/ast-builders.js';
import { emit } from '../runtime/emitter.js';
import type { DocumentSnapshot } from '../runtime/document.js';
import { parse } from '../runtime/parser.js';
import { readBuildEditingAst } from './build-editing.js';
import { commitSourceEdit, componentByPath, findComponentAtSpan, pathToComponent } from './ast-edits.js';
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

export function copyElements(source: string, selected: readonly SelectionTarget[], snapshot?: DocumentSnapshot): string | null {
  if (snapshot && snapshot.source !== source) return null;
  const parsed = snapshot ?? parse(source, '<copy-elements>');
  if (parsed.diagnostics.some(d => d.severity === 'error')) return null;
  const ast = snapshot ? readBuildEditingAst(snapshot) : parsed.ast as SourceFile;
  const nodes = [...new Set(selected.flatMap(target => {
    const resolved = enclosingElement(ast, target);
    return resolved ? [resolved.node] : [];
  }))].sort((a, b) => a.span.start.offset - b.span.start.offset);
  // Selecting both a group and one of its descendants copies the group once.
  const items = nodes.filter(node => !nodes.some(other => other !== node &&
    other.span.start.offset <= node.span.start.offset && other.span.end.offset >= node.span.end.offset));
  return items.length ? HEADER + emit({ kind: 'source_file', items, span: parsed.ast.span }) : null;
}

export function pasteElements(source: string, selected: readonly SelectionTarget[], slideIdx: number, clipboard: string, snapshot?: DocumentSnapshot) {
  if (!clipboard.startsWith(HEADER)) return null;
  const parsed = parse(clipboard.slice(HEADER.length), '<paste-elements>');
  if (parsed.diagnostics.some(d => d.severity === 'error') || !parsed.ast.items.length) return null;
  return insertElements(source, selected, slideIdx, parsed.ast.items, snapshot);
}

// Prefer an explicit selection; otherwise search within the active slide so
// authored wrappers (such as PlateauSlide) can contain the canvas.
function slideFreeform(ast: SourceFile, slideIdx: number): Component | null {
  const slides = ast.items[0]?.fills.find(fill => fill.name === 'slides')?.value;
  const slide = slides?.kind === 'list' ? slides.items[slideIdx] : null;
  const visit = (value: Value): Component | null => {
    if (value.kind === 'list') {
      for (const item of value.items) { const found = visit(item); if (found) return found; }
    }
    if (value.kind !== 'component') return null;
    if (value.name === 'Freeform') return value;
    for (const fill of value.fills) { const found = visit(fill.value); if (found) return found; }
    for (const child of value.implicitChildren) { const found = visit(child); if (found) return found; }
    return null;
  };
  return slide ? visit(slide) : null;
}

function insertElements(source: string, selected: readonly SelectionTarget[], slideIdx: number, nodes: Component[], snapshot?: DocumentSnapshot) {
  return commitSourceEdit(source, '<paste-elements>', ast => {
    const target = selected[0];
    const node = target && selectedNode(ast, target);
    const explicitContainer = node && ['Freeform', 'Group'].includes(node.name) &&
      (node.name === 'Freeform' || (target?.kind !== 'component' && target?.kind !== 'slide' && target?.slotName === 'children'));
    const parent = explicitContainer ? node : target ? enclosingElement(ast, target)?.parent : null;
    const destination = parent ?? slideFreeform(ast, slideIdx);
    const items = destination && children(destination);
    if (!items) return null;
    items.push(...nodes);
    return { selectComponents: nodes };
  }, snapshot);
}

export interface ClipboardImage {
  src: string;
  width: number;
  height: number;
}

// Embed bytes in the source rather than retaining a temporary blob URL.
// Keep small images at native size and fit large ones within the slide.
export function pasteImages(source: string, selected: readonly SelectionTarget[], slideIdx: number, images: readonly ClipboardImage[], snapshot?: DocumentSnapshot) {
  if (!images.length) return null;
  const nodes = images.map((image, index) => {
    const scale = Math.min(1, 1440 / image.width, 810 / image.height);
    return makeComponent('Image', [
      slotFill('x', numberLit(80 + index * 24)),
      slotFill('y', numberLit(80 + index * 24)),
      slotFill('width', numberLit(image.width * scale)),
      slotFill('height', numberLit(image.height * scale)),
      slotFill('src', stringLit(image.src)),
    ]);
  });
  return insertElements(source, selected, slideIdx, nodes, snapshot);
}
