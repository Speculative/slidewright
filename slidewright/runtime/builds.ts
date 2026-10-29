// Source-backed, discrete slide builds. A slide's content owns each object
// exactly once; Build.changes contain property keyframes targeting stable IDs.
// Editing direction is an operation scope, never a backward dependency.
import { pruneTextStyleTargets, resolveTextStyles, validateTextStyleKeys } from './text-builds.js';
import type { ComponentRegistry } from './contract.js';
import type { Component, ListLit, Value } from './ast.js';
import { booleanLit, listLit, makeComponent, omitLit, slotFill, stringLit } from './ast-builders.js';

export type BuildDirection = 'forward' | 'backward' | 'everywhere';

export function nextBuildDirection(direction: BuildDirection): BuildDirection {
  return direction === 'forward' ? 'backward' : direction === 'backward' ? 'everywhere' : 'forward';
}
export interface BuildFrame { index: number; id: string; label: string; component: Component }
export interface BuildProperty {
  value: Value | undefined;
  // Zero is the initial frame; null means the component's default.
  origin: number | null;
  keyframed: boolean;
}
export interface BuildEditRange { first: number; last: number }
export interface BuildDifference { id: string; entering: boolean; exiting: boolean; properties: string[] }

const field = (node: Component, name: string): Value | undefined => node.fills.find(fill => fill.name === name)?.value;
const text = (value: Value | undefined): string | undefined => value?.kind === 'string' ? value.value : undefined;
const copy = <T>(value: T): T => structuredClone(value);

function setField(node: Component, name: string, value: Value): void {
  const existing = node.fills.find(fill => fill.name === name);
  if (existing) existing.value = copy(value);
  else node.fills.push(slotFill(name, copy(value)));
}
function removeField(node: Component, name: string): void {
  node.fills = node.fills.filter(fill => fill.name !== name);
}
function listField(node: Component, name: string, create = false): ListLit | undefined {
  const existing = field(node, name);
  if (existing !== undefined && existing.kind !== 'list') throw new Error(`${node.name}.${name} must be a list`);
  if (existing) return existing as ListLit;
  if (!create) return undefined;
  const list = listLit([]);
  node.fills.push(slotFill(name, list));
  return list;
}

/** Traverse scene content only, never keyframe payloads. */
export function buildObjects(slide: Component): Component[] {
  const result: Component[] = [];
  const visit = (value: Value): void => {
    if (value.kind === 'list') value.items.forEach(visit);
    if (value.kind !== 'component') return;
    result.push(value);
    value.fills.forEach(fill => visit(fill.value));
    value.implicitChildren.forEach(visit);
  };
  const content = field(slide, 'content');
  if (content) visit(content);
  return result;
}

export function objectId(object: Component): string | undefined { return text(field(object, 'id')); }

