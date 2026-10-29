// Independent text-run style keys. Targets are (scene owner ID, run ID), never
// source offsets or editor positions. Content keys continue to own wording.
import type { Component, Value } from './ast.js';
import type { ComponentRegistry } from './contract.js';
import { booleanLit, listLit, makeComponent, nameRef, numberLit, omitLit, slotFill, stringLit } from './ast-builders.js';
import { buildEditRange, buildFrames, buildObjects, buildProperty, objectId, type BuildDirection, type BuildEditRange, type BuildProperty } from './builds.js';
import { textRunId, textRuns } from './text-runs.js';

export const TEXT_STYLE_FIELDS = ['strokeWidth', 'strokeColor', 'color', 'font', 'size', 'weight', 'letterSpacing', 'italic', 'underline', 'strikethrough', 'href'] as const;
export type TextStyleProperty = typeof TEXT_STYLE_FIELDS[number];
export type RunStyles = Partial<Record<TextStyleProperty, Value>>;
export const textField = (node: Component, name: string) => node.fills.find(fill => fill.name === name)?.value;
const str = (value: Value | undefined) => value?.kind === 'string' ? value.value : undefined;
const clone = <T>(value: T): T => structuredClone(value);
export function setTextField(node: Component, name: string, value: Value | undefined): void {
  const fill = node.fills.find(fill => fill.name === name);
  if (value === undefined) node.fills = node.fills.filter(fill => fill.name !== name);
  else if (fill) fill.value = clone(value);
  else node.fills.push(slotFill(name, clone(value)));
}

/** Inherited inline styles, excluding text-box defaults. Opaque internals are
 * not editable targets; transparent children keep their own run identities. */
export function textRunStyles(content: Value | undefined, registry: ComponentRegistry = {}): Map<string, RunStyles> {
  const result = new Map<string, RunStyles>();
  const allowed = new Set(textRuns(content, registry));
  const visit = (value: Value | undefined, inherited: RunStyles) => {
    if (value?.kind === 'list') value.items.forEach(item => visit(item, inherited));
    if (value?.kind !== 'component') return;
    const styles = { ...inherited };
    if (value.name === 'Span') for (const property of TEXT_STYLE_FIELDS) {
      const setting = textField(value, property);
      if (setting && setting.kind !== 'omit') styles[property] = setting;
    }
    const id = textRunId(value);
    if (id && allowed.has(value)) result.set(id, styles);
    const editing = registry[value.name]?.meta.inlineEditing;
    const slots = value.name === 'List' ? ['items'] : value.name === 'ListItem' ? ['content', 'children']
      : ['Paragraph', 'Span'].includes(value.name) ? ['content']
      : editing?.mode === 'transparent' ? [editing.contentSlot] : [];
    slots.forEach(slot => visit(textField(value, slot), styles));
  };
  visit(content, {});
  return result;
}

