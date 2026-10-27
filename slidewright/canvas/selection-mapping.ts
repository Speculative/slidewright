import type { DocumentUpdate } from '../runtime/document.js';
import type { SelectionTarget } from './selection-target.js';

/** Preserve authored occurrence identity instead of following a sibling index.
 * Retired owners never transfer selection to a different, adjacent component. */
export function mapSelectionTargets(targets: readonly SelectionTarget[], update: DocumentUpdate): SelectionTarget[] {
  const before = new Map(update.before.occurrences.map(item => [`${item.range.start}-${item.range.end}`, item]));
  const after = new Map(update.snapshot.occurrences.map(item => [item.handle, item]));
  return targets.flatMap((target): SelectionTarget[] => {
    if (target.kind === 'slide') return [target];
    const range = target.kind === 'component' ? target.span : target.parentSpan;
    const prior = before.get(`${range.start}-${range.end}`);
    const current = prior ? after.get(prior.handle) : undefined;
    if (!current) return [];
    if (target.kind === 'component') return [{ kind: 'component', span: current.range }];
    const fill = current.component.fills.find(fill => fill.name === target.slotName);
    if (fill) return [{ kind: 'slot', parentSpan: current.range, slotName: target.slotName,
      span: { start: fill.span.start.offset, end: fill.span.end.offset } }];
    return target.kind === 'empty-slot' ? [{ ...target, parentSpan: current.range }] : [];
  });
}
