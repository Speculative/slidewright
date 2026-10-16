import { formattingState } from '../rich-text/feedback.js';
import assert from 'node:assert/strict';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { splitBlock, joinBackward } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { TextProjection } from '../rich-text/projection.js';
import { parse } from '../../runtime/parser.js';
import { emit } from '../../runtime/emitter.js';
import type { Component, Value } from '../../runtime/ast.js';
import { buildRegistry } from '../../runtime/contract.js';
import { createElement } from 'react';
import { slotFill, stringLit } from '../../runtime/ast-builders.js';
import { leafIdentityPlugin, pointAt, positionAt, textRange } from '../rich-text/selection.js';
import { mergeListItems, setTextStyle, clearTextStyles, setParagraphStyle, setListStyle, changeListDepth } from '../rich-text/commands.js';

const registry = buildRegistry({
  Pill: { slidewright: { produces: 'text', slots: { content: { type: 'text' } }, inlineEditing: { mode: 'transparent', contentSlot: 'content' } }, default: ({ slots }) => createElement('span', null, slots.content) },
  Formula: { slidewright: { produces: 'text', slots: {}, params: { expression: { type: 'string' } }, inlineEditing: { mode: 'owned' } }, default: () => createElement('span', null, 'formula') },
  Derived: { slidewright: { produces: 'text', slots: { content: { type: 'text' } } }, default: () => createElement('span', null, 'derived') },
});
function compile(content: string) {
  const ast = parse(`Document { content: ${content} }`, 'test.sw').ast;
  const value = ast.items[0]!.fills[0]!.value;
  return { value, projection: new TextProjection({ content: value, registry, scope: { bindings: { term: 'shared term' } } }) };
}
function text(value: Value): string {
  const result = emit({ kind: 'source_file', span: value.span, items: [{ ...parse('Document {}', 'test.sw').ast.items[0]!, fills: [slotFill('content', value)] }] });
  assert.equal(emit(parse(result, 'test.sw').ast), result);
  return result;
}
function fill(comp: Component, name: string): Value { return comp.fills.find(f => f.name === name)!.value; }
function blocks(value: Value): Component[] { assert.equal(value.kind, 'list'); return (value as { items: Value[] }).items as Component[]; }
function apply(state: EditorState, command: Command): EditorState {
  let next = state;
  assert.equal(command(state, tr => { next = state.apply(tr); }), true, 'command must apply');
  next.doc.check();
  return next;
}
function atText(state: EditorState, sought: string, offset = 0): EditorState {
  let position = -1;
  state.doc.descendants((node, pos) => { if (node.isText && node.text === sought) position = pos + offset; });
  assert.ok(position >= 0, `find ${sought}`);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, position)));
}

const original = compile(`[
  Paragraph { spaceAfter: 24 content: ["plain " Span { content: ["bold", " tail"] weight: "700" color: accent }] }
  Paragraph { content: ["untouched " Pill { content: ["inline"] } Formula { expression: "x + y" } term] }
]`);
assert.equal(original.projection.lower(original.projection.doc), original.value, 'untouched source object reused');
let state = EditorState.create({ doc: original.projection.doc });
state = state.apply(state.tr.insertText('X', 3));
const edited = original.projection.lower(state.doc);
const oldBlocks = blocks(original.value);
const newBlocks = blocks(edited);
assert.equal(newBlocks[1], oldBlocks[1], 'untouched paragraph reused');
assert.equal((fill(newBlocks[0]!, 'content') as { items: Value[] }).items[1], (fill(oldBlocks[0]!, 'content') as { items: Value[] }).items[1], 'untouched Span reused');
assert.ok(text(edited).includes('"plXain "'));
assert.ok(text(edited).includes('spaceAfter: 24'));
state = atText(state, 'bold', 2);
state = state.apply(state.tr.insertText('!'));
const spanEdited = original.projection.lower(state.doc);
assert.ok(text(spanEdited).includes('"bo!ld"'));
assert.ok(text(spanEdited).includes('color: accent'));
assert.ok(text(spanEdited).includes('weight: "700"'));

