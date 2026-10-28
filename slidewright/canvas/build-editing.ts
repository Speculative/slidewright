// Build-aware lowering is private to canvas transactions. Host/editor writes
// and undecorated document snapshots always describe canonical source.
import type { Component, SourceFile, Value } from '../runtime/ast.js';
import { booleanLit, numberLit, omitLit, slotFill, stringLit } from '../runtime/ast-builders.js';
import { buildFrames, buildObjects, editBuildProperties, objectId, resolveBuild, validateBuilds, type BuildDirection } from '../runtime/builds.js';
import { BUILTIN_META, type ComponentRegistry } from '../runtime/contract.js';
import { SourceMapping, sourceChanges, type DocumentSnapshot } from '../runtime/document.js';
import { parse } from '../runtime/parser.js';
import { sameAuthoredValue } from './source-preserving.js';
import { commitSourceEdit, findComponentAtSpan, type CommitResult } from './ast-edits.js';

export interface BuildEditingContext {
  slideIndex: number;
  buildIndex: number;
  direction?: BuildDirection;
  registry?: ComponentRegistry;
}
interface EditingState { canonical: DocumentSnapshot; context: BuildEditingContext }
const contexts = new WeakMap<DocumentSnapshot, EditingState>();
const clone = <T>(value: T): T => structuredClone(value);
const field = (node: Component | undefined, name: string): Value | undefined => node?.fills.find(fill => fill.name === name)?.value;
function set(node: Component, name: string, value: Value): void {
  const fill = node.fills.find(fill => fill.name === name);
  if (fill) fill.value = value;
  else node.fills.push(slotFill(name, value));
}
function slideAt(ast: SourceFile, index: number): Component | undefined {
  const slides = field(ast.items[0]!, 'slides');
  const slide = slides?.kind === 'list' ? slides.items[index] : undefined;
  return slide?.kind === 'component' && slide.name === 'Slide' ? slide : undefined;
}
function replaceSlide(ast: SourceFile, index: number, slide: Component): void {
  const slides = field(ast.items[0]!, 'slides');
  if (slides?.kind !== 'list') throw new Error('Missing slides');
  slides.items[index] = slide;
}

export function hasBuildEditingContext(snapshot: DocumentSnapshot): boolean { return contexts.has(snapshot); }

/** Read-only consumers such as element copying need the same effective scene
 * as mutations, while the host snapshot remains canonical. */
export function readBuildEditingAst(snapshot: DocumentSnapshot): SourceFile {
  const state = contexts.get(snapshot);
  if (!state) return snapshot.ast as SourceFile;
  const ast = clone(snapshot.ast) as SourceFile;
  const slide = slideAt(ast, state.context.slideIndex)!;
  replaceSlide(ast, state.context.slideIndex, resolveBuild(slide, state.context.buildIndex));
  return ast;
}

/** Derived handle only: ast/occurrences remain canonical and frozen. The
 * transaction pipeline projects a private mutable scene before invoking edits.
 * Recreate after each host revision (or frame/direction change). */
export function createBuildEditingSnapshot(snapshot: DocumentSnapshot, context: BuildEditingContext): DocumentSnapshot {
  const canonical = contexts.get(snapshot)?.canonical ?? snapshot;
  const slide = slideAt(canonical.ast as SourceFile, context.slideIndex);
  if (!slide || buildFrames(slide).length === 1) return canonical;
  if (!buildFrames(slide)[context.buildIndex]) throw new RangeError('Build index is outside the slide');
  const derived = Object.freeze({ ...canonical });
  contexts.set(derived, { canonical, context: { ...context } });
  return derived;
}

function structural(node: Component, name: string, context: BuildEditingContext): boolean {
  const meta = context.registry?.[node.name]?.meta ?? BUILTIN_META[node.name];
  const type = meta?.slots[name]?.type ?? meta?.params?.[name]?.type;
  if (type) return ['block', 'array<block>', 'slide-content', 'slide', 'array<slide>'].includes(type);
  // Registry-free compatibility for built-in scene containers. Text documents
  // (including List.children) belong to their nearest scene property owner.
  return name === 'children' && !['List', 'ListItem', 'Paragraph', 'Span'].includes(node.name) ||
    name === 'content' && !['TextBox', 'Paragraph', 'ListItem', 'Span'].includes(node.name) &&
    field(node, name)?.kind === 'component';
}
function sceneChildren(node: Component, context: BuildEditingContext): Component[] {
  const values = node.fills.filter(fill => structural(node, fill.name, context)).map(fill => fill.value);
  const children: Component[] = [...node.implicitChildren];
  for (const value of values) {
    if (value.kind === 'component') children.push(value);
    else if (value.kind === 'list') {
      for (const item of value.items) if (item.kind === 'component') children.push(item);
    }
  }
  return children;
}

