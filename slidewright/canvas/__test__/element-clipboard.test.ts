import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeckDocument } from '../../runtime/document.js';
import { readParserWork } from '../../runtime/parser.js';
import { parse } from '../../runtime/parser.js';
import type { Component } from '../../runtime/ast.js';
import { copyElements, pasteElements, pasteImages } from '../element-clipboard.js';
import { findActiveSlideFreeform } from '../ast-edits.js';
import type { SelectionTarget } from '../selection-target.js';

const source = `Deck { slides: [Slide { content: Freeform {
  // keep this comment
  TextBox { x: 20 content: [Paragraph { content: "hello" }] }
} }] }`;
const ast = parse(source, '<test>').ast;
const box = findActiveSlideFreeform(ast, 0)!.implicitChildren[0]!;
const span = (node: Component) => ({ start: node.span.start.offset, end: node.span.end.offset });

for (const kind of ['slot', 'empty-slot'] as const) {
  test(`${kind} copies the containing element and retains comments`, () => {
    const target: SelectionTarget = kind === 'slot'
      ? { kind, parentSpan: span(box), span: span(box), slotName: 'content' }
      : { kind, parentSpan: span(box), slotName: 'content', slotType: 'text-document' };
    const clipboard = copyElements(source, [target])!;
    assert.match(clipboard, /TextBox/);
    assert.match(clipboard, /keep this comment/);
    const result = pasteElements(source, [target], 0, clipboard)!;
    assert.equal(result.newSelections.length, 1);
    assert.equal((result.newSource.match(/TextBox/g) ?? []).length, 2);
    assert.equal((result.newSource.match(/keep this comment/g) ?? []).length, 2);
    assert.doesNotMatch(result.newSource, /Slidewright elements v1/);
  });
}

test('invalid or unrelated clipboard text leaves source unchanged', () => {
  assert.equal(pasteElements(source, [], 0, 'ordinary text'), null);
  assert.equal(pasteElements(source, [], 0, '// Slidewright elements v1\nBox {'), null);
  assert.equal(copyElements(source, [{ kind: 'slide' }]), null);
});

test('multi-selection copies source order and avoids duplicating selected descendants', () => {
  const nested = `Deck { slides: [Slide { content: Freeform {
    Group { Box {} }
    Box { fill: amber }
  } }] }`;
  const freeform = findActiveSlideFreeform(parse(nested, '<test>').ast, 0)!;
  const [group, box] = freeform.implicitChildren;
  const targets = [box!, group!.implicitChildren[0]!, group!].map(node => ({ kind: 'component' as const, span: span(node) }));
  const clipboard = copyElements(nested, targets)!;
  assert.equal((clipboard.match(/Box/g) ?? []).length, 2);
  assert.ok(clipboard.indexOf('Group') < clipboard.indexOf('fill: amber'));
});

test('snapshot clipboard commands avoid deck parsing and preserve later occurrences', () => {
  const large = `Deck { slides: [${Array.from({ length: 100 }, (_, i) =>
    `Slide { content: Freeform { Box { x: ${i} } } }`).join('\n')}] }`;
  const document = new DeckDocument(large, '<clipboard>');
  const snapshot = document.snapshot;
  const box = snapshot.occurrences.find(o => o.component.name === 'Box')!;
  const later = snapshot.occurrences.filter(o => o.component.name === 'Box').at(-1)!;
  const selected: SelectionTarget[] = [{ kind: 'component', span: box.range }];
  const before = readParserWork();
  const clipboard = copyElements(large, selected, snapshot)!;
  assert.equal(readParserWork().parsedCharacters, before.parsedCharacters);
  for (const command of [() => pasteElements(large, selected, 0, clipboard, snapshot),
    () => pasteImages(large, selected, 0, [{ src: 'data:image/png;base64,AA==', width: 320, height: 200 }], snapshot)]) {
    const start = readParserWork();
    const result = command();
    assert.ok(readParserWork().parsedCharacters - start.parsedCharacters < 500);
    assert.ok(result);
    assert.equal(result.baseRevision, snapshot.revision);
    assert.equal(result.parsing.input.fullParses, 0);
    assert.equal(result.parsing.input.parsedCharacters, 0);
    assert.equal(result.parsing.output.fullParses, 0);
    assert.ok(result.parsing.output.parsedCharacters < 400);
    const doc = new DeckDocument(large, '<published>');
    const retained = doc.snapshot.occurrences.filter(o => o.component.name === 'Box').at(-1)!;
    doc.updateSource(result.newSource, '<published>', { changes: result.changes, baseRevision: doc.snapshot.revision });
    assert.equal(doc.occurrence(retained.handle)?.range.start, result.newSource.lastIndexOf('Box'));
    assert.equal(result.newSource.slice(result.newSource.lastIndexOf('Slide')), large.slice(large.lastIndexOf('Slide')));
    assert.equal(document.occurrence(later.handle), later);
  }
  assert.equal(copyElements(large + ' ', selected, snapshot), null);
  assert.equal(pasteElements(large + ' ', selected, 0, clipboard, snapshot), null);
  assert.equal(pasteImages(large + ' ', selected, 0, [{ src: 'x', width: 10, height: 10 }], snapshot), null);
});

test('invalid document snapshots cannot supply clipboard elements', () => {
  const broken = source.slice(0, -1);
  const snapshot = new DeckDocument(broken, '<invalid>').snapshot;
  assert.equal(copyElements(broken, [{ kind: 'component', span: span(box) }], snapshot), null);
});
