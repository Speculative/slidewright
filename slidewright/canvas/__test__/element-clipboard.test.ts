import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../runtime/parser.js';
import type { Component } from '../../runtime/ast.js';
import { copyElements, pasteElements } from '../element-clipboard.js';
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