export interface BuildMutation {
  ast: SourceFile;
  /** Canonical mutable tree on success; null rejects unsupported structure. */
  lower(): SourceFile | null;
  canonicalComponent(component: Component): Component | undefined;
}

/** Internal transaction hook. Keeps the source writer attached to canonical
 * nodes; projected keyframe payload spans are never source-write locations. */
export function prepareBuildMutation(snapshot: DocumentSnapshot | undefined, canonical: SourceFile,
  propertyGroups: readonly (readonly string[])[] = []): BuildMutation | undefined {
  const state = snapshot && contexts.get(snapshot);
  if (!state) return undefined;
  const { context } = state;
  const authored = slideAt(canonical, context.slideIndex)!;
  const effective = resolveBuild(authored, context.buildIndex);
  const ast = clone(canonical);
  replaceSlide(ast, context.slideIndex, effective);
  const originals = new Map<Component, Component>();
  const before = new Map<Component, Component>();
  const mapped = new Map<Component, Component>();
  const register = (node: Component): void => {
    const owner = findComponentAtSpan(canonical, node.span.start.offset, node.span.end.offset);
    if (!owner) throw new Error('Missing canonical scene owner');
    originals.set(node, owner);
    before.set(node, clone(node));
    mapped.set(node, owner);
    sceneChildren(node, context).forEach(register);
  };
  register(effective);
  // Capture original child references before a callback can move/delete them.
  const children = new Map([...originals.keys()].map(node => [node, sceneChildren(node, context)]));
  const baseline = clone(canonical);
  const lower = (): SourceFile | null => {
    try {
      const outside = clone(ast);
      replaceSlide(outside, context.slideIndex, clone(authored));
      if (!sameAuthoredValue(outside, baseline)) return null;
      const seen = new Set<Component>();
      const inserted: Component[] = [];
      const removed: Component[] = [];
      const changes: { owner: Component; values: Record<string, Value> }[] = [];
      const lowerNode = (node: Component): Component => {
        if (seen.has(node)) throw new Error('Shared or moved scene object');
        seen.add(node);
        const owner = originals.get(node);
        if (!owner) {
          // An inserted subtree cannot contain an existing object (group/move).
          const check = (child: Component): void => {
            if (originals.has(child)) throw new Error('Grouping is not supported on builds');
            sceneChildren(child, context).forEach(check);
          };
          check(node);
          const added = clone(node);
          const pair = (a: Component, b: Component): void => {
            mapped.set(a, b);
            sceneChildren(a, context).forEach((child, index) => pair(child, sceneChildren(b, context)[index]!));
          };
          pair(node, added);
          inserted.push(added);
          return added;
        }
        const previous = before.get(node)!;
        if (node.name !== previous.name || objectId(node) !== objectId(previous)) throw new Error('Object identity cannot change');
        const oldChildren = children.get(node)!;
        const nextChildren = sceneChildren(node, context);
        if (nextChildren.some(child => originals.has(child) && !oldChildren.includes(child))) throw new Error('Moving scene objects is not supported');
        const retained = nextChildren.filter(child => oldChildren.includes(child));
        if (retained.some((child, i) => child !== oldChildren.filter(c => nextChildren.includes(c))[i])) throw new Error('Reordering scene objects is not supported');
        const values: Record<string, Value> = {};
        for (const name of new Set([...previous.fills, ...node.fills].map(fill => fill.name))) {
          const was = field(previous, name);
          const now = field(node, name);
          if (!structural(previous, name, context) && !structural(node, name, context)) {
            if (!sameAuthoredValue(was, now)) values[name] = clone(now ?? omitLit());
            continue;
          }
          if (sameAuthoredValue(was, now)) continue;
          const oldItems = was?.kind === 'list' ? oldChildren.filter(child =>
            was.items.some(item => item.span.start.offset === child.span.start.offset && item.span.end.offset === child.span.end.offset)) : [];
          if (now?.kind === 'list' && (was === undefined || was.kind === 'list')) {
            if (now.items.some(item => item.kind !== 'component')) throw new Error('Scene lists must contain components');
            const next = now.items as Component[];
            // Retain deleted definitions in their original positions, hiding
            // them through visibility. Insertions retain requested ordering.
            const merged: Component[] = [];
            let cursor = 0;
            for (const child of next) {
              if (oldItems.includes(child)) {
                while (cursor < oldItems.indexOf(child)) merged.push(originals.get(oldItems[cursor++]!)!);
                cursor++;
              }
              merged.push(lowerNode(child));
            }
            while (cursor < oldItems.length) merged.push(originals.get(oldItems[cursor++]!)!);
            set(owner, name, { ...clone(now), items: merged });
          } else if (now === undefined && (was?.kind === 'component' || was?.kind === 'list')) {
            // Keep the definition in its source slot; removal is visibility.
          } else if (now?.kind === 'component' && was?.kind === 'component' &&
              originals.has(now) && now.span.start.offset === was.span.start.offset) {
            set(owner, name, lowerNode(now));
          } else if (!was && now?.kind === 'component') set(owner, name, lowerNode(now));
          else throw new Error('Replacing structural slots is not supported on builds');
        }
        // Position gestures include unchanged coordinates as part of their
        // range. A y keyframe must also stop a purely horizontal body drag.
        for (const group of propertyGroups) {
          if (!group.some(name => name in values)) continue;
          for (const name of group) {
            const current = field(node, name);
            const fallback = context.registry?.[node.name]?.meta.params?.[name]?.default;
            if (current) values[name] = clone(current);
            else if (typeof fallback === 'number') values[name] = numberLit(fallback);
          }
        }
        // Unchanged structural slots still contain independently edited objects.
        for (const child of nextChildren) if (!seen.has(child)) lowerNode(child);
        if (!sameAuthoredValue(previous.implicitChildren, node.implicitChildren)) {
          if (oldChildren.length !== previous.implicitChildren.length || node.fills.some(fill => structural(node, fill.name, context))) throw new Error('Mixed child syntax changes are not supported');
          const merged = [...oldChildren];
          for (let i = 0; i < nextChildren.length; i++) {
            const child = nextChildren[i]!;
            if (!merged.includes(child)) merged.splice(i, 0, child);
          }
          owner.implicitChildren = merged.map(child => mapped.get(child) ?? originals.get(child)!);
        }
        oldChildren.filter(child => !nextChildren.includes(child)).forEach(child => removed.push(originals.get(child)!));
        if (owner === authored) {
          // Labels, notes and slide chrome belong to the slide, not to an
          // object keyframe. Structural scene changes are handled above.
          for (const [name, value] of Object.entries(values)) set(owner, name, value);
        } else if (Object.keys(values).length) changes.push({ owner, values });
        return owner;
      };
      lowerNode(effective);
      const usedIds = new Set(buildObjects(authored).map(objectId).filter((id): id is string => !!id));
      const assignId = (owner: Component, fresh = false): void => {
        if (objectId(owner) && !fresh) return;
        let index = 1;
        while (usedIds.has(`object-${index}`)) index++;
        const id = `object-${index}`;
        set(owner, 'id', stringLit(id));
        usedIds.add(id);
      };
      for (const { owner } of changes) assignId(owner);
      const identifyInserted = (owner: Component): void => {
        const scene = new Set(sceneChildren(owner, context));
        assignId(owner, true);
        const visit = (value: Value): void => {
          if (value.kind === 'list') value.items.forEach(visit);
          if (value.kind !== 'component') return;
          if (scene.has(value)) identifyInserted(value);
          else {
            // Clipboard payloads may also contain inline IDs from the same
            // slide. Keep the pasted subtree independent of those originals.
            if (objectId(value)) assignId(value, true);
            value.fills.forEach(fill => visit(fill.value));
            value.implicitChildren.forEach(visit);
          }
        };
        owner.fills.forEach(fill => visit(fill.value));
        owner.implicitChildren.forEach(visit);
      };
      inserted.forEach(identifyInserted);
      removed.forEach(owner => assignId(owner));
      for (const { owner, values } of changes) editBuildProperties(authored, context.buildIndex, objectId(owner)!, values, context.direction);
      for (const owner of inserted) {
        if (context.buildIndex > 0) {
          set(owner, 'visible', booleanLit(false));
          editBuildProperties(authored, context.buildIndex, objectId(owner)!, { visible: booleanLit(true) }, 'forward');
        }
      }
      for (const owner of removed) editBuildProperties(authored, context.buildIndex, objectId(owner)!, { visible: booleanLit(false) }, 'forward');
      if (validateBuilds(authored).length) return null;
      return canonical;
    } catch { return null; }
  };
  return { ast, lower, canonicalComponent: component => {
    const direct = mapped.get(component);
    if (direct) return direct;
    // A selected inline node belongs to the nearest scene property owner.
    const owner = [...originals.keys()].reverse().find(node => {
      const visit = (value: Value): boolean => value === component || value.kind === 'list' && value.items.some(visit) ||
        value.kind === 'component' && (value.fills.some(fill => visit(fill.value)) || value.implicitChildren.some(visit));
      return node.fills.some(fill => !structural(node, fill.name, context) && visit(fill.value));
    });
    return owner && mapped.get(owner);
  } };
}