const crossed = compile('[Paragraph { content: ["abc" Span { content: "DEF" weight: "700" } "ghi"] }]');
let crossedState = EditorState.create({ doc: crossed.projection.doc });
crossedState = crossedState.apply(crossedState.tr.insertText('x', 3, 8));
const crossedText = text(crossed.projection.lower(crossedState.doc));
assert.ok(crossedText.includes('"abx"'));
assert.ok(crossedText.includes('"hi"'));
assert.ok(!crossedText.includes('DEF'));

const formatting = compile('[Paragraph { content: ["abcdef"] }]');
let formatState = EditorState.create({ doc: formatting.projection.doc });
formatState = formatState.apply(formatState.tr.addMark(3, 5, formatting.projection.schema.marks.weight!.create({ value: '700' })));
const formatted = text(formatting.projection.lower(formatState.doc));
assert.ok(formatted.includes('"ab"') && formatted.includes('"cd"') && formatted.includes('"ef"'));
assert.ok(formatted.includes('weight: "700"'));
const removing = compile('[Paragraph { content: [Span { content: "abcdef" weight: "700" }] }]');
let removingState = EditorState.create({ doc: removing.projection.doc });
removingState = removingState.apply(removingState.tr.removeMark(3, 5, removing.projection.schema.marks.weight!));
const removed = text(removing.projection.lower(removingState.doc));
assert.equal((removed.match(/weight: "700"/g) ?? []).length, 2, 'unaffected bold segments survive');

const commented = compile('[Paragraph { content: ["plain"\n// keep the named style\nSpan { content: "marked" color: accent }] }]');
let commentState = EditorState.create({ doc: commented.projection.doc });
commentState = commentState.apply(commentState.tr.insertText('!', 2));
assert.ok(text(commented.projection.lower(commentState.doc)).includes('// keep the named style'));
const invisible = compile('[Paragraph { content: [Span { content: [] weight: "700" } "editable"] }]');
let invisibleState = EditorState.create({ doc: invisible.projection.doc });
invisibleState = invisibleState.apply(invisibleState.tr.insertText('!', 2));
const invisibleLowered = invisible.projection.lower(invisibleState.doc);
assert.equal((fill(blocks(invisibleLowered)[0]!, 'content') as { items: Value[] }).items[0], (fill(blocks(invisible.value)[0]!, 'content') as { items: Value[] }).items[0], 'empty authored Span survives unrelated typing without invisible caret atoms');

const soft = compile('[Paragraph { content: ["A\\nB 😀"] }]');
let softState = EditorState.create({ doc: soft.projection.doc });
assert.equal(softState.doc.firstChild!.child(1).type.name, 'hard_break');
softState = softState.apply(softState.tr.insertText('!', 5));
assert.ok(text(soft.projection.lower(softState.doc)).includes('A\\nB !😀'));
const shorthand = compile('"shorthand"');
let shortState = EditorState.create({ doc: shorthand.projection.doc });
assert.equal(shorthand.projection.lower(shortState.doc), shorthand.value);
shortState = shortState.apply(shortState.tr.insertText('!', 2));
assert.ok(text(shorthand.projection.lower(shortState.doc)).includes('Paragraph {'));

const paragraphSplit = compile('[Paragraph { spaceAfter: 12 content: ["abcdef"] }]');
let paragraphState = EditorState.create({ doc: paragraphSplit.projection.doc });
paragraphState = atText(paragraphState, 'abcdef', 3);
paragraphState = apply(paragraphState, splitBlock);
assert.equal(blocks(paragraphSplit.projection.lower(paragraphState.doc)).length, 2);
paragraphState = apply(paragraphState, joinBackward);
assert.equal(paragraphState.doc.textContent, 'abcdef');

