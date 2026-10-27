import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeckDocument, type SourceChange } from '../document.js';
import { parse } from '../parser.js';

const source = `// file header\r
Deck {\r
  slides: [\r
    // first slide\r
    Slide { content: Freeform { children: [\r
      // editable child\r
      TextBox { x: 1.5 content: [Paragraph { content: ["adjacent " "strings", Span { content: "marked" }] }] }\r
      Group { Box { x: 100 } Box { x: 200 } }\r
    ] } }\r
    Slide { content: TextBox { content: """\r
      unicode 🌍\r
      line two\r
    """ } }\r
  ]\r
}\r
// EOF comment\r
`;
function check(document: DeckDocument) {
  const fresh = parse(document.snapshot.source, document.snapshot.file);
  assert.deepEqual(document.snapshot.ast, fresh.ast);
  assert.deepEqual(document.snapshot.diagnostics, fresh.diagnostics);
}
function change(document: DeckDocument, text: string, insert: string) {
  const start = document.snapshot.source.indexOf(text);
  assert.ok(start >= 0);
  const update = document.updateSource(document.snapshot.source.slice(0, start) + insert + document.snapshot.source.slice(start + text.length))!;
  check(document);
  return update;
}

test('local text/geometry/structure edits parse only the smallest complete component, with exact spans and trivia', () => {
  const document = new DeckDocument(source, 'bounded.sw');
  for (const [from, to] of [
    ['marked', 'longer 🌍\\n'],
    ['x: 1.5', 'x: 100.5'],
    ['"adjacent " "strings"', '"different "\r\n"strings"'],
    ['Box { x: 100 }', 'Box { x: 100 width: 500 }'],
    ['x: 200', 'x: 2'],
    ['unicode 🌍', 'unicode 🌍 and more'],
  ]) {
    const update = change(document, from!, to!);
    assert.equal(update.snapshot.parsing.fullParses, 0);
    assert.equal(update.snapshot.parsing.componentParses, 1);
    assert.ok(update.snapshot.parsing.parsedCharacters < 200);
  }
});

test('disjoint owner edits parse separate components and ancestor edits absorb nested changes', () => {
  const document = new DeckDocument(source, 'bounded.sw');
  const before = document.snapshot.source;
  const changes = ['marked', 'unicode 🌍'].map(text => ({ start: before.indexOf(text), end: before.indexOf(text) + text.length, insert: text + ' longer' }));
  document.transact({ baseRevision: 0, origin: 'test', changes });
  check(document);
  assert.equal(document.snapshot.parsing.componentParses, 2);
  assert.equal(document.snapshot.parsing.fullParses, 0);
  const next = document.snapshot.source;
  const nested = ['x: 100', 'x: 2'].map(text => ({ start: next.indexOf(text), end: next.indexOf(text) + text.length, insert: text + '0' }));
  // An edit to the containing Group name requires reparsing Group once.
  const groupName = next.indexOf('Group');
  document.transact({ baseRevision: 1, origin: 'test', changes: [{ start: groupName + 1, end: groupName + 2, insert: 'R' }, ...nested] });
  check(document);
  assert.equal(document.snapshot.parsing.componentParses, 1);
  assert.equal(document.snapshot.parsing.fullParses, 0);
});

test('unchanged positioned subtrees are shared while shifted snapshots retain their own positions', () => {
  const document = new DeckDocument(source, 'bounded.sw');
  const original = document.snapshot;
  const later = original.occurrences.filter(o => o.component.name === 'TextBox').at(-1)!;
  change(document, 'marked', 'edited');
  assert.equal(document.occurrence(later.handle)!.component, later.component);
  change(document, 'edited', 'longer edit');
  assert.notEqual(document.occurrence(later.handle)!.component, later.component);
  assert.equal(original.source.slice(later.range.start, later.range.end), source.slice(later.range.start, later.range.end));
  assert.deepEqual(original.ast, parse(source, 'bounded.sw').ast);
  assert.ok(Object.isFrozen(document.snapshot.parsing));
});

test('invalid, cross-boundary, top-level and explicit replacement edits use full parsing with exact recovery diagnostics', () => {
  for (const [from, to] of [
    ['"marked"', '"unterminated'],
    ['content: "marked"', 'content: /* swallowed'],
    ['}] }\r\n      Group', '}] \r\n      Group'],
    ['Deck', 'Other'],
    ['// file header', '// changed header'],
  ]) {
    const document = new DeckDocument(source, 'fallback.sw');
    const update = change(document, from!, to!);
    assert.equal(update.snapshot.parsing.fullParses, 1);
  }
  const document = new DeckDocument(source, 'fallback.sw');
  change(document, '"marked"', '"unterminated');
  change(document, '"unterminated', '"recovered"');
  assert.equal(document.snapshot.parsing.fullParses, 1); // recovered base has errors
  change(document, 'recovered', 'valid');
  assert.equal(document.snapshot.parsing.fullParses, 0);
  document.updateSource(document.snapshot.source, 'new-file.sw');
  assert.equal(document.snapshot.parsing.fullParses, 1);
  check(document);
  document.updateSource(document.snapshot.source, 'new-file.sw', { replacement: true });
  assert.equal(document.snapshot.parsing.fullParses, 1);
});

test('a 1,000-slide edit has deterministic bounded parse work independent of later slides', () => {
  const document = new DeckDocument(`Deck { slides: [${Array.from({ length: 1000 }, (_, i) =>
    `Slide { content: TextBox { content: "text-${i}" } }`).join('\n')}] }`, 'large.sw');
  assert.equal(document.snapshot.parsing.fullParses, 1);
  const handles = document.snapshot.occurrences.filter(o => o.component.name === 'Slide').map(o => o.handle);
  for (const text of ['a longer value', '🌍', 'text-0']) {
    const current = document.snapshot.source;
    const start = current.indexOf('"') + 1;
    const end = current.indexOf('"', start);
    document.transact({ baseRevision: document.snapshot.revision, origin: 'test', changes: [{ start, end, insert: text }] });
    check(document);
    assert.deepEqual(document.snapshot.parsing, { fullParses: 0, componentParses: 1,
      parsedCharacters: `TextBox { content: "${text}" }`.length });
    assert.deepEqual(document.snapshot.occurrences.filter(o => o.component.name === 'Slide').map(o => o.handle), handles);
  }
});

test('seeded arbitrary source edits match full parsing, including invalid intermediate syntax', () => {
  let seed = 193;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const inserts = ['', '\n', '"', '"""', '/*', '//', '}', '{', '[', ']', ',', 'new', 'λ🌍', '\r\n'];
  for (let i = 0; i < 500; i++) {
    const document = new DeckDocument(source, 'fuzz.sw');
    const start = random(source.length + 1);
    const changes: SourceChange[] = [{ start, end: Math.min(source.length, start + random(12)), insert: inserts[random(inserts.length)]! }];
    document.transact({ baseRevision: 0, origin: `seeded-${i}`, changes });
    check(document);
  }
});
