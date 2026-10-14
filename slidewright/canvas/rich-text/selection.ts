import { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { TextPoint, TextRange } from './bindings.js';

// Original source identity and session leaf identity diverge on split.
// Keep the former for lowering, the latter for stable public selections.
export function leafIdentityPlugin(): Plugin {
  let serial = 0;
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some(tr => tr.docChanged)) return null;
      const owners = new Map<string, number>();
      const reassigned = new Map<string, string>();
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (!node.isInline || (!node.isText && !node.isAtom)) return;
        const mark = node.marks.find(m => m.type.name === 'source');
        const owner = state.doc.resolve(pos).start();
        let id: string | undefined = mark?.attrs.id;
        const author = mark?.attrs.authoredId ?? id ?? null;
        if (id && owners.has(id) && owners.get(id) !== owner) {
          const key = `${id}:${owner}`;
          if (!reassigned.has(key)) reassigned.set(key, `draft-${++serial}`);
          id = reassigned.get(key)!;
        }
        if (!id) id = `draft-${++serial}`;
        owners.set(id, owner);
        if (id !== mark?.attrs.id) tr.addMark(pos, pos + node.nodeSize, state.schema.marks.source!.create({ id, authoredId: author, ancestry: mark?.attrs.ancestry ?? [] }));
      });
      return tr.steps.length ? tr.setMeta('addToHistory', false) : null;
    },
  });
}

interface Segment { id: string; from: number; to: number; offset: number }
function segments(doc: PMNode): Segment[] {
  const result: Segment[] = [];
  const offsets = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (!node.isInline || (!node.isText && !node.isAtom)) return;
    const id = node.marks.find(m => m.type.name === 'source')?.attrs.id;
    if (!id) return;
    const offset = offsets.get(id) ?? 0;
    result.push({ id, from: pos, to: pos + node.nodeSize, offset });
    offsets.set(id, offset + node.nodeSize);
  });
  return result;
}
export function pointAt(doc: PMNode, position: number, affinity: TextPoint['affinity'] = 'after'): TextPoint | null {
  const all = segments(doc);
  const containing = all.filter(s => s.from <= position && position <= s.to);
  const selected = affinity === 'after' ? containing.find(s => s.from === position) ?? containing.at(-1) : containing.find(s => s.to === position) ?? containing[0];
  const closest = selected ?? (affinity === 'after' ? all.find(s => s.from > position) ?? all.at(-1) : all.filter(s => s.to < position).at(-1) ?? all[0]);
  return closest ? { nodeId: closest.id, offset: closest.offset + Math.max(0, Math.min(closest.to - closest.from, position - closest.from)), affinity } : null;
}
export function positionAt(doc: PMNode, point: TextPoint): number | null {
  const matching = segments(doc).filter(s => s.id === point.nodeId && s.offset <= point.offset && point.offset <= s.offset + s.to - s.from);
  const segment = point.affinity === 'after' ? matching.at(-1) : matching[0];
  return segment ? segment.from + point.offset - segment.offset : null;
}
export function textRange(doc: PMNode, anchor: number, head: number): TextRange | null {
  const first = pointAt(doc, anchor, anchor <= head ? 'after' : 'before');
  const last = pointAt(doc, head, anchor <= head ? 'before' : 'after');
  return first && last ? { anchor: first, focus: last } : null;
}
