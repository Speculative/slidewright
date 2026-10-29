import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState, TextSelection } from 'prosemirror-state';
import { joinBackward, splitBlock } from 'prosemirror-commands';
import { parse } from '../../runtime/parser.js';
import { emitValue } from '../../runtime/emitter.js';
import type { Component, Value } from '../../runtime/ast.js';
import type { ComponentRegistry } from '../../runtime/contract.js';
import { TextRunIdentity, textRunId, textRuns } from '../../runtime/text-runs.js';
import { TextProjection } from '../rich-text/projection.js';
import { leafIdentityPlugin } from '../rich-text/selection.js';

const value = (source: string) => parse(`TextBox { content:${source} }`,'runs.sw').ast.items[0]!.fills[0]!.value;
const content = (node: Component) => node.fills.find(fill => fill.name === 'content')!.value;
const ids = (input: Value) => textRuns(input).map(run => textRunId(run)!);
function plain(input: Value): string {
  if (input.kind === 'string') return input.value;
  if (input.kind === 'list') return input.items.map(plain).join('');
  if (input.kind === 'component') return input.fills.filter(fill => ['content','items','children'].includes(fill.name)).map(fill => plain(fill.value)).join('');
  return '';
}
function compile(source: string) {
  const input = value(source);
  const projection = new TextProjection({content:input,registry:{},persistentRuns:true});
  const state = EditorState.create({doc:projection.doc, plugins:[leafIdentityPlugin()]});
  return {input,projection,state};
}
function at(state: EditorState, text: string, offset = 0) {
  let position = -1;
  state.doc.descendants((node,pos) => {if (node.isText && node.text === text) position = pos + offset;});
  assert.notEqual(position,-1);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc,position)));
}

test('identity preparation is private, deterministic, round-trippable and non-destructive', () => {
  const input = value('[Paragraph { content:["one", "two", Span {content:"three" color:accent}] }]');
  const before = structuredClone(input);
  const first = new TextRunIdentity(input);
  const second = new TextRunIdentity(input);
  assert.deepEqual(input,before);
  assert.deepEqual(first.prepared,second.prepared);
  assert.equal(plain(first.prepared!),'onetwothree');
  assert.equal(new Set(ids(first.prepared!)).size,3);
  const roundTrip = value(emitValue(first.prepared!));
  assert.deepEqual(ids(new TextRunIdentity(roundTrip).prepared!),ids(first.prepared!));
  const projection = new TextProjection({content:input,registry:{},persistentRuns:true});
  assert.equal(projection.lower(projection.doc),input,'an untouched draft never materializes IDs');
  assert.deepEqual(projection.runChanges,{splits:[],added:[],removed:[]});
});

test('a wording correction keeps its authored run ID through lowering and reopening', () => {
  const {projection,state:initial} = compile('[Paragraph {content:[Span {runId:"phrase" color:accent content:"print debugging"}]}]');
  const state = at(initial,'print debugging',5);
  const result = projection.lower(state.apply(state.tr.insertText('f')).doc);
  assert.equal(plain(result),'printf debugging');
  assert.deepEqual(ids(result),['phrase']);
  assert.deepEqual(projection.runChanges,{splits:[],added:[],removed:[]});
  assert.match(emitValue(result),/color: accent/);
  const reopened = new TextProjection({content:value(emitValue(result)),registry:{},persistentRuns:true});
  assert.deepEqual(ids(reopened.preparedContent!),['phrase']);
});

test('partial formatting splits a stable run and reports ancestry without duplicate identities', () => {
  const {projection,state} = compile('[Paragraph {content:[Span {runId:"phrase" content:"abcdef"}]}]');
  const changed = state.apply(state.tr.addMark(3,5,projection.schema.marks.color!.create({value:'red'})));
  const result = projection.lower(changed.doc);
  assert.equal(plain(result),'abcdef');
  assert.deepEqual(ids(result),['phrase','run-1','run-2']);
  assert.deepEqual(textRuns(result).map(run => plain(content(run))),['ab','cd','ef']);
  assert.deepEqual(projection.runChanges.splits,[{id:'run-1',from:'phrase'},{id:'run-2',from:'phrase'}]);
  assert.equal(textRuns(result)[1]!.fills.find(fill => fill.name === 'color')?.value.kind,'string');
  const firstChanges = structuredClone(projection.runChanges);
  assert.deepEqual(projection.lower(changed.doc),result,'repeated draft lowering is deterministic');
  assert.deepEqual(projection.runChanges,firstChanges);
});

