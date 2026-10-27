import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitSourceEdit, duplicateSlideAtIndex, insertEmptySlide, reorderSlides, removeSlidesAtIndices, findComponentAtSpan } from '../ast-edits.js';
import { numberLit, slotFill, stringLit } from '../../runtime/ast-builders.js';
import { DeckDocument } from '../../runtime/document.js';
import { parse } from '../../runtime/parser.js';
import { emit } from '../../runtime/emitter.js';

const source = `// keep the deck header\r
Deck { name : "hand-formatted" slides: [\r
  // first slide\r
  Slide { label:"first" content: Freeform { children: [\r
    Box { x:1.50 y:2 width:30 height:40 } // preserve this comment\r
    TextBox { content: "adjacent " "strings" }\r
  ] } }\r
  // later slide\r
  Slide { label:"later" content: TextBox { content: """\r
      keep this\r
      multiline text\r
    """ } }\r
] }\r
// preserve EOF trivia\r
`;
const boxes = (source: string) => {
  const document = new DeckDocument(source, 'test.sw');
  assert.equal(document.snapshot.diagnostics.length, 0);
  return document.snapshot.occurrences.filter(o => o.component.name === 'Box');
};

test('scalar edits preserve every untouched source byte, CRLF, comments and adjacent strings', () => {
  const box = boxes(source)[0]!;
  const result = commitSourceEdit(source, 'edit', ast => {
    const node = findComponentAtSpan(ast, box.range.start, box.range.end)!;
    node.fills[0]!.value = numberLit(11.5);
    return { selectComponents: [node] };
  })!;
  assert.ok(result);
  assert.equal(result.newSource, source.replace('x:1.50', 'x:11.5'));
  assert.ok(result.changes.every(change => change.start >= box.range.start && change.end <= box.range.end));
  assert.ok(result.newSource.slice(result.newSelections[0]!.start, result.newSelections[0]!.end).startsWith('Box {'));
});

test('disjoint owner edits return precise change ranges and preserve occurrences between them', () => {
  const input = 'Deck { slides: [Slide { label: "a" } Slide { label: "middle" } Slide { label: "z" }] }';
  const document = new DeckDocument(input, 'test.sw');
  const middle = document.snapshot.occurrences.filter(o => o.component.name === 'Slide')[1]!;
  const result = commitSourceEdit(input, 'edit', ast => {
    const list = ast.items[0]!.fills[0]!.value;
    if (list.kind !== 'list') return null;
    for (const index of [0, 2]) {
      const item = list.items[index]!;
      if (item.kind !== 'component') return null;
      item.fills[0]!.value = stringLit(index ? 'long last' : 'long first');
    }
    return {};
  })!;
  assert.ok(result);
  assert.equal(result.changes.length, 2);
  document.updateSource(result.newSource, 'test.sw', { changes: result.changes });
  assert.ok(document.occurrence(middle.handle));
});

test('adding a fill preserves existing child source and later slides', () => {
  const box = boxes(source)[0]!;
  const later = source.slice(source.indexOf('  // later slide'));
  const result = commitSourceEdit(source, 'materialize', ast => {
    const node = findComponentAtSpan(ast, box.range.start, box.range.end)!;
    node.fills.push(slotFill('fill', stringLit('red')));
    return { selectComponents: [node] };
  })!;
  assert.ok(result);
  assert.ok(result.newSource.endsWith(later));
  assert.ok(result.newSource.includes('x:1.50'));
  assert.ok(result.newSource.includes('"adjacent " "strings"'));
  assert.ok(result.newSource.includes('fill: "red"'));
});

for (const operation of ['insert', 'duplicate', 'delete', 'reorder'] as const) {
  test(`${operation} preserves unchanged slide payloads, comments and triple strings`, () => {
    const parsed = parse(source, 'before').ast;
    const list = parsed.items[0]!.fills.find(f => f.name === 'slides')!.value;
    assert.equal(list.kind, 'list');
    if (list.kind !== 'list') return;
    const later = list.items[1]!;
    const raw = source.slice(later.span.start.offset, later.span.end.offset);
    const result = commitSourceEdit(source, operation, ast => {
      if (operation === 'insert') insertEmptySlide(ast, 0);
      if (operation === 'duplicate') duplicateSlideAtIndex(ast, 0);
      if (operation === 'delete') removeSlidesAtIndices(ast, [0]);
      if (operation === 'reorder') reorderSlides(ast, [0], 2);
      return {};
    });
    assert.ok(result);
    assert.ok(result.newSource.includes(raw));
    assert.ok(result.newSource.includes('// later slide'));
    assert.ok(result.newSource.startsWith('// keep the deck header\r\nDeck { name : "hand-formatted"'));
    assert.ok(result.newSource.endsWith('// preserve EOF trivia\r\n'));
    assert.deepEqual(parse(result.newSource, 'after').diagnostics, []);
  });
}

