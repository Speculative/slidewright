import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState, TextSelection } from 'prosemirror-state';
import { parse } from '../../runtime/parser.js';
import { emitValue } from '../../runtime/emitter.js';
import type { Component, SourceFile, Value } from '../../runtime/ast.js';
import { booleanLit, stringLit } from '../../runtime/ast-builders.js';
import { buildDifferences, duplicateBuild, moveBuild, removeBuild, buildObjects, buildProperty, editBuildProperties, objectId, resolveBuild, validateBuilds } from '../../runtime/builds.js';
import { buildTextStyle, editBuildTextStyle, clearTextStyleOverrides, pruneTextStyleTargets, setTextField, textField, textStyleKeys, textRunStyles } from '../../runtime/text-builds.js';
import { textRunId, textRuns } from '../../runtime/text-runs.js';
import { applyTextBuildDraft } from '../../runtime/text-build-edit.js';
import { TextProjection } from '../rich-text/projection.js';
import { DeckDocument } from '../../runtime/document.js';
import { commitBuildTextDraft, createBuildEditingSnapshot } from '../build-editing.js';
import { components } from '../../../decks/v0-reference/registry.js';
import { loadDeck } from '../../runtime/loader.js';
import { renderToStaticMarkup } from 'react-dom/server';

const source = `Deck {slides:[Slide {content:TextBox {id:"text" content:[Paragraph {content:[Span {runId:"phrase" content:"print debugging"}]}]}
 builds:[Build {id:"one" changes:[]} Build {id:"two" changes:[]} Build {id:"three" changes:[]}]}]}`;
const slideAt = (ast: SourceFile) => (textField(ast.items[0]!, 'slides') as {items:Component[]}).items[0]!;
const setup = () => slideAt(parse(source,'text-styles.sw').ast);
const owner = (slide: Component) => buildObjects(slide).find(node => objectId(node) === 'text')!;
const content = (slide: Component, index: number) => textField(owner(resolveBuild(slide,index)), 'content')!;
const ids = (value: Value) => textRuns(value).map(run => textRunId(run)!);
function draft(slide: Component, index: number, from = 1, to = 6, field = 'color', value: string | boolean = 'red') {
 const projection = new TextProjection({content:content(slide,index),registry:components,persistentRuns:true});
 const state = EditorState.create({doc:projection.doc});
 const after = projection.lower(state.apply(state.tr.addMark(from,to,projection.schema.marks[field]!.create({value}))).doc);
 return {after, info:{preparedContent:projection.preparedContent,runChanges:projection.runChanges,styleOnly:true}};
}
function format(slide: Component, index: number) {
 const {after,info} = draft(slide,index);
 applyTextBuildDraft(slide,index,'text',after,info,'forward',components);
}

test('phrase formatting creates independent keys, allowing an earlier wording correction through emphasis', () => {
 const slide = setup(); format(slide,1);
 assert.equal(buildProperty(slide,1,'text','content').keyframed,false);
 assert.equal(textStyleKeys(slide,1).length,1);
 assert.deepEqual(ids(content(slide,0)),['phrase','run-1']);
 assert.equal(textRunStyles(content(slide,0)).get('phrase')?.color,undefined);
 assert.equal(textRunStyles(content(slide,1)).get('phrase')?.color?.kind,'string');
 const projection = new TextProjection({content:content(slide,0),registry:components,persistentRuns:true});
 let state = EditorState.create({doc:projection.doc});
 state = state.apply(state.tr.insertText('logging',7,16));
 const after = projection.lower(state.doc);
 applyTextBuildDraft(slide,0,'text',after,{preparedContent:projection.preparedContent,runChanges:projection.runChanges,styleOnly:false},'forward',components);
 assert.match(emitValue(content(slide,1)),/logging/);
 assert.doesNotMatch(emitValue(content(slide,1)),/debugging/);
 assert.equal((textRunStyles(content(slide,1)).get('phrase')!.color as {value:string}).value,'red');
 assert.deepEqual(validateBuilds(slide,components),[]);
});

test('different style channels cross each other and content keys while same-property keys stop propagation', () => {
 const slide=setup(); format(slide,1);
 editBuildTextStyle(slide,2,'text','phrase','weight',stringLit('700'));
 editBuildTextStyle(slide,3,'text','phrase','color',stringLit('blue'));
 editBuildTextStyle(slide,1,'text','phrase','color',stringLit('gray'));
 assert.equal((buildTextStyle(slide,2,'text','phrase','color').value as {value:string}).value,'gray');
 assert.equal((buildTextStyle(slide,3,'text','phrase','color').value as {value:string}).value,'blue');
 editBuildTextStyle(slide,2,'text','phrase','color',stringLit('green'),'everywhere');
 assert.equal((buildTextStyle(slide,0,'text','phrase','color').value as {value:string}).value,'green');
 assert.equal(buildTextStyle(slide,3,'text','phrase','color').keyframed,false);
 assert.equal(buildTextStyle(slide,2,'text','phrase','weight').keyframed,true);
});