const lists = compile('[List { style: "upper-alpha" start: 3 items: [ListItem { content: ["first"] } ListItem { content: ["second"] }] }]');
let listState = EditorState.create({ doc: lists.projection.doc });
listState = atText(listState, 'second', 3);
listState = apply(listState, splitListItem(lists.projection.schema.nodes.list_item!));
assert.equal(listState.doc.firstChild!.childCount, 3);
listState = atText(listState, 'ond');
listState = apply(listState, sinkListItem(lists.projection.schema.nodes.list_item!));
assert.ok(text(lists.projection.lower(listState.doc)).includes('children: List {'));
listState = apply(listState, liftListItem(lists.projection.schema.nodes.list_item!));
const listSource = text(lists.projection.lower(listState.doc));
assert.ok(listSource.includes('style: "upper-alpha"') && listSource.includes('start: 3'));
assert.ok(!listSource.includes('children: List {'));
listState = atText(listState, 'ond');
listState = apply(listState, mergeListItems(-1));
assert.ok(text(lists.projection.lower(listState.doc)).includes('"second"'));

const identities = compile('[Paragraph { content: ["abc😀def"] }]');
let identityState = EditorState.create({ doc: identities.projection.doc, plugins: [leafIdentityPlugin()] });
const beforePoint = pointAt(identityState.doc, 4)!;
assert.equal(beforePoint.offset, 3);
assert.equal(positionAt(identityState.doc, beforePoint), 4);
identityState = atText(identityState, 'abc😀def', 3);
identityState = apply(identityState, splitBlock);
const rightPoint = pointAt(identityState.doc, identityState.selection.from)!;
assert.notEqual(rightPoint.nodeId, beforePoint.nodeId, 'split right leaf gets a synthetic session identity');
assert.ok(textRange(identityState.doc, identityState.selection.anchor, identityState.selection.head));
assert.equal(positionAt(identityState.doc, rightPoint), identityState.selection.from);
identityState = apply(identityState, joinBackward);
assert.equal(identities.projection.lower(identityState.doc), identities.value, 'split/merge preserves original authored value after identity normalization');

const custom = compile('[Paragraph { content: [Pill { content: ["pill"] } Formula { expression: "x + y" } Derived { content: "computed" } term] }]');
let customState = EditorState.create({ doc: custom.projection.doc });
customState = atText(customState, 'pill', 2);
customState = customState.apply(customState.tr.insertText('!'));
const customSource = text(custom.projection.lower(customState.doc));
assert.ok(customSource.includes('"pi!ll"') && customSource.includes('expression: "x + y"') && customSource.includes('term'));
let formulaPos = -1;
customState.doc.descendants((node, pos) => { if (node.attrs.value?.name === 'Formula') formulaPos = pos; });
const formulaNode = customState.doc.nodeAt(formulaPos)!;
assert.equal(formulaNode.isAtom, true);
const formula = formulaNode.attrs.value as Component;
const newFormula = { ...formula, fills: formula.fills.map(f => f.name === 'expression' ? { ...f, value: stringLit('z + 1') } : f) };
customState = customState.apply(customState.tr.setNodeMarkup(formulaPos, undefined, { ...formulaNode.attrs, value: newFormula }));
assert.ok(text(custom.projection.lower(customState.doc)).includes('expression: "z + 1"'));
customState = customState.apply(customState.tr.delete(formulaPos, formulaPos + 1));
assert.ok(!text(custom.projection.lower(customState.doc)).includes('Formula {'));
let referencePos = -1;
customState.doc.descendants((node, pos) => { if (node.type.name === 'reference') referencePos = pos; });
customState = customState.apply(customState.tr.delete(referencePos, referencePos + 1));
assert.ok(!text(custom.projection.lower(customState.doc)).includes('term'));

const draft = EditorState.create({ doc: crossed.projection.doc, plugins: [history()] });
let historyState = draft.apply(draft.tr.insertText('!', 2));
historyState = apply(historyState, undo);
assert.ok(historyState.doc.eq(draft.doc));
historyState = apply(historyState, redo);
assert.equal(historyState.doc.textContent, 'a!bcDEFghi');
for (const input of ['[]', '[Paragraph { content: [] }]', '[List { items: [] }]']) {
  const { projection } = compile(input);
  const initial = EditorState.create({ doc: projection.doc });
  const position = input.includes('List') ? 3 : 1;
  assert.ok(text(projection.lower(initial.apply(initial.tr.insertText('new', position)).doc)).includes('"new"'));
}
assert.throws(() => compile('[Paragraph { content: [List { items: [] }] }]'), /not inline text/);
const unknown = compile('[Paragraph { content: ["prefix" UninstalledExtension { expression: "retain me" }] }]');
let unknownState = EditorState.create({ doc: unknown.projection.doc });
unknownState = unknownState.apply(unknownState.tr.insertText('!', 2));
assert.ok(text(unknown.projection.lower(unknownState.doc)).includes('expression: "retain me"'));
console.log('OK   rich-text transactions, source preservation, formatting, lists, inline contracts, references, shorthand, and draft history');