function unusedId(prefix: string, used: Set<string>): string {
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

/** Call when builds are first added, and for newly inserted scene objects.
 * IDs are authored once, not regenerated from positions or source offsets. */
export function ensureBuildObjectIds(slide: Component): void {
  const objects = buildObjects(slide);
  const used = new Set<string>();
  for (const object of objects) {
    const id = objectId(object);
    if (id) {
      if (used.has(id)) throw new Error(`Duplicate build object ID: ${id}`);
      used.add(id);
    } else if (field(object, 'id') !== undefined) throw new Error('Object IDs must be nonempty strings');
  }
  for (const object of objects) {
    if (objectId(object)) continue;
    // The DSL permits bare children only in bodies without property fills.
    // Adding identity must therefore make the children slot explicit first.
    if (object.implicitChildren.length) {
      object.fills.push(slotFill('children', listLit(object.implicitChildren)));
      object.implicitChildren = [];
    }
    const id = unusedId('object', used);
    setField(object, 'id', stringLit(id));
    used.add(id);
  }
}

export function buildFrames(slide: Component): BuildFrame[] {
  const frames: BuildFrame[] = [{ index: 0, id: 'initial', label: 'Initial', component: slide }];
  const used = new Set(['initial']);
  for (const item of listField(slide, 'builds')?.items ?? []) {
    if (item.kind !== 'component' || item.name !== 'Build') throw new Error('Slide.builds must contain Build components');
    const id = text(field(item, 'id'));
    if (!id || used.has(id)) throw new Error('Build IDs must be nonempty and unique within a slide');
    used.add(id);
    frames.push({ index: frames.length, id, label: text(field(item, 'label')) ?? `Build ${frames.length}`, component: item });
  }
  return frames;
}

function frameAt(slide: Component, index: number): BuildFrame {
  const frame = buildFrames(slide)[index];
  if (!Number.isInteger(index) || !frame) throw new RangeError('Build index is outside the slide');
  return frame;
}
function objectAt(slide: Component, id: string): Component {
  const object = buildObjects(slide).find(object => objectId(object) === id);
  if (!object) throw new Error(`Unknown build object: ${id}`);
  return object;
}
function changeAt(slide: Component, index: number, id: string, create = false): Component | undefined {
  if (index === 0) return objectAt(slide, id);
  const changes = listField(frameAt(slide, index).component, 'changes', create);
  const existing = changes?.items.find(item => item.kind === 'component' && text(field(item, 'target')) === id);
  if (existing?.kind === 'component') return existing;
  if (!create) return undefined;
  const change = makeComponent('Change', [slotFill('target', stringLit(id))]);
  changes!.items.push(change);
  return change;
}
function propertyNames(change: Component): string[] {
  return change.fills.map(fill => fill.name).filter(name => name !== 'target' && name !== 'id');
}
function checkProperties(properties: readonly string[]): void {
  if (!properties.length || new Set(properties).size !== properties.length ||
      properties.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ['id', 'target', 'builds'].includes(name))) {
    throw new Error('Build edits require distinct, non-reserved property names');
  }
}
function pruneChange(slide: Component, index: number, id: string): void {
  if (index === 0) return;
  const changes = listField(frameAt(slide, index).component, 'changes');
  if (changes) changes.items = changes.items.filter(item => item.kind !== 'component' ||
    text(field(item, 'target')) !== id || propertyNames(item).length > 0);
}

/** `omit` explicitly returns a property to its component default. Absence of
 * a change means inherit; it must never be confused with that default reset. */
export function buildProperty(slide: Component, index: number, id: string, property: string): BuildProperty {
  frameAt(slide, index);
  const object = objectAt(slide, id);
  let value = field(object, property);
  let origin: number | null = value === undefined ? null : 0;
  let keyframed = index === 0 && value !== undefined;
  for (let current = 1; current <= index; current++) {
    const change = changeAt(slide, current, id);
    const next = change && field(change, property);
    if (next !== undefined) { value = next; origin = current; }
    if (current === index) keyframed = next !== undefined;
  }
  if (value?.kind === 'omit') value = undefined;
  if (property === 'visible' && value === undefined) value = booleanLit(true);
  return { value, origin, keyframed };
}

/** An appearance protects all non-visibility properties from edits crossing
 * this frame. Keep it distinct from an explicitly authored property pin.
 * Ancestor reveals also introduce their descendants into the visible scene. */
export function isBuildAppearance(slide: Component, index: number, id: string): boolean {
  frameAt(slide, index);
  const path = (value: Value, parents: Component[]): Component[] | undefined => {
    if (value.kind === 'list') {
      for (const item of value.items) { const found = path(item, parents); if (found) return found; }
    }
    if (value.kind !== 'component') return undefined;
    const nodes = [...parents, value];
    if (objectId(value) === id) return nodes;
    for (const fill of value.fills) { const found = path(fill.value, nodes); if (found) return found; }
    for (const child of value.implicitChildren) { const found = path(child, nodes); if (found) return found; }
    return undefined;
  };
  const content = field(slide, 'content');
  const ancestors = content && path(content, []);
  if (!ancestors) throw new Error(`Unknown build object: ${id}`);
  const visible = (at: number) => ancestors.every(object => {
    const ancestorId = objectId(object);
    const value = ancestorId ? buildProperty(slide, at, ancestorId, 'visible').value : field(object, 'visible');
    return value?.kind !== 'boolean' || value.value;
  });
  return visible(index) && (index === 0 || !visible(index - 1));
}