test('style boundaries protect initial and later appearances and restore following values', () => {
 const slide=setup();
 editBuildProperties(slide,2,'text',{visible:booleanLit(false)});
 editBuildProperties(slide,3,'text',{visible:booleanLit(true)});
 editBuildTextStyle(slide,1,'text','phrase','color',stringLit('gray'),'forward');
 assert.equal(buildTextStyle(slide,3,'text','phrase','color').value,undefined);
 editBuildTextStyle(slide,2,'text','phrase','weight',stringLit('700'),'backward');
 assert.equal(buildTextStyle(slide,0,'text','phrase','weight').value,undefined);
 assert.equal((buildTextStyle(slide,1,'text','phrase','weight').value as {value:string}).value,'700');
 assert.equal(buildTextStyle(slide,3,'text','phrase','weight').value,undefined);
});

test('splitting a keyed run copies other style keys before independently changing one fragment', () => {
 const slide=setup();
 editBuildTextStyle(slide,1,'text','phrase','weight',stringLit('700'));
 const {after,info}=draft(slide,2,3,6);
 applyTextBuildDraft(slide,2,'text',after,info,'forward',components);
 assert.equal(textStyleKeys(slide,1).length,3);
 for (const run of textRuns(content(slide,2))) assert.equal((textRunStyles(content(slide,2)).get(textRunId(run)!)?.weight as {value:string}).value,'700');
 assert.equal(textStyleKeys(slide,2).length,1);
 assert.equal(buildProperty(slide,2,'text','content').keyframed,false);
 assert.deepEqual(validateBuilds(slide,components),[]);
});

test('canonical source transaction persists one style diff and renders through the real loader', () => {
 const document = new DeckDocument(source,'draft.sw');
 const snapshot=createBuildEditingSnapshot(document.snapshot,{slideIndex:0,buildIndex:1,registry:components});
 const slide=slideAt(document.snapshot.ast as SourceFile);
 const {after,info}=draft(slide,1);
 const result=commitBuildTextDraft(source,snapshot,owner(slide),after,info)!;
 assert.ok(result); assert.equal(result.baseRevision,document.snapshot.revision);
 assert.equal(buildProperty(slideAt(result.ast),1,'text','content').keyframed,false);
 assert.match(result.newSource,/TextStyle/);
 const loaded=loadDeck({source:result.newSource,file:'text-styles.sw',components,buildIndices:new Map([[0,1]])});
 assert.deepEqual(loaded.diagnostics,[]);
 assert.match(loaded.slides.map(element => renderToStaticMarkup(element)).join(''),/color:red/);
 assert.equal(document.snapshot.source,source);
});


test('style-only builds report differences and carry their keys through duplicate, reorder and delete', () => {
 const slide = setup(); format(slide,1);
 assert.deepEqual(buildDifferences(slide,1),[{id:'text',entering:false,exiting:false,properties:['content']}]);
 assert.deepEqual(buildDifferences(slide,2),[]);
 duplicateBuild(slide,1);
 assert.equal(textStyleKeys(slide,2).length,1);
 moveBuild(slide,2,3);
 assert.equal(textStyleKeys(slide,3).length,1);
 removeBuild(slide,1);
 assert.equal(buildTextStyle(slide,1,'text','phrase','color').value,undefined);
 assert.equal((buildTextStyle(slide,2,'text','phrase','color').value as {value:string}).value,'red');
 assert.deepEqual(validateBuilds(slide,components),[]);
});

test('deletion keeps dormant style targets used in another wording variant and prunes globally lost ones', () => {
 const slide = setup(); format(slide,1);
 editBuildProperties(slide,2,'text',{content:stringLit('replacement')});
 pruneTextStyleTargets(slide,components);
 assert.equal(textStyleKeys(slide,1).length,1);
 assert.deepEqual(validateBuilds(slide,components),[]);
 editBuildProperties(slide,0,'text',{content:stringLit('replacement')},'everywhere');
 pruneTextStyleTargets(slide,components);
 assert.equal(textStyleKeys(slide,1).length,0);
 assert.deepEqual(validateBuilds(slide,components),[]);
});

