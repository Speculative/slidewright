import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource, selectRichText } from './editor-helpers';
import { parse } from '../slidewright/runtime/parser';
import { buildProperty } from '../slidewright/runtime/builds';
import { textStyleKeys } from '../slidewright/runtime/text-builds';
import type { Component } from '../slidewright/runtime/ast';

const source=`Deck {slides:[Slide {content:TextBox {id:"text" x:200 y:200 width:1200 height:200
 content:[Paragraph {content:["print debugging"]}]}
 builds:[Build {id:"one" changes:[]} Build {id:"two" changes:[]}]}]}`;
const box=(page:Page)=>page.locator('.sw-canvas-stage [data-sw-component="TextBox"]').first();
const frame=async (page:Page,index:number)=>page.getByRole('option',{name:index ? new RegExp(`^Slide 1 build ${index}:`) : 'Slide 1',exact:!index}).click();
function slide(source:string):Component {
 const ast=parse(source,'range.sw').ast;
 return (ast.items[0]!.fills.find(fill=>fill.name==='slides')!.value as {items:Component[]}).items[0]!;
}
async function start(page:Page) { await page.goto('/canvas.html?fixture=empty-freeform'); await setHostSource(page,source); await frame(page,1); }
async function redPrint(page:Page) {
 await box(page).dblclick(); await selectRichText(page,'print debugging',0,'print debugging',5);
 await page.getByLabel('Text style',{exact:true}).selectOption('color');
 await page.getByLabel('Style value',{exact:true}).fill('red'); await page.getByRole('button',{name:'Apply style',exact:true}).click();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
}
test('earlier wording propagates through a phrase-color key, retaining color and source-exact undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await start(page); const original=await getEditorSource(page); await redPrint(page);
 const colored=await getEditorSource(page);
 expect(buildProperty(slide(colored),1,'text','content').keyframed).toBe(false);
 expect(textStyleKeys(slide(colored),1)).toHaveLength(1);
 await expect(box(page).locator('[style*="color: red"]')).toContainText('print');
 await frame(page,0); await box(page).dblclick(); await selectRichText(page,' debugging',1,' debugging',10);
 await page.keyboard.type('logging'); await page.keyboard.press('Control+Enter');
 await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
 await frame(page,1); await expect(box(page)).toContainText('print logging');
 await expect(box(page).locator('[style*="color: red"]')).toContainText('print');
 await page.locator('.sw-standalone').focus(); await page.keyboard.press('Control+z');
 await expect.poll(()=>getEditorSource(page)).toBe(colored);
 await page.keyboard.press('Control+z'); await expect.poll(()=>getEditorSource(page)).toBe(original);
 await page.keyboard.press('Control+Shift+z'); await expect.poll(()=>getEditorSource(page)).toBe(colored);
 expect(errors).toEqual([]); await expect(page.locator('.sw-diagnostics')).toHaveCount(0);
});

test('typing inside keyed emphasis keeps its identity and does not bake the color into wording',async({page})=>{
 await start(page); await redPrint(page);
 await box(page).dblclick(); await selectRichText(page,'print',5); await page.keyboard.type('f'); await page.keyboard.press('Control+Enter');
 await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0); await expect(box(page)).toContainText('printf debugging');
 const authored=slide(await getEditorSource(page));
 expect(buildProperty(authored,1,'text','content').keyframed).toBe(true);
 expect(JSON.stringify(buildProperty(authored,1,'text','content').value)).not.toContain('"name":"color"');
 await expect(box(page).locator('[style*="color: red"]')).toContainText('printf');
 await box(page).dblclick(); await selectRichText(page,'printf',0,'printf',6); await page.keyboard.press('Control+i'); await page.keyboard.press('Escape');
 expect(await getEditorSource(page)).toContain('TextStyle');
});

test('range diamonds pin partial unchanged text, show mixed selection, inherit locally and cancel without source changes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await start(page);const initial=await getEditorSource(page);
 await box(page).dblclick(); await selectRichText(page,'print debugging',0,'print debugging',5);
 await page.getByLabel('Text style',{exact:true}).selectOption('color');
 const diamond=page.locator('.sw-text-formatting > [data-range-keyframe="color"]');
 await expect(diamond).toHaveAttribute('aria-pressed','false');
 await diamond.click(); await expect(diamond).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await getEditorSource(page)).toBe(initial);
 await box(page).dblclick(); await selectRichText(page,'print debugging',0,'print debugging',5);
 await page.getByLabel('Text style',{exact:true}).selectOption('color'); await diamond.click();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 const pinned=await getEditorSource(page);expect(textStyleKeys(slide(pinned),1)).toHaveLength(1);
 expect(buildProperty(slide(pinned),1,'text','content').keyframed).toBe(false);
 await box(page).dblclick();await selectRichText(page,'print',0,' debugging',10);
 await page.getByLabel('Text style',{exact:true}).selectOption('color');await expect(diamond).toHaveAttribute('aria-pressed','mixed');
 await selectRichText(page,'print',0,'print',5);await expect(diamond).toHaveAttribute('aria-pressed','true');
 await diamond.click();await expect(diamond).toHaveAttribute('aria-pressed','false');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 expect(textStyleKeys(slide(await getEditorSource(page)),1)).toHaveLength(0);
 expect(errors).toEqual([]);
});

test('whole-box color resets an independent phrase color in its range and undoes with the box edit',async({page})=>{
 await start(page);await redPrint(page);
 const before=await getEditorSource(page);
 await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').first().click();
 const toolbar=page.getByRole('toolbar',{name:'TextBox formatting',exact:true});
 await toolbar.getByLabel('Foreground color',{exact:true}).fill('gray');await page.keyboard.press('Enter');
 await expect(box(page).locator('[style*="color: red"]')).toHaveCount(0);
 await expect(box(page)).toContainText('print debugging');
 await frame(page,0);await expect(box(page).locator('[style*="color: gray"]')).toHaveCount(0);
 await frame(page,1);await page.locator('.sw-standalone').focus();await page.keyboard.press('Control+z');
 await expect.poll(()=>getEditorSource(page)).toBe(before);
 await expect(box(page).locator('[style*="color: red"]')).toContainText('print');
});
