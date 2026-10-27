import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeckDocument } from '../../runtime/document.js';
import { mapSelectionTargets } from '../selection-mapping.js';
import type { SelectionTarget } from '../selection-target.js';

const source = 'Deck { slides: [Slide { content: Freeform { children: [Box {} TextBox { content: "later" }] } }] }';
test('occurrence selection follows insertion and retires on deletion instead of choosing a neighbor', () => {
  const document = new DeckDocument(source, 'selection.sw');
  const box = document.snapshot.occurrences.find(o => o.component.name === 'TextBox')!;
  const target: SelectionTarget = { kind: 'component', span: box.range };
  const update = document.updateSource(source.replace('Box {}', 'Box {} Box {}'))!;
  const mapped = mapSelectionTargets([target], update);
  assert.deepEqual(mapped, [{ kind: 'component', span: document.occurrence(box.handle)!.range }]);
  const current = document.occurrence(box.handle)!;
  const removed = document.transact({ baseRevision: 1, origin: 'delete', changes: [{ ...current.range, insert: '' }] });
  assert.deepEqual(mapSelectionTargets(mapped, removed), []);
});

test('slot and empty-slot selections follow their parent handle and current fill spans', () => {
  const document = new DeckDocument(source, 'selection.sw');
  const parent = document.snapshot.occurrences.find(o => o.component.name === 'TextBox')!;
  const fill = parent.component.fills[0]!;
  const selected: SelectionTarget[] = [
    { kind: 'slot', parentSpan: parent.range, slotName: 'content', span: { start: fill.span.start.offset, end: fill.span.end.offset } },
    { kind: 'empty-slot', parentSpan: parent.range, slotName: 'unused', slotType: 'text' },
  ];
  const update = document.updateSource(source.replace('Box {}', 'Box { x: 12345 }'))!;
  const current = document.occurrence(parent.handle)!;
  const mapped = mapSelectionTargets(selected, update);
  assert.equal(mapped.length, 2);
  assert.ok(mapped.every(target => 'parentSpan' in target && target.parentSpan.start === current.range.start));
  const slot = mapped[0]!;
  assert.ok(slot.kind === 'slot');
  assert.equal(document.snapshot.source.slice(slot.span.start, slot.span.end), 'content: "later"');
  const replacement = document.updateSource(document.snapshot.source, 'selection.sw', { replacement: true })!;
  assert.deepEqual(mapSelectionTargets(mapped, replacement), []);
});
