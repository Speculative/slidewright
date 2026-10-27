import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeckDocument, SourceMapping, type DocumentOccurrence, type SourceChange } from '../document.js';

const source = `Deck {
  slides: [
    Slide { label: "one" content: TextBox { content: "hello" } }
    Slide { label: "two" content: TextBox { content: "world" } }
  ]
}`;
const named = (document: DeckDocument, name: string) => document.snapshot.occurrences.filter(o => o.component.name === name);
function edit(document: DeckDocument, start: number, end: number, insert: string) {
  return document.transact({ baseRevision: document.snapshot.revision, origin: 'test', changes: [{ start, end, insert }] });
}
function text(document: DeckDocument, occurrence: DocumentOccurrence) {
  return document.snapshot.source.slice(occurrence.range.start, occurrence.range.end);
}

test('length-changing edits preserve later occurrences and map global/relative locations', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const before = document.snapshot;
  const slides = named(document, 'Slide');
  const boxes = named(document, 'TextBox');
  const start = source.indexOf('hello');
  const update = edit(document, start, start + 5, '""hello 🌍\nnew line""');
  const delta = '""hello 🌍\nnew line""'.length - 5;
  assert.equal(update.snapshot.revision, 1);
  assert.equal(update.snapshot.diagnostics.length, 0);
  assert.equal(document.occurrence(slides[1]!.handle)!.range.start, slides[1]!.range.start + delta);
  assert.deepEqual(named(document, 'Slide').map(o => o.handle), slides.map(o => o.handle));
  assert.deepEqual(named(document, 'TextBox').map(o => o.handle), boxes.map(o => o.handle));
  assert.equal(update.mapping.mapOffset(slides[1]!.range.start), slides[1]!.range.start + delta);
  const relative = { start: textFrom(source, boxes[1]!).indexOf('world'), end: textFrom(source, boxes[1]!).indexOf('world') + 5 };
  const location = document.locate(boxes[1]!.handle, relative)!;
  assert.equal(document.snapshot.source.slice(location.start.offset, location.end.offset), 'world');
  assert.equal(location.start.line, 5);
  assert.equal(location.start.column, source.split('\n')[3]!.indexOf('world') + 1);
  assert.ok(!update.changed.includes(slides[1]!.handle));
  assert.ok(update.changed.includes(slides[0]!.handle));
  assert.equal(before.source, source);
  assert.equal(before.occurrences[2]!.range.start, boxes[0]!.range.start);
});
function textFrom(value: string, occurrence: DocumentOccurrence) { return value.slice(occurrence.range.start, occurrence.range.end); }

test('rejects stale revisions, unknown owners and malformed changes atomically', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const before = document.snapshot;
  const invalid: SourceChange[][] = [
    [{ start: -1, end: 0, insert: '' }], [{ start: 2, end: 1, insert: '' }],
    [{ start: 0.5, end: 1, insert: '' }], [{ start: 0, end: source.length + 1, insert: '' }],
    [{ start: 2, end: 4, insert: '' }, { start: 3, end: 5, insert: '' }],
    [{ start: 1, end: 1, insert: 'a' }, { start: 1, end: 1, insert: 'b' }],
  ];
  for (const changes of invalid) assert.throws(() => document.transact({ baseRevision: 0, origin: 'invalid', changes }), RangeError);
  assert.throws(() => document.transact({ baseRevision: 2, origin: 'stale', changes: [] }), /Stale/);
  const foreign = new DeckDocument(source, 'other.sw').snapshot.occurrences[0]!.handle;
  assert.throws(() => document.transact({ baseRevision: 0, origin: 'foreign', changes: [], affectedOwners: [foreign] }), /Affected owner/);
  assert.throws(() => document.transact({ baseRevision: 0, origin: 'file', changes: [], file: 'other.sw' }), /replacement/);
  assert.equal(document.snapshot, before);
});

test('insert/delete at owner boundaries preserve neighbors and retire only deleted owners', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const [first, second] = named(document, 'Slide');
  const inserted = 'Slide { label: "new" }\n    ';
  edit(document, second!.range.start, second!.range.start, inserted);
  assert.equal(named(document, 'Slide')[2]!.handle, second!.handle);
  assert.equal(named(document, 'Slide')[0]!.handle, first!.handle);
  const added = named(document, 'Slide')[1]!;
  const update = edit(document, added.range.start, added.range.end, '');
  assert.ok(update.retired.includes(added.handle));
  assert.deepEqual(named(document, 'Slide').map(o => o.handle), [first!.handle, second!.handle]);
});

test('complete owner replacement retires identity, even for identical source', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const slide = named(document, 'Slide')[0]!;
  const neighbor = named(document, 'Slide')[1]!;
  const update = edit(document, slide.range.start, slide.range.end, text(document, slide));
  assert.ok(update.retired.includes(slide.handle));
  assert.equal(named(document, 'Slide')[1]!.handle, neighbor.handle);
  assert.notEqual(named(document, 'Slide')[0]!.handle, slide.handle);
});

