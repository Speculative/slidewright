import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';
import { parse } from '../slidewright/runtime/parser';
import { buildFrames, buildProperty } from '../slidewright/runtime/builds';
import type { Component } from '../slidewright/runtime/ast';

async function values(page: Page, property: string, id = 'node') {
  const ast = parse(await getEditorSource(page), 'test.sw').ast;
  const slides = ast.items[0]!.fills.find(fill => fill.name === 'slides')!.value;
  const slide = (slides as { items: Component[] }).items[0]!;
  return buildFrames(slide).map(frame => {
    const value = buildProperty(slide, frame.index, id, property).value;
    return value && 'value' in value ? value.value : value?.kind;
  });
}
async function frame(page: Page, index: number) {
  await page.getByRole('option', { name: index === 0 ? 'Slide 1' : new RegExp(`^Slide 1 build ${index}:`), exact: index === 0 }).click();
}
async function selectBox(page: Page) { await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').first().click(); }
async function field(page: Page, property: string, value: string) {
  const input = page.locator(`[data-build-property="${property}"] input`).first();
  await input.fill(value); await input.press('Enter');
}

test('Everywhere crosses position barriers, preserves other properties, and undoes as one edit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await selectBox(page); await field(page, 'x', '240');
  await field(page, 'opacity', '0.4');
  await frame(page, 2); await selectBox(page); await field(page, 'x', '360');
  await frame(page, 1); await selectBox(page);
  const before = await getEditorSource(page);
  const direction = page.getByRole('button', { name: 'Propagation direction' });
  await direction.click(); await direction.click();
  await expect(direction).toContainText('Everywhere');
  await expect(page.locator('.sw-build-scope-hint')).toContainText('replaces keyframes');
  await field(page, 'x', '180');
  await expect.poll(() => values(page, 'x')).toEqual([180, 180, 180]);
  expect(await values(page, 'y')).toEqual([150, 150, 150]);
  expect(await values(page, 'opacity')).toEqual([undefined, 0.4, 0.4]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await direction.press('Alt+Shift+b');
  await expect(direction).toContainText('Forward');
});

test('Everywhere aligns and distributes the complete diagram including stationary anchors in hidden frames', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { id:"scene" children: [
    TextBox { id:"a" x:200 y:100 width:500 height:100 content:"First" }
    TextBox { id:"b" x:400 y:250 width:500 height:100 content:"Second" visible:false }
    TextBox { id:"c" x:600 y:900 width:500 height:100 content:"Third" visible:false }
  ] } builds: [
    Build { id:"one" changes:[Change { target:"a" x:100 y:150 } Change { target:"b" visible:true x:300 y:400 }] }
    Build { id:"two" changes:[Change { target:"c" visible:true x:500 y:750 }] }
  ] }] }`);
  await frame(page, 2);
  const rows = page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await rows.nth(2).click({ modifiers: ['Shift'] });
  const direction = page.getByRole('button', { name: 'Propagation direction' });
  await direction.click(); await direction.click();
  const before = await getEditorSource(page);
  await page.getByRole('button', { name: 'Align left', exact: true }).click();
  for (const id of ['a','b','c']) {
    const positions = await values(page, 'x', id);
    expect(positions[0]).toBeCloseTo(100, 2);
    expect(positions).toEqual([positions[0], positions[0], positions[0]]);
  }
  await page.getByRole('button', { name: 'Distribute vertical space', exact: true }).click();
  for (const [id, y] of [['a',150],['b',450],['c',750]] as const) {
    const positions = await values(page, 'y', id);
    expect(positions[0]).toBeCloseTo(y, 2);
    expect(positions).toEqual([positions[0], positions[0], positions[0]]);
  }
  expect(await values(page, 'visible', 'b')).toEqual([false,true,true]);
  expect(await values(page, 'visible', 'c')).toEqual([false,false,true]);
  await page.keyboard.press('Control+z');
  expect(await values(page, 'y', 'a')).toEqual([100,150,150]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

test('inspector edits propagate forward, respect pins, reset, and undo on the same frame', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await selectBox(page); await field(page, 'x', '240');
  await expect.poll(() => values(page, 'x')).toEqual([100, 240, 240]);
  await frame(page, 2); await selectBox(page);
  await page.getByRole('button', { name: 'Keyframe x', exact: true }).click();
  await frame(page, 1); await selectBox(page); await field(page, 'x', '300');
  await expect.poll(() => values(page, 'x')).toEqual([100, 300, 240]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => values(page, 'x')).toEqual([100, 240, 240]);
  await expect(page.locator('.sw-build-controls')).toContainText('Frame 2 of 3');
  await frame(page, 2); await selectBox(page);
  await page.getByRole('button', { name: 'Inherit x', exact: true }).click();
  await frame(page, 1); await selectBox(page); await field(page, 'x', '350');
  await expect.poll(() => values(page, 'x')).toEqual([100, 350, 350]);
});

test('backward non-movement edits and optional defaults restore the later frame', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1);
  await page.getByRole('button', { name: 'Propagation direction' }).click();
  await selectBox(page); await field(page, 'width', '400');
  await expect.poll(() => values(page, 'width')).toEqual([400, 400, 240]);
  await field(page, 'opacity', '0.25');
  await expect.poll(() => values(page, 'opacity')).toEqual([0.25, 0.25, undefined]);
  await frame(page, 2); await selectBox(page);
  await expect(page.getByRole('button', { name: 'Inherit opacity', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('relative dragging starts at the selected build value, and Escape cancels', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await selectBox(page); await field(page, 'x', '240');
  const canvas = (await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox())!;
  const scale = canvas.width / 1920;
  const box = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first();
  const bounds = (await box.boundingBox())!;
  const x = bounds.x + bounds.width / 2; const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 60 * scale, y + 20 * scale, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await values(page, 'x')).map(value => typeof value === 'number' ? Math.round(value) : value)).toEqual([100, 300, 300]);
  const before = await getEditorSource(page);
  const moved = (await box.boundingBox())!;
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2); await page.mouse.down();
  await page.mouse.move(moved.x + moved.width / 2 + 30, moved.y + moved.height / 2, { steps: 4 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await getEditorSource(page)).toBe(before);
});

test('deleting and restoring keeps the object definition and identity', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await selectBox(page); await page.keyboard.press('Delete');
  await expect.poll(() => values(page, 'visible')).toEqual([true, false, false]);
  await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(0);
  await frame(page, 0); await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(1);
  await frame(page, 2); await page.locator('.sw-hidden-objects summary').click();
  await page.getByRole('button', { name: 'Restore Box · node', exact: true }).click();
  await expect.poll(() => values(page, 'visible')).toEqual([true, false, true]);
  expect((await getEditorSource(page)).match(/Box\s*\{/g)).toHaveLength(3); // Box and two TextBox suffixes
});

test('rich-text content starts at effective content and commits only from the chosen frame', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1);
  const text = page.locator('.sw-canvas-stage [data-sw-component="TextBox"]').first();
  await text.dblclick();
  const editor = page.locator('.sw-rich-text-editor .ProseMirror, .sw-rich-text-editor[contenteditable=true]').first();
  await expect(editor).toBeVisible();
  await page.keyboard.press('Control+a'); await page.keyboard.type('Focus caption'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.sw-rich-text-editor')).toHaveCount(0);
  await expect(page.locator('.sw-canvas-stage')).toContainText('Focus caption');
  await frame(page, 0); await expect(page.locator('.sw-canvas-stage')).toContainText('Diagram caption');
  await frame(page, 2); await expect(page.locator('.sw-canvas-stage')).toContainText('Focus caption');
  await text.dblclick(); await expect(editor).toContainText('Focus caption');
  await page.keyboard.press('Control+a'); await page.keyboard.type('Return caption'); await page.keyboard.press('Control+Enter');
  await frame(page, 1); await expect(page.locator('.sw-canvas-stage')).toContainText('Focus caption');
  await frame(page, 2); await expect(page.locator('.sw-canvas-stage')).toContainText('Return caption');
});


test('a later y pin also bounds a horizontal drag', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 2); await selectBox(page);
  await page.getByRole('button', { name: 'Keyframe y', exact: true }).click();
  await frame(page, 1); await selectBox(page);
  const canvas = (await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox())!;
  const scale = canvas.width / 1920;
  const box = (await page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first().boundingBox())!;
  const x = box.x + box.width / 2; const y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 60 * scale, y, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await values(page, 'x')).map(value => typeof value === 'number' ? Math.round(value) : value)).toEqual([100, 160, 100]);
});

test('drawing introduces one object from the current frame onward', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await page.keyboard.press('r');
  const canvas = (await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox())!;
  const scale = canvas.width / 1920;
  await page.mouse.move(canvas.x + 1150 * scale, canvas.y + 500 * scale); await page.mouse.down();
  await page.mouse.move(canvas.x + 1400 * scale, canvas.y + 700 * scale, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(2);
  await frame(page, 0); await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(1);
  await frame(page, 2); await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(1);
  await expect(page.locator('.sw-build-controls')).toContainText('Frame 2 of 3');
});

test('numeric scrubbing keeps inherited origins intact and produces one undo entry', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await selectBox(page);
  const before = await getEditorSource(page);
  const key = (await page.locator('[data-build-property="x"] .sw-property-key').boundingBox())!;
  const x = key.x + key.width / 2; const y = key.y + key.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 8, y); await page.mouse.move(x + 16, y);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.up();
  await expect.poll(() => values(page, 'x')).toEqual([100, 116, 116]);
  await page.keyboard.press('Control+z');
  expect(await getEditorSource(page)).toBe(before);
});

test('a property edit captures direction at focus while the hotkey changes the next edit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await selectBox(page);
  const input = page.locator('[data-build-property="width"] input');
  await input.fill('400'); await input.press('Alt+Shift+b'); await input.press('Enter');
  await expect.poll(() => values(page, 'width')).toEqual([240, 400, 400]);
  await expect(page.getByRole('button', { name: 'Propagation direction' })).toContainText('Backward');
  await field(page, 'height', '200');
  await expect.poll(() => values(page, 'height')).toEqual([200, 200, 160]);
});

test('default-valued property edits also retain their starting direction', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await selectBox(page);
  const opacity = page.locator('[data-build-property="opacity"] input');
  await opacity.fill('0.4'); await opacity.press('Alt+Shift+b'); await opacity.press('Enter');
  await expect.poll(() => values(page, 'opacity')).toEqual([undefined, 0.4, 0.4]);
});

test('copy-paste keeps effective properties and creates a new object only from this frame', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await frame(page, 1); await selectBox(page); await field(page, 'x', '240');
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(2);
  await expect(page.locator('[data-build-property="x"] input')).toHaveValue('240');
  await frame(page, 0); await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(1);
});