test('splitting nested marked runs keeps run ancestry and one authored comment/scene ID', () => {
  const {projection,state} = compile(`[Paragraph {content:[
    // keep this style owner
    Span {id:"style-owner" color:accent content:[Span {runId:"phrase" content:"abcdef"}]}
  ]}]`);
  const result = projection.lower(state.apply(state.tr.addMark(3,5,projection.schema.marks.weight!.create({value:'700'}))).doc);
  assert.equal(plain(result),'abcdef');
  assert.equal(new Set(ids(result)).size,ids(result).length);
  assert.equal(ids(result)[0],'phrase');
  assert.equal(projection.runChanges.splits.length,2);
  const source = emitValue(result);
  assert.equal((source.match(/keep this style owner/g) ?? []).length,1);
  assert.equal((source.match(/id: "style-owner"/g) ?? []).length,1);
  assert.match(source,/weight: "700"/);
});

test('paragraph split gives fresh fragment IDs while a join retains distinct runs', () => {
  const {projection,state:initial} = compile('[Paragraph {content:[Span {runId:"phrase" content:"abcdef"}]}]');
  let state = at(initial,'abcdef',3);
  assert.equal(splitBlock(state,tr => {state = state.apply(tr);}),true);
  const split = projection.lower(state.doc);
  assert.equal(plain(split),'abcdef');
  assert.deepEqual(ids(split),['phrase','run-1']);
  assert.deepEqual(projection.runChanges.splits,[{id:'run-1',from:'phrase'}]);
  const reopened = new TextProjection({content:split,registry:{},persistentRuns:true});
  let joined = at(EditorState.create({doc:reopened.doc}),'def');
  assert.equal(joinBackward(joined,tr => {joined = joined.apply(tr);}),true);
  assert.deepEqual(ids(reopened.lower(joined.doc)),['phrase','run-1']);
  assert.deepEqual(reopened.runChanges.removed,[]);
});

test('deleting a run reports its removal without rebinding a neighbor', () => {
  const {projection,state} = compile('[Paragraph {content:[Span {runId:"one" content:"first"} Span {runId:"two" content:"second"}]}]');
  const result = projection.lower(state.apply(state.tr.delete(1,6)).doc);
  assert.equal(plain(result),'second');
  assert.deepEqual(ids(result),['two']);
  assert.deepEqual(projection.runChanges.removed,['one']);
});

test('foreign pasted run IDs become new identities without split ancestry', () => {
  const identity = new TextRunIdentity(value('[Paragraph {content:[Span {runId:"existing" content:"original"}]}]'));
  const result = identity.reconcile(value('[Paragraph {content:[Span {runId:"existing" content:"original"} Span {runId:"foreign" content:"copy"}]}]'));
  assert.deepEqual(ids(result.content),['existing','run-1']);
  assert.deepEqual(result.changes.splits,[]);
  assert.deepEqual(result.changes.added,['run-1']);
});

test('identity traversal respects transparent and owned inline editing boundaries', () => {
  const registry = {
    Transparent:{meta:{produces:'text',slots:{body:{type:'text'}},inlineEditing:{mode:'transparent',contentSlot:'body'}}},
    Owned:{meta:{produces:'text',slots:{body:{type:'text'}},inlineEditing:{mode:'owned'}}},
  } as unknown as ComponentRegistry;
  const input = value('[Paragraph {content:[Transparent {body:"editable"} Owned {body:Span {runId:"private" content:"owned"}}]}]');
  const identity = new TextRunIdentity(input,registry);
  const runs = textRuns(identity.prepared,registry);
  assert.ok(runs.length >= 2);
  assert.ok(runs.every(run => textRunId(run) !== 'private'));
  assert.match(emitValue(identity.prepared!),/runId: "private"/,'opaque internals remain untouched');
  assert.equal(new Set(runs.map(textRunId)).size,runs.length);
});

test('empty text has no phantom run and duplicate authored identities are rejected', () => {
  assert.deepEqual(textRuns(new TextRunIdentity(value('""')).prepared),[]);
  assert.throws(() => new TextRunIdentity(value('[Paragraph {content:[Span {runId:"same" content:"a"} Span {runId:"same" content:"b"}]}]')),/Duplicate text run ID/);
});

test('allocation reserves identities from other build variants instead of aliasing unrelated text', () => {
  const identity = new TextRunIdentity(value('[Paragraph {content:["new wording"]}]'),{},['run-1','run-2']);
  assert.deepEqual(ids(identity.prepared!),['run-3']);
  const split = identity.reconcile(value('[Paragraph {content:[Span {runId:"run-3" content:"new"} Span {runId:"run-3" content:" wording"}]}]'));
  assert.deepEqual(ids(split.content),['run-3','run-4']);
  assert.deepEqual(split.changes.splits,[{id:'run-4',from:'run-3'}]);
});