export function buildEditRange(slide: Component, index: number, id: string,
  properties: readonly string[], direction: BuildDirection): BuildEditRange {
  frameAt(slide, index);
  objectAt(slide, id);
  checkProperties(properties);
  if (direction === 'everywhere') return { first: 0, last: buildFrames(slide).length - 1 };
  const protectAppearances = properties.some(property => property !== 'visible');
  if (direction === 'backward') {
    let first = index;
    while (first > 0) {
      // Editing an appearance itself may change it, but should not rewrite
      // the hidden interval before it. Later edits stop BEFORE that frame.
      if (protectAppearances && isBuildAppearance(slide, first, id)) break;
      const previous = changeAt(slide, first - 1, id);
      if (first > 1 && previous && properties.some(property => field(previous, property) !== undefined) ||
          protectAppearances && isBuildAppearance(slide, first - 1, id)) break;
      first--;
    }
    return { first, last: index };
  }
  let last = index;
  const count = buildFrames(slide).length;
  while (last + 1 < count) {
    if (protectAppearances && isBuildAppearance(slide, last + 1, id)) break;
    const next = changeAt(slide, last + 1, id);
    if (next && properties.some(property => field(next, property) !== undefined)) break;
    last++;
  }
  return { first: index, last };
}

/** Mutate one slide within a source transaction. Grouped edits (such as x/y)
 * share the earliest barrier, so both coordinates affect the same range. */
export function editBuildProperties(slide: Component, index: number, id: string,
  values: Readonly<Record<string, Value>>, direction: BuildDirection = 'forward'): BuildEditRange {
  const properties = Object.keys(values);
  const range = buildEditRange(slide, index, id, properties, direction);
  writeBuildRange(slide, id, values, range);
  return range;
}

function writeBuildRange(slide: Component, id: string, values: Readonly<Record<string, Value>>, range: BuildEditRange): void {
  const properties = Object.keys(values);
  const count = buildFrames(slide).length;
  // Capture BEFORE modifying the start. If a grouped edit stops at a barrier
  // for only x, y still needs restoring at that boundary.
  const restore = range.last + 1 < count ? properties.map(property => ({ property,
    value: copy(buildProperty(slide, range.last + 1, id, property).value ?? omitLit()),
    pinned: buildProperty(slide, range.last + 1, id, property).keyframed,
  })) : [];
  for (const property of properties) {
    setField(changeAt(slide, range.first, id, true)!, property, values[property]!);
    for (let current = range.first + 1; current <= range.last; current++) {
      const change = changeAt(slide, current, id);
      if (change) removeField(change, property);
      pruneChange(slide, current, id);
    }
  }
  for (const item of restore) {
    if (!item.pinned) setField(changeAt(slide, range.last + 1, id, true)!, item.property, item.value);
  }
}

/** Transform existing values without replacing later authored variants with
 * the selected frame's value. Whole-box style edits use this to clear inline
 * overrides while retaining every wording/list variant and content barrier. */
export function transformBuildProperty(slide: Component, id: string, property: string,
  range: BuildEditRange, transform: (value: Value | undefined) => Value | undefined): void {
  checkProperties([property]);
  frameAt(slide, range.first); frameAt(slide, range.last);
  objectAt(slide, id);
  if (range.first > range.last) throw new RangeError('Invalid build edit range');
  const starts = [range.first];
  for (let index = range.first + 1; index <= range.last; index++) {
    if (buildProperty(slide, index, id, property).keyframed) starts.push(index);
  }
  // Snapshot before writing: restoration boundaries must see the original
  // values, and callers cannot mutate the canonical tree through this callback.
  const segments = starts.map((first, index) => ({ first, last: (starts[index + 1] ?? range.last + 1) - 1,
    before: copy(buildProperty(slide, first, id, property).value) }));
  for (const segment of segments) {
    const after = transform(copy(segment.before));
    if (!sameValue(segment.before, after)) writeBuildRange(slide, id, { [property]: after ?? omitLit() }, segment);
  }
}

/** Authorship toggle is local to this frame, independent of edit direction.
 * Supply a resolved default when pinning an otherwise unauthored property. */
