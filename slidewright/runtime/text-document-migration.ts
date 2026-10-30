import type { Component } from './ast.js';
import { buildFrames, buildObjects, objectId } from './builds.js';
import { stringLit } from './ast-builders.js';

/** Rename a legacy wording channel atomically, including its build barriers. */
export function migrateTextDocumentParam(slide: Component, owner: Component, param: string, defaultValue = ''): void {
  const id = objectId(owner);
  const definition = id ? buildObjects(slide).find(node => objectId(node) === id) : owner;
  if (!definition) throw new Error('Missing text document owner');
  const initialLegacy = definition.fills.find(fill => fill.name === param);
  const initialContent = definition.fills.find(fill => fill.name === 'content');
  let fallback = initialLegacy && initialLegacy.value.kind !== 'omit' ? initialLegacy.value : stringLit(defaultValue);
  let usingFallback = !initialContent || initialContent.value.kind === 'omit';
  if (usingFallback) {
    if (initialContent) initialContent.value = fallback;
    else if (initialLegacy) initialLegacy.name = 'content';
  }
  if (!id) return;
  for (const frame of buildFrames(slide)) {
    const changes = frame.component.fills.find(fill => fill.name === 'changes')?.value;
    if (changes?.kind !== 'list') continue;
    const matching: Component[] = [];
    for (const change of changes.items) {
      if (change.kind !== 'component') continue;
      const target = change.fills.find(fill => fill.name === 'target')?.value;
      if (target?.kind === 'string' && target.value === id) matching.push(change);
    }
    const legacy = matching.flatMap(change => change.fills).find(fill => fill.name === param);
    const content = matching.flatMap(change => change.fills).find(fill => fill.name === 'content');
    if (legacy) fallback = legacy.value.kind === 'omit' ? stringLit(defaultValue) : legacy.value;
    if (content) usingFallback = content.value.kind === 'omit';
    if (!usingFallback) continue;
    if (content) content.value = fallback;
    else if (legacy) { legacy.name = 'content'; legacy.value = fallback; }
  }
}
