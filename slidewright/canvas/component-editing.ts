import { createContext } from 'react';
import type { Component, Value } from '../runtime/ast.js';
import { booleanLit, listLit, numberLit, slotFill, stringLit } from '../runtime/ast-builders.js';
import type { ComponentRegistry, SlotType } from '../runtime/contract.js';
import type { DocumentSnapshot, OccurrenceHandle } from '../runtime/document.js';
import type { ComponentEditing, EditableParam, ParamPatch, ParamUpdate } from '../runtime/component-editing.js';
import { commitSourceEdit, findComponentAtSpan } from './ast-edits.js';
import { readBuildEditingAst } from './build-editing.js';

export const ComponentEditHostContext = createContext<((component: Component) => ComponentEditing | null) | null>(null);

function literal(value: unknown, type: SlotType): Value | null {
  if (type === 'string' && typeof value === 'string') return stringLit(value);
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return numberLit(value);
  if (type === 'boolean' && typeof value === 'boolean') return booleanLit(value);
  if (type.startsWith('array<') && Array.isArray(value)) {
    const itemType = type.slice(6, -1) as SlotType;
    const items = value.map(item => literal(item, itemType));
    return items.every((item): item is Value => item !== null) ? listLit(items) : null;
  }
  return null;
}

function readLiteral(value: Value): EditableParam | undefined {
  if (value.kind === 'string' || value.kind === 'number' || value.kind === 'boolean') return value.value;
  if (value.kind === 'list') {
    const items = value.items.map(readLiteral);
    if (items.every((item): item is EditableParam => item !== undefined)) return items;
  }
  return undefined;
}

/** Pure command preparation; caller owns availability, context and host publication. */
export function prepareComponentParamEdit(snapshot: DocumentSnapshot, registry: ComponentRegistry,
  handle: OccurrenceHandle, update: ParamUpdate) {
  const occurrence = snapshot.occurrences.find(item => item.handle === handle);
  if (!occurrence || snapshot.diagnostics.some(d => d.severity === 'error')) return null;
  const owner = findComponentAtSpan(readBuildEditingAst(snapshot), occurrence.range.start, occurrence.range.end);
  const meta = owner && registry[owner.name]?.meta;
  if (!owner || !meta?.editing?.params?.length) return null;
  const current: Record<string, EditableParam> = {};
  for (const name of meta.editing.params) {
    const schema = meta.params?.[name];
    if (!schema) return null;
    const authored = owner.fills.find(fill => fill.name === name)?.value;
    const value = authored ? readLiteral(authored) : schema.default;
    // A resolved reference is not permission to overwrite its authored binding.
    if (!literal(value, schema.type)) return null;
    current[name] = structuredClone(value) as EditableParam;
  }
  let patch: ParamPatch;
  try { patch = typeof update === 'function' ? update(structuredClone(current)) : update; }
  catch { return null; }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const values = new Map<string, Value>();
  for (const [name, value] of Object.entries(patch)) {
    const schema = meta.params?.[name];
    if (!meta.editing.params.includes(name) || !schema) return null;
    const next = literal(value, schema.type);
    if (!next || schema.choices && !schema.choices.includes(value as string)) return null;
    // Setting a missing field to its default should remain a no-op.
    if (JSON.stringify(value) !== JSON.stringify(current[name])) values.set(name, next);
  }
  const result = commitSourceEdit(snapshot.source, '<component-params>', ast => {
    const component = findComponentAtSpan(ast, occurrence.range.start, occurrence.range.end);
    if (!component || component.name !== owner.name) return null;
    for (const [name, value] of values) {
      const fill = component.fills.find(fill => fill.name === name);
      if (fill) fill.value = value;
      else component.fills.push(slotFill(name, value));
    }
    return { selectComponents: [component] };
  }, snapshot);
  return result;
}