export function toggleBuildKeyframe(slide: Component, index: number, id: string,
  property: string, resolvedDefault?: Value): boolean {
  checkProperties([property]);
  const state = buildProperty(slide, index, id, property);
  if (state.keyframed) {
    if (index === 0) throw new Error('Initial values cannot inherit from an earlier frame');
    removeField(changeAt(slide, index, id)!, property);
    pruneChange(slide, index, id);
    return false;
  }
  setField(changeAt(slide, index, id, true)!, property, state.value ?? resolvedDefault ?? omitLit());
  return true;
}

export function addBuild(slide: Component, after: number, label?: string): BuildFrame {
  frameAt(slide, after);
  ensureBuildObjectIds(slide);
  const id = unusedId('build', new Set(buildFrames(slide).map(frame => frame.id)));
  const build = makeComponent('Build', [slotFill('id', stringLit(id)),
    ...(label === undefined ? [] : [slotFill('label', stringLit(label))]), slotFill('changes', listLit([]))]);
  listField(slide, 'builds', true)!.items.splice(after, 0, build);
  return frameAt(slide, after + 1);
}

/** Duplicate authored changes, not object identities. Duplicating the initial
 * frame captures its authored properties as explicit return-state keyframes. */
export function duplicateBuild(slide: Component, index: number,
  isStructuralProperty?: (object: Component, property: string) => boolean): BuildFrame {
  const original = frameAt(slide, index);
  const duplicate = addBuild(slide, index, `${original.label} copy`);
  const changes = listField(duplicate.component, 'changes', true)!;
  if (index === 0) {
    changes.items = buildObjects(slide).flatMap(object => {
      const fills = object.fills.filter(fill => fill.name !== 'id');
      // Child structure continues to belong to the scene; copying it into
      // a keyframe would duplicate object definitions and break identity.
      const properties = fills.filter(fill => isStructuralProperty
        ? !isStructuralProperty(object, fill.name) : !containsSceneObject(fill.value));
      return properties.length ? [makeComponent('Change', [slotFill('target', stringLit(objectId(object)!)), ...copy(properties)])] : [];
    });
  } else changes.items = copy(listField(original.component, 'changes')?.items ?? []);
  const styles = field(original.component, 'textStyles');
  if (styles) setField(duplicate.component, 'textStyles', styles);
  return duplicate;
}
function containsSceneObject(value: Value): boolean {
  if (value.kind === 'component') return !['Paragraph', 'Span', 'List', 'ListItem'].includes(value.name) && objectId(value) !== undefined;
  return value.kind === 'list' && value.items.some(containsSceneObject);
}

/** Build zero is the initial scene and cannot be moved or deleted. */
export function moveBuild(slide: Component, from: number, to: number): void {
  frameAt(slide, from); frameAt(slide, to);
  if (from === 0 || to === 0) throw new Error('The initial frame cannot be reordered');
  const items = listField(slide, 'builds')!.items;
  const [moving] = items.splice(from - 1, 1);
  items.splice(to - 1, 0, moving!);
}
export function removeBuild(slide: Component, index: number, registry: ComponentRegistry = {}): void {
  frameAt(slide, index);
  if (index === 0) throw new Error('The initial frame cannot be deleted');
  listField(slide, 'builds')!.items.splice(index - 1, 1);
  pruneTextStyleTargets(slide, registry);
}

/** Immutable projection: authored components and their owner spans survive;
 * keyframed values retain their own source locations for selection/editing. */
export function resolveBuild(slide: Component, index: number, registry: ComponentRegistry = {}): Component {
  frameAt(slide, index);
  const result = copy(slide);
  removeField(result, 'builds');
  removeField(result, 'textStyles');
  const authored = new Map(buildObjects(slide).flatMap(object => objectId(object) ? [[objectId(object)!, object] as const] : []));
  const visit = (value: Value): void => {
    if (value.kind === 'list') value.items.forEach(visit);
    if (value.kind !== 'component') return;
    const id = objectId(value);
    if (id && authored.has(id)) {
      const properties = new Set<string>();
      for (let current = 1; current <= index; current++) {
        const change = changeAt(slide, current, id);
        if (change) propertyNames(change).forEach(property => properties.add(property));
      }
      for (const property of properties) {
        const resolved = buildProperty(slide, index, id, property).value;
        if (resolved === undefined) removeField(value, property);
        else setField(value, property, resolved);
      }
    }
    value.fills.forEach(fill => visit(fill.value));
    value.implicitChildren.forEach(visit);
  };
  const content = field(result, 'content');
  if (content) visit(content);
  resolveTextStyles(slide, index, result, registry);
  return result;
}