function frame(slide: Component, index: number): Component {
  const found = buildFrames(slide)[index];
  if (!found) throw new RangeError('Build index is outside the slide');
  return found.component;
}
export function textStyleKeys(slide: Component, index: number): Component[] {
  const value = textField(frame(slide, index), 'textStyles');
  return value?.kind === 'list' ? value.items.filter((item): item is Component => item.kind === 'component' && item.name === 'TextStyle') : [];
}
function key(slide: Component, index: number, owner: string, run: string, create = false): Component | undefined {
  const found = textStyleKeys(slide, index).find(item => str(textField(item, 'target')) === owner && str(textField(item, 'run')) === run);
  if (found || !create) return found;
  const node = makeComponent('TextStyle', [slotFill('target', stringLit(owner)), slotFill('run', stringLit(run))]);
  const parent = frame(slide, index);
  const list = textField(parent, 'textStyles');
  if (list?.kind === 'list') list.items.push(node);
  else parent.fills.push(slotFill('textStyles', listLit([node])));
  return node;
}
function prune(slide: Component, index: number) {
  const parent = frame(slide, index);
  const list = textField(parent, 'textStyles');
  if (list?.kind !== 'list') return;
  list.items = list.items.filter(item => item.kind !== 'component' || item.fills.some(fill => TEXT_STYLE_FIELDS.includes(fill.name as TextStyleProperty)));
  if (!list.items.length) setTextField(parent, 'textStyles', undefined);
}
export function buildTextStyle(slide: Component, index: number, owner: string, run: string, property: TextStyleProperty,
  registry: ComponentRegistry = {}): BuildProperty {
  const raw = buildProperty(slide, index, owner, 'content').value;
  let value = textRunStyles(raw, registry).get(run)?.[property];
  let origin: number | null = value ? 0 : null;
  let keyframed = false;
  for (let at = 0; at <= index; at++) {
    const next = key(slide, at, owner, run);
    const setting = next && textField(next, property);
    if (setting) { value = setting.kind === 'omit' ? undefined : setting; origin = at; }
    if (at === index) keyframed = setting !== undefined;
  }
  return { value, origin, keyframed };
}
export function textStyleEditRange(slide: Component, index: number, owner: string, run: string, property: TextStyleProperty,
  direction: BuildDirection): BuildEditRange {
  // A nonexistent scene property supplies appearance boundaries only. Content
  // and other style-property keys must not stop this independent channel.
  const appearance = buildEditRange(slide, index, owner, ['__text_style'], direction);
  if (direction === 'everywhere') return appearance;
  const pinned = (at: number) => { const entry = key(slide, at, owner, run); return !!entry && textField(entry, property) !== undefined; };
  let { first, last } = appearance;
  if (direction === 'forward') {
    for (let at = index + 1; at <= last; at++) if (pinned(at)) { last = at - 1; break; }
  } else {
    for (let at = index - 1; at >= first; at--) if (pinned(at)) { first = at + 1; break; }
  }
  return { first, last };
}
export function editBuildTextStyle(slide: Component, index: number, owner: string, run: string,
  property: TextStyleProperty, value: Value | undefined, direction: BuildDirection = 'forward', registry: ComponentRegistry = {}): BuildEditRange {
  const range = textStyleEditRange(slide, index, owner, run, property, direction);
  writeTextStyleRange(slide, owner, run, property, value, range, registry);
  return range;
}
function writeTextStyleRange(slide: Component, owner: string, run: string, property: TextStyleProperty,
  value: Value | undefined, range: BuildEditRange, registry: ComponentRegistry): void {
  const boundary = range.last + 1;
  const restore = boundary < buildFrames(slide).length ? buildTextStyle(slide, boundary, owner, run, property, registry) : undefined;
  setTextField(key(slide, range.first, owner, run, true)!, property, value ?? omitLit());
  for (let at = range.first + 1; at <= range.last; at++) {
    const entry = key(slide, at, owner, run);
    if (entry) setTextField(entry, property, undefined);
    prune(slide, at);
  }
  if (restore && !restore.keyframed) setTextField(key(slide, boundary, owner, run, true)!, property, restore.value ?? omitLit());
}
export function setBuildTextStylePin(slide: Component, index: number, owner: string, run: string,
  property: TextStyleProperty, pinned: boolean, registry: ComponentRegistry = {}, displayed?: Value | null): void {
  if (index === 0 && !pinned) throw new Error('Initial style values cannot inherit');
  if (pinned) setTextField(key(slide, index, owner, run, true)!, property,
    displayed === null ? omitLit() : displayed ?? buildTextStyle(slide, index, owner, run, property, registry).value ?? omitLit());
  else {
    const entry = key(slide, index, owner, run);
    if (entry) setTextField(entry, property, undefined);
    prune(slide, index);
  }
}

export function copyTextStyleKeys(slide: Component, owner: string, splits: readonly { id: string; from: string }[]): void {
  for (const { id, from } of splits) for (let at = 0; at < buildFrames(slide).length; at++) {
    const source = key(slide, at, owner, from);
    if (!source) continue;
    for (const property of TEXT_STYLE_FIELDS) {
      const setting = textField(source, property);
      if (setting) setTextField(key(slide, at, owner, id, true)!, property, setting);
    }
  }
}

/** `omit` removes inline emphasis all the way to the owning box default,
 * including when the source has an outer styled Span. */
function boxStyle(owner: Component, property: TextStyleProperty, registry: ComponentRegistry): Value | undefined {
  const boxProperty = property === 'size' ? 'fontSize' : property === 'weight' ? 'fontWeight' : property;
  const authored = textField(owner, boxProperty);
  if (authored) return authored;
  const schema = registry[owner.name]?.meta.params?.[boxProperty];
  const value = schema?.default;
  if (typeof value === 'number') return numberLit(value);
  if (typeof value === 'boolean') return booleanLit(value);
  if (typeof value === 'string') return schema?.type === 'color-token' ? nameRef(value) : stringLit(value);
  if (['italic', 'underline', 'strikethrough'].includes(property)) return booleanLit(false);
  if (property === 'strokeWidth' || property === 'letterSpacing') return numberLit(0);
  if (property === 'href') return stringLit('');
  return undefined;
}