test('adjacent string list entries retain their value boundaries after insertion/removal', () => {
  const input = 'Deck { slides: [Slide { label: "test" notes: ["a", "b"] }] }';
  const result = commitSourceEdit(input, 'strings', ast => {
    const slides = ast.items[0]!.fills[0]!.value;
    if (slides.kind !== 'list' || slides.items[0]?.kind !== 'component') return null;
    const notes = slides.items[0].fills[1]!.value;
    if (notes.kind !== 'list') return null;
    notes.items.splice(1, 0, stringLit('inserted'));
    return {};
  });
  assert.ok(result);
  assert.ok(result.newSource.includes('"a",'));
  assert.ok(result.newSource.includes('"inserted",'));
});

test('no-op edits leave formatting intact; unrepresentable mutations abort before publication', () => {
  const noOp = commitSourceEdit(source, 'noop', () => ({}))!;
  assert.equal(noOp.newSource, source);
  assert.deepEqual(noOp.changes, []);
  const box = boxes(source)[0]!;
  assert.equal(commitSourceEdit(source, 'invalid', ast => {
    findComponentAtSpan(ast, box.range.start, box.range.end)!.fills[0]!.value = numberLit(Number.NaN);
    return {};
  }), null);
});

test('repeated scalar edits round-trip semantically without formatting untouched slides', () => {
  let current = source;
  for (let i = 0; i < 30; i++) {
    const result = commitSourceEdit(current, 'loop', ast => {
      const deck = ast.items[0]!;
      const list = deck.fills.find(f => f.name === 'slides')!.value;
      if (list.kind !== 'list' || list.items[0]?.kind !== 'component') return null;
      const slide = list.items[0];
      const label = slide.fills.find(f => f.name === 'label');
      if (label) label.value = stringLit(`edit ${i}`);
      else slide.fills.push(slotFill('label', stringLit(`edit ${i}`)));
      return { selectComponents: [slide] };
    });
    assert.ok(result);
    assert.ok(result.newSource.includes('"adjacent " "strings"'));
    const parsed = parse(result.newSource, 'verify');
    assert.equal(parsed.diagnostics.length, 0);
    assert.equal(emit(parse(emit(parsed.ast), 'again').ast), emit(parsed.ast));
    current = result.newSource;
  }
});

for (const operation of ['insert', 'duplicate', 'delete', 'reorder'] as const) {
  test(`${operation} retains stationary occurrence handles through exact commit ranges`, () => {
    const input = `Deck { slides: [${Array.from({ length: 6 }, (_, i) => `Slide { label: "${i}" }`).join('\n')}] }`;
    const document = new DeckDocument(input, 'structural.sw');
    const slides = document.snapshot.occurrences.filter(item => item.component.name === 'Slide');
    const result = commitSourceEdit(input, operation, ast => {
      if (operation === 'insert') insertEmptySlide(ast, 0);
      if (operation === 'duplicate') duplicateSlideAtIndex(ast, 0);
      if (operation === 'delete') removeSlidesAtIndices(ast, [1, 3]);
      if (operation === 'reorder') reorderSlides(ast, [5], 0);
      return {};
    });
    assert.ok(result);
    document.updateSource(result.newSource, 'structural.sw', { changes: result.changes });
    const retired = operation === 'delete' ? new Set([1, 3]) : operation === 'reorder' ? new Set([5]) : new Set();
    slides.forEach((slide, index) => assert.equal(!!document.occurrence(slide.handle), !retired.has(index)));
  });
}

test('seeded list insertion, deletion, duplication and movement preserve grammar and semantic boundaries', () => {
  let random = 1729;
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
  let current = 'Deck { slides: [Slide { notes: ["a", Box {}, "b", // comma in trivia, is not a separator\n Box {}, "c"] }] }';
  for (let i = 0; i < 120; i++) {
    const result = commitSourceEdit(current, 'list-property', ast => {
      const slides = ast.items[0]!.fills[0]!.value;
      if (slides.kind !== 'list' || slides.items[0]?.kind !== 'component') return null;
      const list = slides.items[0].fills[0]!.value;
      if (list.kind !== 'list') return null;
      const action = list.items.length > 12 ? 1 : next() % 4;
      const index = list.items.length ? next() % list.items.length : 0;
      if (action === 0 || !list.items.length) list.items.splice(index, 0, stringLit(`new ${i}`));
      else if (action === 1) list.items.splice(index, 1);
      else if (action === 2) list.items.splice(index, 0, structuredClone(list.items[index]!));
      else {
        const [node] = list.items.splice(index, 1);
        list.items.splice(next() % (list.items.length + 1), 0, node!);
      }
      return {};
    });
    assert.ok(result, `operation ${i} failed for ${current}`);
    assert.equal(parse(result.newSource, 'after').diagnostics.length, 0);
    current = result.newSource;
  }
});