test('whole-box reset clears only its style channel and restores the following boundary', () => {
 const slide=setup(); format(slide,1);
 editBuildTextStyle(slide,1,'text','phrase','weight',stringLit('700'));
 clearTextStyleOverrides(slide,'text','color',{first:1,last:1},components);
 assert.equal(buildTextStyle(slide,1,'text','phrase','color').value,undefined);
 assert.equal((buildTextStyle(slide,2,'text','phrase','color').value as {value:string}).value,'red');
 assert.equal((buildTextStyle(slide,1,'text','phrase','weight').value as {value:string}).value,'700');
 clearTextStyleOverrides(slide,'text','color',{first:0,last:3},components);
 for(let index=0;index<4;index++) assert.equal(buildTextStyle(slide,index,'text','phrase','color').value,undefined);
});

test('explicit later wording remains a barrier while independent styles cross it', () => {
 const slide=setup();
 const later=structuredClone(buildProperty(slide,0,'text','content').value!);
 setTextField(textRuns(later)[0]!,'content',stringLit('printf debugging'));
 editBuildProperties(slide,2,'text',{content:later});
 editBuildTextStyle(slide,1,'text','phrase','color',stringLit('red'));
 const earlier=structuredClone(buildProperty(slide,0,'text','content').value!);
 setTextField(textRuns(earlier)[0]!,'content',stringLit('print logging'));
 editBuildProperties(slide,0,'text',{content:earlier});
 assert.match(emitValue(content(slide,1)),/print logging/);
 assert.match(emitValue(content(slide,2)),/printf debugging/);
 assert.equal((textRunStyles(content(slide,2)).get('phrase')!.color as {value:string}).value,'red');
});


test('editing a later legacy string canonicalizes its inherited identity without invalidating Initial', () => {
 const legacy=source.replace('[Paragraph {content:[Span {runId:"phrase" content:"print debugging"}]}]', '"print debugging"');
 const slide=slideAt(parse(legacy,'legacy.sw').ast);
 const projection=new TextProjection({content:content(slide,1),registry:components,persistentRuns:true});
 const state=EditorState.create({doc:projection.doc});
 const after=projection.lower(state.apply(state.tr.insertText('updated',1,16)).doc);
 applyTextBuildDraft(slide,1,'text',after,{preparedContent:projection.preparedContent,runChanges:projection.runChanges,styleOnly:false},'forward',components);
 const ast=parse(legacy,'legacy.sw').ast;
 (textField(ast.items[0]!, 'slides') as {items:Component[]}).items[0]=slide;
 const loaded=loadDeck({source:emitValue(ast.items[0]!),file:'legacy.sw',components});
 assert.deepEqual(loaded.diagnostics,[]);
 assert.match(emitValue(content(slide,0)),/print debugging/);
 assert.match(emitValue(content(slide,1)),/updated/);
});

test('source commits validate transparent run targets with the registry and leave owned internals atomic', () => {
 const registry={...components,
  Transparent:{meta:{produces:'text',slots:{body:{type:'text'}},inlineEditing:{mode:'transparent',contentSlot:'body'}}},
  Owned:{meta:{produces:'text',slots:{body:{type:'text'}},inlineEditing:{mode:'owned'}}},
 } as unknown as typeof components;
 const custom=source.replace('Span {runId:"phrase" content:"print debugging"}',
  'Transparent {body:Span {runId:"phrase" content:"print debugging"}} Owned {body:Span {runId:"private" content:"secret"}}');
 const document=new DeckDocument(custom,'custom.sw');
 const snapshot=createBuildEditingSnapshot(document.snapshot,{slideIndex:0,buildIndex:1,registry});
 const slide=slideAt(document.snapshot.ast as SourceFile);
 const after=structuredClone(content(slide,1));
 setTextField(textRuns(after,registry).find(run=>textRunId(run)==='phrase')!,'color',stringLit('red'));
 const result=commitBuildTextDraft(custom,snapshot,owner(slide),after,{
  preparedContent:content(slide,1),runChanges:{splits:[],added:[],removed:[]},styleOnly:true,
 });
 assert.ok(result);
 const authored=slideAt(result.ast);
 assert.deepEqual(validateBuilds(authored,registry),[]);
 assert.equal(textStyleKeys(authored,1).length,1);
 assert.match(emitValue(content(authored,1)),/content: "secret"/);
 assert.equal(textRuns(content(authored,1),registry).some(run=>textRunId(run)==='private'),false);
});


test('deleting the only wording owner prunes later style keys for its lost runs', () => {
 const slide=setup();
 const later=structuredClone(buildProperty(slide,0,'text','content').value!);
 setTextField(textRuns(later)[0]!,'runId',stringLit('later'));
 editBuildProperties(slide,1,'text',{content:later});
 editBuildTextStyle(slide,2,'text','later','color',stringLit('red'));
 removeBuild(slide,1,components);
 assert.equal(textStyleKeys(slide,1).length,0);
 assert.deepEqual(validateBuilds(slide,components),[]);
});