function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  const semantic = (value: Value | undefined): string | undefined => JSON.stringify(value,
    (key, item) => ['span', 'bodySpan', 'leadingComments', 'trailingComments'].includes(key) ? undefined : item);
  return semantic(a) === semantic(b);
}

export function buildDifferences(slide: Component, index: number,
  defaultValue?: (object: Component, property: string) => Value | undefined,
  registry: ComponentRegistry = {}): BuildDifference[] {
  frameAt(slide, index);
  if (index === 0) return [];
  const resolvedBefore = new Map(buildObjects(resolveBuild(slide, index - 1, registry)).map(object => [objectId(object), object]));
  const resolvedAfter = new Map(buildObjects(resolveBuild(slide, index, registry)).map(object => [objectId(object), object]));
  return buildObjects(slide).flatMap(object => {
    const id = objectId(object);
    if (!id) return [];
    const properties = new Set(object.fills.map(fill => fill.name));
    for (let current = 1; current <= index; current++) {
      const change = changeAt(slide, current, id);
      if (change) propertyNames(change).forEach(property => properties.add(property));
    }
    const changed = [...properties].filter(property => property !== 'id' &&
      !sameValue(buildProperty(slide, index - 1, id, property).value ?? defaultValue?.(object, property),
        buildProperty(slide, index, id, property).value ?? defaultValue?.(object, property)));
    if (!changed.includes('content') && !sameValue(field(resolvedBefore.get(id)!, 'content'), field(resolvedAfter.get(id)!, 'content'))) changed.push('content');
    const visible = (at: number): boolean => {
      const value = buildProperty(slide, at, id, 'visible').value;
      return value?.kind !== 'boolean' || value.value;
    };
    return changed.length ? [{ id, entering: !visible(index - 1) && visible(index),
      exiting: visible(index - 1) && !visible(index), properties: changed }] : [];
  });
}

/** Validate source metadata before rendering or accepting a source edit. */
export function validateBuilds(slide: Component, registry: ComponentRegistry = {}): string[] {
  const errors: string[] = [];
  const objects = new Set<string>();
  for (const object of buildObjects(slide)) {
    const id = objectId(object);
    if (object.fills.filter(fill => fill.name === 'id').length > 1) errors.push('Duplicate object ID property');
    if (field(object, 'id') !== undefined && !id) errors.push('Object IDs must be nonempty strings');
    if (id && objects.has(id)) errors.push(`Duplicate build object ID: ${id}`);
    if (id) objects.add(id);
  }
  try {
    for (const frame of buildFrames(slide).slice(1)) {
      const targets = new Set<string>();
      for (const change of listField(frame.component, 'changes')?.items ?? []) {
        if (change.kind !== 'component' || change.name !== 'Change') { errors.push('Build.changes must contain Change components'); continue; }
        const target = text(field(change, 'target'));
        if (!target || !objects.has(target)) errors.push(`Unknown build object: ${target ?? '(missing target)'}`);
        if (target && targets.has(target)) errors.push(`Duplicate build target: ${target}`);
        if (target) targets.add(target);
        const names = change.fills.map(fill => fill.name);
        if (new Set(names).size !== names.length) errors.push('Duplicate property in build change');
        if (names.some(name => ['id', 'builds'].includes(name))) errors.push('Build changes cannot override object identity or build structure');
        const visible = field(change, 'visible');
        if (visible && visible.kind !== 'boolean' && visible.kind !== 'omit') errors.push('Visibility keyframes must be boolean');
      }
    }
  } catch (error) { errors.push((error as Error).message); }
  try { errors.push(...validateTextStyleKeys(slide, registry)); }
  catch (error) { errors.push((error as Error).message); }
  return errors;
}