const toolbar = compile('[Paragraph { content: ["abc" Span { content: ["def"] color: accent }] } Paragraph { content: ["untouched"] }]');
let toolbarState = EditorState.create({ doc: toolbar.projection.doc, plugins: [history()] });
toolbarState = toolbarState.apply(toolbarState.tr.setSelection(TextSelection.create(toolbarState.doc, 2, 6)));
toolbarState = apply(toolbarState, setTextStyle('size', 42));
assert.ok(text(toolbar.projection.lower(toolbarState.doc)).includes('size: 42'));
assert.equal(blocks(toolbar.projection.lower(toolbarState.doc))[1], blocks(toolbar.value)[1]);
const styledToolbarDoc = toolbarState.doc;
toolbarState = apply(toolbarState, clearTextStyles);
assert.ok(!text(toolbar.projection.lower(toolbarState.doc)).includes('size: 42'));
assert.ok(text(toolbar.projection.lower(toolbarState.doc)).includes('color: accent'));
toolbarState = apply(toolbarState, undo);
assert.ok(toolbarState.doc.eq(styledToolbarDoc), 'clear formatting is one history operation');

const paragraphFormatting = compile('[Paragraph { content: ["abc"] } List { items: [ListItem { content: ["def"] children: List { items: [ListItem { content: ["nested"] }] } }] } Paragraph { content: ["untouched"] }]');
let paragraphStyleState = EditorState.create({ doc: paragraphFormatting.projection.doc, plugins: [history()] });
paragraphStyleState = atText(paragraphStyleState, 'def', 1);
paragraphStyleState = apply(paragraphStyleState, setParagraphStyle('indent', 30));
paragraphStyleState = apply(paragraphStyleState, setParagraphStyle('firstLineIndent', -15));
const paragraphLowered = paragraphFormatting.projection.lower(paragraphStyleState.doc);
assert.equal(blocks(paragraphLowered)[0], blocks(paragraphFormatting.value)[0]);
assert.equal(blocks(paragraphLowered)[2], blocks(paragraphFormatting.value)[2]);
assert.ok(text(paragraphLowered).includes('firstLineIndent: -15'));
const formattedItem = (fill(blocks(paragraphLowered)[1]!, 'items') as {items: Component[]}).items[0]!;
assert.equal(fill(formattedItem, 'indent').kind, 'number');
assert.equal(fill(formattedItem, 'children'), fill((fill(blocks(paragraphFormatting.value)[1]!, 'items') as {items: Component[]}).items[0]!, 'children'));
assert.equal(new TextProjection({ content: paragraphLowered, registry }).doc.child(1).firstChild!.firstChild!.attrs.firstLineIndent, -15);
paragraphStyleState = apply(paragraphStyleState, liftListItem(paragraphStyleState.schema.nodes.list_item!));
assert.equal(blocks(paragraphFormatting.projection.lower(paragraphStyleState.doc))[1]!.name, 'Paragraph');

