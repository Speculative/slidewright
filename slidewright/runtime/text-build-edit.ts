import type { Component, Value } from './ast.js';
import type { ComponentRegistry } from './contract.js';
import { listLit, makeComponent, slotFill } from './ast-builders.js';
import { buildFrames, buildObjects, buildProperty, editBuildProperties, objectId, transformBuildProperty, type BuildDirection } from './builds.js';
import { textRunId, textRuns, type TextRunChanges } from './text-runs.js';
import { copyTextStyleKeys, editBuildTextStyle, pruneTextStyleTargets, setBuildTextStylePin, setTextField, textField, textRunStyles, TEXT_STYLE_FIELDS, type RunStyles, type TextStyleProperty } from './text-builds.js';

export interface TextBuildDraft {
  preparedContent: Value | undefined;
  runChanges: TextRunChanges;
  /** True when wording, paragraphs, lists and custom inline values are intact. */
  styleOnly: boolean;
  pins?: readonly { run: string; property: TextStyleProperty; pinned: boolean }[];
}
export const sameTextValue = (a: unknown, b: unknown): boolean => JSON.stringify(a,
  (key, value) => ['span', 'bodySpan', 'leadingComments', 'trailingComments'].includes(key) ? undefined : value) === JSON.stringify(b,
  (key, value) => ['span', 'bodySpan', 'leadingComments', 'trailingComments'].includes(key) ? undefined : value);

// Transform only public editable run targets, preserving custom ownership.
function mapRuns(content: Value, registry: ComponentRegistry, replacements: Map<string, Component[]>): Value {
  const allowed = new Set(textRuns(content, registry));
  const visit = (value: Value): Value[] => {
    if (value.kind === 'list') return [{ ...value, items: value.items.flatMap(visit) }];
    if (value.kind !== 'component') return [value];
    const id = textRunId(value);
    const replacement = id && allowed.has(value) && replacements.get(id);
    if (replacement) return structuredClone(replacement);
    return [{ ...value, fills: value.fills.map(fill => {
      const next = visit(fill.value);
      return { ...fill, value: next.length === 1 ? next[0]! : listLit(next) };
    }) }];
  };
  const result = visit(content);
  return result.length === 1 ? result[0]! : listLit(result);
}
function withStyles(run: Component, styles: RunStyles): Component {
  const result = structuredClone(run);
  result.fills = result.fills.filter(fill => !TEXT_STYLE_FIELDS.includes(fill.name as typeof TEXT_STYLE_FIELDS[number]));
  for (const property of TEXT_STYLE_FIELDS) if (styles[property]) setTextField(result, property, styles[property]);
  return result;
}

/** Lower an accepted editor draft without making a formatting-only content
 * pin. Wording edits remain complete content values; there is no text merge. */
export function applyTextBuildDraft(slide: Component, index: number, owner: string, after: Value,
  draft: TextBuildDraft, direction: BuildDirection = 'forward', registry: ComponentRegistry = {}): void {
  const before = draft.preparedContent;
  if (!before) { editBuildProperties(slide, index, owner, { content: after }, direction); return; }
  const current = buildProperty(slide, index, owner, 'content');
  const rawStyles = textRunStyles(current.value, registry);
  const displayedStyles = textRunStyles(before, registry);
  const afterStyles = textRunStyles(after, registry);
  const ancestry = new Map(draft.runChanges.splits.map(split => [split.id, split.from]));
  const sourceId = (id: string): string => ancestry.has(id) ? sourceId(ancestry.get(id)!) : id;
  const baselineStyle = (id: string) => rawStyles.get(sourceId(id)) ?? displayedStyles.get(sourceId(id));
  const reset = new Map<string, Component[]>();
  for (const run of textRuns(after, registry)) {
    const id = textRunId(run)!;
    const styles = baselineStyle(id);
    if (styles) reset.set(id, [withStyles(run, styles)]);
  }
  const neutralAfter = mapRuns(after, registry, reset);
  const beforeReset = new Map<string, Component[]>();
  for (const run of textRuns(before, registry)) {
    const id = textRunId(run)!;
    beforeReset.set(id, [withStyles(run, baselineStyle(id) ?? {})]);
  }
  const preparedBefore = mapRuns(before, registry, beforeReset);
  // Legacy string shorthand becomes a structured text document when IDs are
  // persisted. A bare Span is not a valid TextBox.content value.
  const neutralBefore = preparedBefore.kind === 'list' ? preparedBefore
    : listLit([makeComponent('Paragraph', [slotFill('content', listLit([preparedBefore]))])]);

  // Materialize private preparation on its existing content owner only. Do
  // not infer identity between independently authored equal-wording variants.
  const origin = current.origin ?? 0;
  let last = origin;
  while (last + 1 < buildFrames(slide).length && !buildProperty(slide, last + 1, owner, 'content').keyframed) last++;
  transformBuildProperty(slide, owner, 'content', { first: origin, last }, () => neutralBefore);

  copyTextStyleKeys(slide, owner, draft.runChanges.splits);
  if (draft.styleOnly) {
    // A formatting split changes targeting, not wording. Give all matching
    // identified variants the same fragments, keeping each variant's styles.
    const fragments = new Map<string, Component[]>();
    for (const { from } of draft.runChanges.splits) {
      const root = sourceId(from);
      fragments.set(root, textRuns(neutralAfter, registry).filter(run => sourceId(textRunId(run)!) === root));
    }
    const originals = new Map(textRuns(neutralBefore, registry).map(run => [textRunId(run)!, run]));
    transformBuildProperty(slide, owner, 'content', { first: 0, last: buildFrames(slide).length - 1 }, content => {
      if (!content) return content;
      const replacements = new Map<string, Component[]>();
      const styles = textRunStyles(content, registry);
      for (const run of textRuns(content, registry)) {
        const id = textRunId(run)!;
        const pieces = fragments.get(id);
        if (pieces?.length && sameTextValue(textField(run, 'content'), textField(originals.get(id)!, 'content')))
          replacements.set(id, pieces.map(piece => withStyles(piece, styles.get(id) ?? {})));
      }
      return replacements.size ? mapRuns(content, registry, replacements) : content;
    });
  } else editBuildProperties(slide, index, owner, { content: neutralAfter }, direction);

  for (const [id, styles] of afterStyles) {
    const prior = displayedStyles.get(sourceId(id));
    if (!prior) continue; // Pasted/new runs own their initial styles in content.
    for (const property of TEXT_STYLE_FIELDS) if (!draft.pins?.some(pin => pin.run === id && pin.property === property) && !sameTextValue(prior[property], styles[property]))
      editBuildTextStyle(slide, index, owner, id, property, styles[property], direction, registry);
  }
  for (const pin of draft.pins ?? []) {
    if (pin.pinned) {
      // Pin exactly the draft's displayed value, even if unchanged. Pinning
      // is local and does not use the propagation direction.
      setBuildTextStylePin(slide, index, owner, pin.run, pin.property, true, registry,
        afterStyles.get(pin.run)?.[pin.property] ?? null);
    } else setBuildTextStylePin(slide, index, owner, pin.run, pin.property, false, registry);
  }
  pruneTextStyleTargets(slide, registry);
}