export function clearTextStyleOverrides(slide: Component, owner: string, property: TextStyleProperty,
  range: BuildEditRange, registry: ComponentRegistry = {}): void {
  const runs = new Set<string>();
  for (let at = 0; at < buildFrames(slide).length; at++)
    textRuns(buildProperty(slide, at, owner, 'content').value, registry).forEach(run => runs.add(textRunId(run)!));
  for (const run of runs) {
    // Only existing independent channels need a reset; content transforms
    // already cleared ordinary authored inline formatting.
    if (buildFrames(slide).some(frame => { const entry = key(slide, frame.index, owner, run); return entry && textField(entry, property); }))
      writeTextStyleRange(slide, owner, run, property, undefined, range, registry);
  }
}

/** Apply keys after resolving wording. Unused targets in this variant are
 * dormant, because a different build's wording may still contain the run. */
export function resolveTextStyles(slide: Component, index: number, scene: Component, registry: ComponentRegistry = {}): void {
  const owners = new Map(buildObjects(scene).flatMap(object => objectId(object) ? [[objectId(object)!, object] as const] : []));
  const settings = new Map<string, Map<string, RunStyles>>();
  for (let at = 0; at <= index; at++) for (const entry of textStyleKeys(slide, at)) {
    const target = str(textField(entry, 'target'))!, run = str(textField(entry, 'run'))!;
    let runs = settings.get(target);
    if (!runs) settings.set(target, runs = new Map());
    const styles = { ...runs.get(run) };
    for (const property of TEXT_STYLE_FIELDS) {
      const setting = textField(entry, property);
      if (setting) styles[property] = setting;
    }
    runs.set(run, styles);
  }
  for (const [id, runs] of settings) {
    const owner = owners.get(id);
    if (!owner) continue;
    const content = textField(owner, 'content');
    for (const run of textRuns(content, registry)) {
      const styles = runs.get(textRunId(run)!);
      if (!styles) continue;
      for (const property of TEXT_STYLE_FIELDS) {
        const setting = styles[property];
        if (setting) setTextField(run, property, setting.kind === 'omit' ? boxStyle(owner, property, registry) : setting);
      }
    }
  }
}

/** Keep keys used by any authored variant; remove only globally lost targets. */
export function pruneTextStyleTargets(slide: Component, registry: ComponentRegistry = {}): void {
  const used = new Map<string, Set<string>>();
  for (const object of buildObjects(slide)) {
    const id = objectId(object);
    if (!id) continue;
    const runs = new Set<string>();
    for (let at = 0; at < buildFrames(slide).length; at++)
      textRuns(buildProperty(slide, at, id, 'content').value, registry).forEach(run => runs.add(textRunId(run)!));
    used.set(id, runs);
  }
  for (let at = 0; at < buildFrames(slide).length; at++) {
    const list = textField(frame(slide, at), 'textStyles');
    if (list?.kind !== 'list') continue;
    list.items = list.items.filter(item => item.kind !== 'component' || used.get(str(textField(item, 'target'))!)?.has(str(textField(item, 'run'))!));
    prune(slide, at);
  }
}

export function validateTextStyleKeys(slide: Component, registry: ComponentRegistry = {}): string[] {
  const errors: string[] = [];
  const owners = new Map(buildObjects(slide).flatMap(object => objectId(object) ? [[objectId(object)!, object] as const] : []));
  for (const frame of buildFrames(slide)) {
    const list = textField(frame.component, 'textStyles');
    if (!list) continue;
    if (frame.component.fills.filter(fill => fill.name === 'textStyles').length > 1) errors.push('Duplicate textStyles metadata');
    if (list.kind !== 'list') { errors.push('textStyles must be a list'); continue; }
    const used = new Set<string>();
    for (const item of list.items) {
      if (item.kind !== 'component' || item.name !== 'TextStyle') { errors.push('textStyles must contain TextStyle components'); continue; }
      const target = str(textField(item, 'target')), run = str(textField(item, 'run'));
      if (!target || !owners.has(target)) errors.push(`Unknown text style owner: ${target ?? '(missing)'}`);
      if (!run) errors.push('TextStyle.run must be a nonempty string');
      const pair = JSON.stringify([target, run]);
      if (used.has(pair)) errors.push('Duplicate text style target');
      used.add(pair);
      if (item.implicitChildren.length) errors.push('TextStyle does not accept implicit children');
      const names = item.fills.map(fill => fill.name);
      if (new Set(names).size !== names.length) errors.push('Duplicate TextStyle property');
      if (names.some(name => !['target', 'run', ...TEXT_STYLE_FIELDS].includes(name))) errors.push('Unknown TextStyle property');
      if (target && run && owners.has(target) && !buildFrames(slide).some(frame =>
        textRuns(buildProperty(slide, frame.index, target, 'content').value, registry).some(node => textRunId(node) === run)))
        errors.push(`Unknown text run: ${target}/${run}`);
    }
  }
  return errors;
}