const listsToolbar = compile('[// retain owner\nParagraph { content: ["one"] spaceAfter: 12 } Paragraph { content: ["two"] } Paragraph { content: ["untouched"] }]');
let listToolbarState = EditorState.create({ doc: listsToolbar.projection.doc, plugins: [history()] });
listToolbarState = listToolbarState.apply(listToolbarState.tr.setSelection(TextSelection.create(listToolbarState.doc, 1, 9)));
listToolbarState = apply(listToolbarState, setListStyle('decimal', 4));
assert.equal(listToolbarState.doc.firstChild!.childCount, 2);
let listResult = listsToolbar.projection.lower(listToolbarState.doc);
assert.ok(text(listResult).includes('// retain owner'));
assert.ok(text(listResult).includes('spaceAfter: 12'));
assert.equal(blocks(listResult)[1], blocks(listsToolbar.value)[2]);
listToolbarState = atText(listToolbarState, 'two', 1);
listToolbarState = apply(listToolbarState, changeListDepth(1));
listToolbarState = apply(listToolbarState, setListStyle('square'));
assert.equal(listToolbarState.doc.firstChild!.type.name, 'ordered_list');
assert.equal(listToolbarState.doc.firstChild!.firstChild!.child(1).type.name, 'bullet_list');
assert.equal(listToolbarState.doc.firstChild!.attrs.start, 4);
listToolbarState = apply(listToolbarState, changeListDepth(-1));
listToolbarState = apply(listToolbarState, setListStyle('upper-roman', 9));
listResult = listsToolbar.projection.lower(listToolbarState.doc);
assert.ok(text(listResult).includes('style: "upper-roman"'));
assert.ok(text(listResult).includes('start: 9'));
assert.equal(setListStyle('decimal', 1.5)(listToolbarState), false);

const liftOwner = compile('[List { items: [// keep item owner\nListItem { content: ["lift"] indent: 24 }] }]');
let liftOwnerState = EditorState.create({ doc: liftOwner.projection.doc });
liftOwnerState = atText(liftOwnerState, 'lift', 2);
liftOwnerState = apply(liftOwnerState, changeListDepth(-1));
const liftedOwnerSource = text(liftOwner.projection.lower(liftOwnerState.doc));
assert.ok(liftedOwnerSource.includes('// keep item owner'));
assert.ok(liftedOwnerSource.includes('indent: 24'));
assert.ok(liftedOwnerSource.includes('Paragraph {'));

const feedbackProjection = compile('[Paragraph { content: ["plain" Span { content: ["bold"] weight: "700" color: accent }] align: "right" }]');
let feedbackState = EditorState.create({ doc: feedbackProjection.projection.doc });
feedbackState = feedbackState.apply(feedbackState.tr.setSelection(TextSelection.create(feedbackState.doc, 2, 9)));
assert.equal(formattingState(feedbackState).inline.weight.mixed, true);
assert.equal(formattingState(feedbackState).paragraph.align.value, 'right');
feedbackState = atText(feedbackState, 'bold', 2);
assert.equal(formattingState(feedbackState).inline.color.value, 'accent');
assert.equal(formattingState(feedbackState).inline.weight.value, '700');
feedbackState = apply(feedbackState, setTextStyle('italic', true));
assert.equal(formattingState(feedbackState).inline.italic.value, true);
assert.equal(formattingState(feedbackState).caret, true);

// Stroke shares the inline provenance/lowering path, including authored tokens.
const outlined = compile('[Paragraph { content: [Span { content: "outline" strokeWidth: 2 strokeColor: accent }] }]');
const outlinedProjection = new TextProjection({ content: outlined.value, registry, colorTokens: { accent: '#ff0000' } });
assert.equal(outlinedProjection.lower(outlinedProjection.doc), outlined.value);
let outlinedState = EditorState.create({ doc: outlinedProjection.doc });
outlinedState = outlinedState.apply(outlinedState.tr.setSelection(TextSelection.create(outlinedState.doc, 1, 8)));
assert.equal(formattingState(outlinedState).inline.strokeColor.value, 'accent');
assert.equal(outlinedState.doc.firstChild!.firstChild!.marks.find(mark => mark.type.name === 'strokeColor')!.attrs.value, '#ff0000');
outlinedState = apply(outlinedState, setTextStyle('strokeWidth', 3));
const outlinedSource = text(outlinedProjection.lower(outlinedState.doc));
assert.ok(outlinedSource.includes('strokeWidth: 3'));
assert.ok(outlinedSource.includes('strokeColor: accent'));
outlinedState = apply(outlinedState, clearTextStyles);
assert.ok(!text(outlinedProjection.lower(outlinedState.doc)).includes('strokeWidth:'));
assert.ok(!text(outlinedProjection.lower(outlinedState.doc)).includes('strokeColor:'));