test('explicit host replacement clears every handle, including equal-source replacement', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const old = document.snapshot;
  const update = document.transact({ baseRevision: 0, origin: 'external', replacement: true, file: 'new.sw', changes: [] });
  assert.equal(update.snapshot.file, 'new.sw');
  assert.equal(update.retired.length, old.occurrences.length);
  assert.equal(update.mapping.mapOffset(0), null);
  assert.equal(document.occurrence(old.occurrences[0]!.handle), undefined);
});

test('multiple edits use base coordinates; mappings handle affinity and deleted interiors', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const a = source.indexOf('hello');
  const b = source.indexOf('world');
  const changes = [{ start: a, end: a + 5, insert: 'longer first' }, { start: b, end: b + 5, insert: 'x' }];
  const update = document.transact({ baseRevision: 0, origin: 'batch', changes });
  assert.ok(update.snapshot.source.includes('"longer first"'));
  assert.ok(update.snapshot.source.includes('"x"'));
  assert.equal(update.mapping.mapOffset(a + 1), null);
  assert.equal(update.mapping.mapOffset(a, 'left'), a);
  assert.equal(update.mapping.mapOffset(a, 'right'), a + 12);
  assert.equal(update.mapping.mapOffset(b + 5), b + 8);
  changes[0]!.insert = 'mutated';
  assert.equal(update.changes[0]!.insert, 'longer first');
  const mapping = new SourceMapping(0, 1, 6, [
    { start: 1, end: 3, insert: 'x' }, { start: 3, end: 5, insert: 'yz' },
  ]);
  assert.equal(mapping.mapOffset(3, 'left'), 2);
  assert.equal(mapping.mapOffset(3, 'right'), 4);
  assert.throws(() => mapping.mapOffset(7), RangeError);
  assert.throws(() => mapping.mapRange({ start: 3, end: 2 }), RangeError);
});

test('invalid intermediate syntax remains authoritative and recovers with fresh valid locations', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const start = source.indexOf('"hello"');
  edit(document, start, start + 7, '"unterminated');
  assert.ok(document.snapshot.diagnostics.some(d => d.severity === 'error'));
  assert.ok(document.snapshot.source.includes('"unterminated'));
  edit(document, start, start + 13, '"fixed"');
  assert.equal(document.snapshot.diagnostics.length, 0);
  for (const occurrence of document.snapshot.occurrences) {
    assert.ok(text(document, occurrence).startsWith(occurrence.component.name));
    assert.equal(document.locate(occurrence.handle, { start: 0, end: 0 })!.start.offset, occurrence.range.start);
  }
});

test('snapshots cannot be mutated by consumers and relative locations are checked', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const owner = document.snapshot.occurrences[0]!;
  assert.ok(Object.isFrozen(document.snapshot.ast.items));
  assert.ok(Object.isFrozen(owner.component.span.start));
  assert.throws(() => document.locate(owner.handle, { start: -1, end: 0 }), RangeError);
  assert.throws(() => document.locate(owner.handle, { start: 0, end: source.length + 1 }), RangeError);
});

test('1,000-slide deck retains all unaffected handles through repeated length changes and inverse edits', () => {
  const document = new DeckDocument(`Deck { slides: [\n${Array.from({ length: 1000 }, (_, i) =>
    `Slide { label: "slide ${i}" content: TextBox { content: "text ${i}" } }`).join('\n')}\n] }`, 'large.sw');
  const original = document.snapshot;
  const slides = named(document, 'Slide');
  const later = slides.slice(1).map(o => o.handle);
  for (const insert of ['a much longer label', 'x', 'slide 0']) {
    const current = document.snapshot.source;
    const begin = current.indexOf('"') + 1;
    const end = current.indexOf('"', begin);
    const update = edit(document, begin, end, insert);
    assert.equal(document.snapshot.diagnostics.length, 0);
    assert.deepEqual(named(document, 'Slide').slice(1).map(o => o.handle), later);
    assert.deepEqual(update.changed, [original.occurrences[0]!.handle, slides[0]!.handle]);
    assert.deepEqual(update.affectedOwners, [slides[0]!.handle]);
    for (const handle of later) {
      const occurrence = document.occurrence(handle)!;
      assert.ok(text(document, occurrence).startsWith('Slide {'));
    }
  }
  assert.equal(document.snapshot.source, original.source);
});

test('reorder expressed as deletion/insertion retires moved owners and preserves stationary neighbors', () => {
  const document = new DeckDocument(source, 'deck.sw');
  const [first, second] = named(document, 'Slide');
  const update = document.transact({ baseRevision: 0, origin: 'reorder', changes: [
    { start: first!.range.start, end: first!.range.end, insert: '' },
    { start: second!.range.end, end: second!.range.end, insert: `\n${text(document, first!)}` },
  ] });
  assert.equal(document.snapshot.diagnostics.length, 0);
  assert.equal(named(document, 'Slide')[0]!.handle, second!.handle);
  assert.ok(update.retired.includes(first!.handle));
  assert.notEqual(named(document, 'Slide')[1]!.handle, first!.handle);
});