/** Explicit inspector route, including materialized/default-valued fields. */
export function commitBuildPropertyEdit(source: string, label: string, snapshot: DocumentSnapshot,
  owner: Component | string, values: Readonly<Record<string, Value>>): CommitResult | null {
  return commitBuildPropertyEdits(source, label, snapshot, [{ owner, values }]);
}

export function buildEditingDirection(snapshot?: DocumentSnapshot): BuildDirection | undefined {
  return snapshot && contexts.get(snapshot)?.context.direction;
}

/** Explicit multi-object operation; equal values still carry edit intent. */
export function commitBuildPropertyEdits(source: string, label: string, snapshot: DocumentSnapshot,
  edits: readonly { owner: Component | string; values: Readonly<Record<string, Value>> }[]): CommitResult | null {
  const state = contexts.get(snapshot);
  if (!state) return null;
  return commitSourceEdit(source, label, ast => {
    const slide = slideAt(ast, state.context.slideIndex)!;
    const selected: Component[] = [];
    try {
      for (const { owner, values } of edits) {
        const id = typeof owner === 'string' ? owner : objectId(owner);
        if (!id) return null;
        const visit = (node: Component): Component | undefined => objectId(node) === id ? node :
          sceneChildren(node, state.context).map(visit).find(Boolean);
        const target = visit(slide);
        if (!target || Object.keys(values).some(name => structural(target, name, state.context))) return null;
        editBuildProperties(slide, state.context.buildIndex, id, values, state.context.direction);
        selected.push(target);
      }
      if (validateBuilds(slide).length) return null;
    } catch { return null; }
    return { selectComponents: selected };
  }, state.canonical);
}

