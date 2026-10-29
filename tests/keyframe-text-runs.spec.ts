import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource, selectRichText } from './editor-helpers';
import { parse } from '../slidewright/runtime/parser';
import { buildProperty } from '../slidewright/runtime/builds';
import { textRunId, textRuns } from '../slidewright/runtime/text-runs';
import type { Component } from '../slidewright/runtime/ast';

const source = `Deck {slides:[Slide {content:TextBox {id:"text" x:200 y:200 width:1200 height:200
  content:[Paragraph {content:[Span {runId:"phrase" content:"print debugging"}]}]
} builds:[Build {id:"one" changes:[]} Build {id:"two" changes:[]}]}]}`;
async function start(page: Page, input = source) {
  await page.goto('/canvas.html?fixture=empty-freeform'); await setHostSource(page,input);
  await page.getByRole('option',{name:/^Slide 1 build 1:/}).click();
}
const textBox = (page: Page) => page.locator('.sw-canvas-stage [data-sw-component="TextBox"]').first();
async function ids(page: Page,index: number) {
  const ast = parse(await getEditorSource(page),'runs.sw').ast;
  const slides = ast.items[0]!.fills.find(fill => fill.name === 'slides')!.value;
  const slide = (slides as {items:Component[]}).items[0]!;
  return textRuns(buildProperty(slide,index,'text','content').value).map(textRunId);
}

test('a wording correction retains source run identity through commit, reopening, undo and redo', async ({page}) => {
  const errors: string[] = []; page.on('pageerror',error => errors.push(error.message));
  await start(page);
  const before = await getEditorSource(page);
  await textBox(page).dblclick();
  await selectRichText(page,'print debugging',5);
  await page.keyboard.type('f'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  await expect(textBox(page)).toContainText('printf debugging');
  expect(await ids(page,0)).toEqual(['phrase']);
  expect(await ids(page,1)).toEqual(['phrase']);
  const corrected = await getEditorSource(page);
  await textBox(page).dblclick();
  await expect(page.locator('.sw-rich-text-editor')).toContainText('printf debugging');
  await page.keyboard.press('Escape');
  expect(await getEditorSource(page)).toBe(corrected);
  await page.locator('.sw-standalone').focus(); await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => getEditorSource(page)).toBe(corrected);
  expect(await ids(page,1)).toEqual(['phrase']);
  expect(errors).toEqual([]);
});

test('build drafts allocate identities only on acceptance and preserve unique fragments through paragraph splits', async ({page}) => {
  await start(page,source.replace('Span {runId:"phrase" content:"print debugging"}','"print debugging"'));
  const before = await getEditorSource(page);
  await textBox(page).dblclick(); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  expect(await getEditorSource(page)).toBe(before);
  await textBox(page).dblclick(); await selectRichText(page,'print debugging',0,'print debugging',5);
  await page.keyboard.press('Control+i'); await page.keyboard.press('Escape');
  expect(await getEditorSource(page)).toBe(before);
  await textBox(page).dblclick(); await selectRichText(page,'print debugging',0,'print debugging',5);
  await page.keyboard.press('Control+i'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  const first = await ids(page,1);
  expect(await ids(page,0)).toEqual(first);
  expect(first).toHaveLength(2); expect(new Set(first).size).toBe(2);
  await page.getByRole('option',{name:/^Slide 1 build 2:/}).click();
  await textBox(page).dblclick(); await selectRichText(page,'print',3);
  await page.keyboard.press('Enter'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  expect(await ids(page,1)).toEqual(first);
  const split = await ids(page,2);
  expect(split).toHaveLength(3); expect(new Set(split).size).toBe(3);
  expect(split[0]).toBe(first[0]);
  expect(parse(await getEditorSource(page),'runs.sw').diagnostics).toEqual([]);
  await expect(page.locator('.sw-canvas-diagnostics')).toHaveCount(0);
});

test('native rich-text copy and paste creates independent run identities', async ({page,context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await start(page);
  await textBox(page).dblclick(); await selectRichText(page,'print debugging',0,'print debugging',15);
  await page.keyboard.press('Control+c'); await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' / '); await page.keyboard.press('Control+v');
  await expect(page.locator('.sw-rich-text-editor')).toContainText('print debugging / print debugging');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  const result = await ids(page,1);
  expect(result[0]).toBe('phrase');
  expect(result.length).toBeGreaterThanOrEqual(2);
  expect(new Set(result).size).toBe(result.length);
  expect(await ids(page,0)).toEqual(['phrase']);
});

test('new identities in an earlier wording variant cannot alias later build fragments', async ({page}) => {
  await start(page,source.replace('Span {runId:"phrase" content:"print debugging"}','"print debugging"')
    .replace('Build {id:"one" changes:[]}', 'Build {id:"one" changes:[Change {target:"text" content:[Paragraph {content:["print debugging"]}]}]}'));
  await textBox(page).dblclick(); await selectRichText(page,'print debugging',0,'print debugging',5);
  await page.keyboard.press('Control+i'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  const later = await ids(page,1);
  await page.getByRole('option',{name:'Slide 1',exact:true}).click();
  await textBox(page).dblclick(); await selectRichText(page,'print debugging',5);
  await page.keyboard.type('f'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  const initial = await ids(page,0);
  expect(initial).toHaveLength(1);
  expect(later).not.toContain(initial[0]);
  expect(await ids(page,1)).toEqual(later);
});
