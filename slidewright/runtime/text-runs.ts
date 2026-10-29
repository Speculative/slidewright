// Engine-independent identities for text keyframe targets. IDs are scoped to
// one text-document owner, not source offsets, words or editor positions.
import type { Component, Value } from './ast.js';
import type { ComponentRegistry } from './contract.js';
import { makeComponent, slotFill, stringLit } from './ast-builders.js';

const field = (node: Component, name: string) => node.fills.find(fill => fill.name === name)?.value;
export const textRunId = (node: Component): string | undefined => {
  const value = node.name === 'Span' && field(node, 'runId');
  return value && value.kind === 'string' ? value.value : undefined;
};

function editableSlots(node: Component, registry: ComponentRegistry): string[] {
  if (node.name === 'List') return ['items'];
  if (node.name === 'ListItem') return ['content', 'children'];
  if (node.name === 'Paragraph' || node.name === 'Span') return ['content'];
  const editing = registry[node.name]?.meta.inlineEditing;
  return editing?.mode === 'transparent' ? [editing.contentSlot] : [];
}

/** Owned, leaf, derived and reference internals remain atomic. */
export function textRuns(content: Value | undefined, registry: ComponentRegistry = {}): Component[] {
  const runs: Component[] = [];
  const visit = (value: Value | undefined) => {
    if (value?.kind === 'list') value.items.forEach(visit);
    if (value?.kind !== 'component') return;
    if (textRunId(value)) runs.push(value);
    for (const slot of editableSlots(value, registry)) visit(field(value, slot));
  };
  visit(content);
  return runs;
}

export interface TextRunChanges {
  /** New fragments inherit independently keyed styles from their source run. */
  splits: readonly { id: string; from: string }[];
  added: readonly string[];
  /** Removed from this variant. Other build variants may still use the ID. */
  removed: readonly string[];
}
export interface ReconciledTextRuns { content: Value; changes: TextRunChanges }

/** Prepare identities in a private draft. Only accepted edits persist them.
 * Reconciliation is deterministic across repeated lowerings of the same draft.
 * A split preserves the first fragment's ID and gives later fragments fresh
 * IDs with ancestry. Joining keeps the surviving runs distinct. */
export class TextRunIdentity {
  readonly prepared: Value | undefined;
  private authored: Set<string>;
  private preparedIds: Set<string>;
  private reserved: Set<string>;

  constructor(content: Value | undefined, private registry: ComponentRegistry = {}, reservedIds: readonly string[] = []) {
    const runs = textRuns(content, registry);
    this.authored = new Set(runs.map(run => textRunId(run)!));
    if (this.authored.size !== runs.length) throw new Error('Duplicate text run ID in one text document');
    this.reserved = new Set([...reservedIds, ...this.authored]);
    this.prepared = content && this.normalize(content, new Set(this.reserved), undefined).content;
    this.preparedIds = new Set(textRuns(this.prepared, registry).map(run => textRunId(run)!));
  }

  reconcile(content: Value, onRun?: (source: Component, id: string) => void): ReconciledTextRuns {
    // Reserve foreign IDs too: pasted material cannot accidentally retain its
    // original identity through allocation. Ordinary text clipboard HTML does
    // not contain run IDs; custom inline internals retain their own ownership.
    const reserved = new Set([...this.reserved, ...this.preparedIds, ...textRuns(content, this.registry).map(run => textRunId(run)!)]);
    const result = this.normalize(content, reserved, this.preparedIds, onRun);
    const ids = new Set(textRuns(result.content, this.registry).map(run => textRunId(run)!));
    return { content: result.content, changes: {
      splits: result.splits,
      added: [...ids].filter(id => !this.authored.has(id)),
      removed: [...this.authored].filter(id => !ids.has(id)),
    } };
  }

  private normalize(content: Value, reserved: Set<string>, known: Set<string> | undefined, onRun?: (source: Component, id: string) => void): {
    content: Value; splits: { id: string; from: string }[];
  } {
    const seen = new Set<string>();
    const splits: { id: string; from: string }[] = [];
    let serial = 0;
    const allocate = () => {
      while (reserved.has(`run-${++serial}`)) { /* skip authored/draft identities */ }
      const id = `run-${serial}`;
      reserved.add(id);
      return id;
    };
    const visit = (value: Value, insideRun = false): Value => {
      if (value.kind === 'list') {
        const items = value.items.map(item => visit(item, insideRun));
        return items.every((item, index) => item === value.items[index]) ? value : { ...value, items };
      }
      if (value.kind === 'omit') return value;
      if (value.kind === 'component') {
        const slots = editableSlots(value, this.registry);
        const idValue = value.name === 'Span' ? field(value, 'runId') : undefined;
        const priorId = textRunId(value);
        if (idValue && !priorId) throw new Error('Text run IDs must be nonempty strings');
        let id = priorId;
        if (id && (seen.has(id) || known && !known.has(id))) {
          id = allocate();
          if (known?.has(priorId!)) splits.push({ id, from: priorId! });
        }
        if (id) { seen.add(id); onRun?.(value, id); }
        const fills = value.fills.map(fill => {
          if (fill.name === 'runId' && id !== priorId) return { ...fill, value: stringLit(id!) };
          if (!slots.includes(fill.name)) return fill;
          // A transparent inline component owns a nested cursor. Its editable
          // children get their own identities even inside an outer run wrapper.
          const nested = !['Span', 'Paragraph', 'List', 'ListItem'].includes(value.name);
          const next = visit(fill.value, nested ? false : !!id || insideRun);
          return next === fill.value ? fill : { ...fill, value: next };
        });
        const node = fills.every((fill, index) => fill === value.fills[index]) ? value : { ...value, fills };
        if (id || insideRun || ['Span', 'Paragraph', 'List', 'ListItem'].includes(value.name)) return node;
        return makeComponent('Span', [slotFill('runId', stringLit(allocate())), slotFill('content', node)]);
      }
      if (insideRun || value.kind === 'string' && !value.value) return value;
      if (value.kind !== 'string' && value.kind !== 'name_ref') return value;
      return makeComponent('Span', [slotFill('runId', stringLit(allocate())), slotFill('content', value)]);
    };
    return { content: visit(content), splits };
  }
}