/** Route a raw inspector splice by its ORIGINAL property range, rather than
 * comparing projected candidate scenes (an initial edit may be masked). Nested
 * text edits capture the complete effective owner property as one keyframe. */
export function commitBuildSourceCandidate(candidate: string, label: string, snapshot: DocumentSnapshot): CommitResult | null {
  const state = contexts.get(snapshot);
  if (!state || candidate === snapshot.source) return null;
  const changes = sourceChanges(snapshot.source, candidate);
  const edit = changes[0]!;
  const mapping = new SourceMapping(snapshot.revision, snapshot.revision + 1, snapshot.source.length, changes);
  const authored = slideAt(snapshot.ast as SourceFile, state.context.slideIndex)!;
  const effective = resolveBuild(authored, state.context.buildIndex);
  const parsed = parse(candidate, label);
  if (parsed.diagnostics.some(d => d.severity === 'error')) return null;
  const owners: Component[] = [];
  const collect = (node: Component): void => { owners.push(node); sceneChildren(node, state.context).forEach(collect); };
  collect(effective);
  // Inspect both effective and initial fills: a candidate can target either.
  for (const owner of owners.reverse()) {
    const initial = findComponentAtSpan(snapshot.ast as SourceFile, owner.span.start.offset, owner.span.end.offset)!;
    for (const fill of [...owner.fills, ...initial.fills]) {
      const range = fill.value.span;
      if (structural(owner, fill.name, state.context) || edit.start < range.start.offset || edit.end > range.end.offset) continue;
      const start = mapping.mapOffset(range.start.offset, 'left');
      const end = mapping.mapOffset(range.end.offset, 'right');
      if (start === null || end === null) return null;
      const fragment = parse(`Value { value: ${candidate.slice(start, end)} }`, label);
      const value = fragment.ast.items[0]?.fills[0]?.value;
      if (!value || fragment.diagnostics.some(d => d.severity === 'error')) return null;
      if (owner === effective) return commitSourceEdit(snapshot.source, label, ast => {
        set(slideAt(ast, state.context.slideIndex)!, fill.name, value);
        return {};
      }, state.canonical);
      return commitBuildPropertyEdit(snapshot.source, label, snapshot, owner, { [fill.name]: value });
    }
  }
  return null;
}
