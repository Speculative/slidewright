import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource, selectRichText } from './editor-helpers';
import { parse } from '../slidewright/runtime/parser';
import { buildProperty } from '../slidewright/runtime/builds';
import { textStyleKeys } from '../slidewright/runtime/text-builds';
import { emitValue } from '../slidewright/runtime/emitter';
import type { Component } from '../slidewright/runtime/ast';

const source = `Deck { slides:[Slide {content:Freeform {id:"scene" children:[
  TextBox {id:"a" x:150 y:150 width:700 height:140 fontSize:60 color:"black" content:[Paragraph {content:[Span {content:"First phrase" color:"red" italic:true}]}]}
  TextBox {id:"b" x:150 y:400 width:700 height:140 fontSize:50 color:"blue" content:"Second phrase"}
]} builds:[
  Build {id:"one" changes:[]}
  Build {id:"two" changes:[Change {target:"a" content:[Paragraph {content:[Span {content:"Later wording" color:"blue" underline:true}]}]}]}
  Build {id:"three" changes:[Change {target:"a" color:"purple"}]}
]}]}`;
const toolbar = (page: Page) => page.getByRole('toolbar', {name:'TextBox formatting',exact:true});
async function start(page: Page) {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, source);
}
async function frame(page: Page, index: number) {
  await page.getByRole('option',{name:index === 0 ? 'Slide 1' : new RegExp(`^Slide 1 build ${index}:`),exact:index === 0}).click();
}
async function select(page: Page, index = 0) { await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').nth(index).click(); }
async function slide(page: Page) {
  const ast = parse(await getEditorSource(page),'format.sw').ast;
  const slides = ast.items[0]!.fills.find(fill => fill.name === 'slides')!.value;
  return (slides as {items:Component[]}).items[0]!;
}
async function colors(page: Page, id = 'a') {
  const current = await slide(page);
  return [0,1,2,3].map(index => {
    const value = buildProperty(current,index,id,'color').value;
    return value && 'value' in value ? value.value : undefined;
  });
}
async function color(page: Page, value: string) {
  await toolbar(page).getByLabel('Foreground color',{exact:true}).fill(value);
  await page.keyboard.press('Enter');
}
async function content(page: Page, index: number) {return emitValue(buildProperty(await slide(page),index,'a','content').value!);}

test('whole-box color has visible keys, crosses wording variants, stops at a color key, and undoes', async ({page}) => {
  await start(page); await frame(page,1); await select(page);
  await expect(toolbar(page).getByLabel('Formatting propagation')).toHaveText('Forward · Build 1');
  await expect(toolbar(page).getByRole('button',{name:'Keyframe text color',exact:true})).toHaveAttribute('aria-pressed','false');
  const before = await getEditorSource(page);
  await color(page,'gray');
  await expect.poll(() => colors(page)).toEqual(['black','gray','gray','purple']);
  await expect(toolbar(page).getByRole('button',{name:'Inherit text color',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await content(page,0)).toContain('color: "red"');
  expect(await content(page,1)).not.toContain('color:');
  expect(await content(page,1)).toContain('italic: true');
  expect(await content(page,2)).toContain('Later wording');
  expect(await content(page,2)).not.toContain('color:');
  expect(await content(page,2)).toContain('underline: true');
  expect(await content(page,3)).toContain('color: "blue"');
  await frame(page,2); await select(page);
  const text = page.locator('.sw-canvas-stage').getByText('Later wording',{exact:true});
  await expect(text).toHaveCSS('color','rgb(128, 128, 128)');
  // Undo restores the operation's frame as well as the exact source.
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await expect(page.locator('.sw-build-controls')).toContainText('Frame 2 of 4');
});

test('multi-selection diamonds show mixed keys, pin individual values together and undo together', async ({page}) => {
  await start(page); await frame(page,1); await select(page);
  await toolbar(page).getByRole('button',{name:'Keyframe text color',exact:true}).click();
  await select(page,1);
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').nth(0).click({modifiers:['Shift']});
  const pin = toolbar(page).getByRole('button',{name:'Keyframe text color',exact:true});
  await expect(pin).toHaveAttribute('aria-pressed','mixed');
  const before = await getEditorSource(page);
  await pin.click();
  await expect(toolbar(page).getByRole('button',{name:'Inherit text color',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await colors(page)).toEqual(['black','black','black','purple']);
  expect(await colors(page,'b')).toEqual(['blue','blue','blue','blue']);
  expect(buildProperty(await slide(page),1,'b','color').keyframed).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await select(page,1);
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').nth(0).click({modifiers:['Shift']});
  await expect(pin).toHaveAttribute('aria-pressed','mixed');
});

test('backward formatting restores later text, Everywhere crosses keys and preserves all wording', async ({page}) => {
  await start(page); await frame(page,1); await select(page);
  await page.getByRole('button',{name:'Propagation direction'}).click();
  await expect(toolbar(page).getByLabel('Formatting propagation')).toContainText('Backward');
  await color(page,'gray');
  await expect.poll(() => colors(page)).toEqual(['black','gray','black','purple']);
  expect(await content(page,0)).toContain('color:');
  expect(await content(page,2)).toContain('color: "blue"');
  await page.getByRole('button',{name:'Propagation direction'}).click();
  await expect(toolbar(page).getByLabel('Formatting propagation')).toContainText('Everywhere');
  // Reapply the displayed value: this is intentional Everywhere editing.
  await toolbar(page).getByLabel('Foreground color',{exact:true}).press('Enter');
  await expect.poll(() => colors(page)).toEqual(['gray','gray','gray','gray']);
  for (const index of [0,1,2,3]) {
    expect(await content(page,index)).not.toContain('color:');
    expect(await content(page,index)).toContain(index < 2 ? 'First phrase' : 'Later wording');
    expect(buildProperty(await slide(page),index,'a','color').keyframed).toBe(index === 0);
  }
});

test('formatting diamonds pin defaults, respect later barriers, and locally resume inheritance', async ({page}) => {
  await start(page); await frame(page,2); await select(page);
  await toolbar(page).getByRole('button',{name:'Keyframe text size',exact:true}).click();
  await frame(page,1); await select(page);
  await toolbar(page).getByLabel('Font size',{exact:true}).fill('80'); await page.keyboard.press('Enter');
  const current = await slide(page);
  expect([0,1,2,3].map(index => (buildProperty(current,index,'a','fontSize').value as {value:number}).value)).toEqual([60,80,60,60]);
  await frame(page,2); await select(page);
  await toolbar(page).getByRole('button',{name:'Inherit text size',exact:true}).click();
  await expect(toolbar(page).getByLabel('Font size',{exact:true})).toHaveValue('80');
  expect(buildProperty(await slide(page),2,'a','fontSize').keyframed).toBe(false);
});

test('selected-word formatting uses an independent style key, committed once, and cancels without source changes', async ({page}) => {
  await start(page); await frame(page,1);
  const text = page.locator('.sw-canvas-stage').getByText('First phrase',{exact:true});
  const before = await getEditorSource(page);
  await text.dblclick();
  await selectRichText(page,'First phrase',0,'First phrase',5);
  const range = page.getByRole('toolbar',{name:'Selection formatting',exact:true});
  await range.getByLabel('Foreground color',{exact:true}).fill('green'); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await text.dblclick(); await selectRichText(page,'First phrase',0,'First phrase',5);
  await range.getByLabel('Foreground color',{exact:true}).fill('green'); await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  expect(await content(page,0)).not.toContain('green');
  expect(buildProperty(await slide(page),1,'a','content').keyframed).toBe(false);
  expect(emitValue(textStyleKeys(await slide(page),1)[0]!)).toContain('green');
  await expect(page.locator('.sw-canvas-stage [style*="color: green"]')).toContainText('First');
  expect(await content(page,2)).toContain('Later wording');
  await select(page);
  await expect(toolbar(page).getByRole('button',{name:'Keyframe text content',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

test('three-text reveal keeps introduction colors under Backward edits, with Everywhere as an explicit override', async ({page}) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, `Deck {slides:[Slide {content:Freeform {id:"scene" children:[
    TextBox {id:"a" x:150 y:100 width:900 height:150 color:"black" content:"First line"}
    TextBox {id:"b" x:150 y:350 width:900 height:150 color:"black" visible:false content:"Second line"}
    TextBox {id:"c" x:150 y:600 width:900 height:150 color:"black" visible:false content:"Third line"}
  ]} builds:[
    Build {id:"one" changes:[Change {target:"b" visible:true}]}
    Build {id:"two" changes:[Change {target:"c" visible:true}]}
    Build {id:"three" changes:[]}
  ]}]}`);
  await frame(page,2);
  await select(page,0);
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').nth(1).click({modifiers:['Shift']});
  await page.getByRole('button',{name:'Propagation direction'}).click();
  const before = await getEditorSource(page);
  await color(page,'gray');
  await expect.poll(() => colors(page,'a')).toEqual(['black','gray','gray','black']);
  expect(await colors(page,'b')).toEqual(['black','black','gray','black']);
  expect(await colors(page,'c')).toEqual(['black','black','black','black']);
  const current = await slide(page);
  expect([0,1,2,3].map(index => (buildProperty(current,index,'b','visible').value as {value:boolean}).value)).toEqual([false,true,true,true]);
  expect([0,1,2,3].map(index => (buildProperty(current,index,'c','visible').value as {value:boolean}).value)).toEqual([false,false,true,true]);
  await frame(page,1); await select(page,1);
  const diamond = toolbar(page).locator('[data-formatting-keyframe="color"]');
  await expect(diamond).toHaveAttribute('data-appearance-barrier','true');
  await expect(diamond).toHaveAttribute('title',/Protected by appearance/);
  await expect(page.locator('.sw-canvas-stage').getByText('Second line',{exact:true})).toHaveCSS('color','rgb(0, 0, 0)');
  await diamond.click(); // Explicit pin remains separate from the implicit boundary.
  await diamond.click();
  await expect(diamond).toHaveAttribute('aria-pressed','false');
  await expect(diamond).toHaveAttribute('data-appearance-barrier','true');
  await page.getByRole('button',{name:'Propagation direction'}).click();
  await color(page,'gray');
  await expect.poll(() => colors(page,'b')).toEqual(['gray','gray','gray','gray']);
  const everywhere = await slide(page);
  expect([0,1,2,3].map(index => (buildProperty(everywhere,index,'b','visible').value as {value:boolean}).value)).toEqual([false,true,true,true]);
  await page.locator('.sw-standalone').focus();
  await page.keyboard.press('Control+z'); // Everywhere formatting is one undo.
  expect(await colors(page,'b')).toEqual(['black','black','gray','black']);
  // The original backward edit was also one transaction, including its restore.
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

test('a restored text object protects its return appearance from later backward formatting', async ({page}) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, `Deck {slides:[Slide {content:TextBox {id:"a" x:150 y:100 width:900 height:150 color:"black" content:"Returning line"} builds:[
    Build {id:"one" changes:[Change {target:"a" visible:false}]}
    Build {id:"two" changes:[Change {target:"a" visible:true}]}
    Build {id:"three" changes:[]}
  ]}]}`);
  await frame(page,3); await select(page);
  await page.getByRole('button',{name:'Propagation direction'}).click();
  await color(page,'gray');
  await expect.poll(() => colors(page)).toEqual(['black','black','black','gray']);
  await frame(page,2); await select(page);
  await expect(toolbar(page).locator('[data-formatting-keyframe="color"]')).toHaveAttribute('data-appearance-barrier','true');
  await expect(page.locator('.sw-canvas-stage').getByText('Returning line',{exact:true})).toHaveCSS('color','rgb(0, 0, 0)');
});
