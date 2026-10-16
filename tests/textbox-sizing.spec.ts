import { expect, test } from '@playwright/test';
import { getEditorSource, openInsertionPicker, setHostSource } from './editor-helpers';

test('click places auto-width text, editing grows it, and sizing controls wrap and fix it', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await openInsertionPicker(page);
  await page.locator('.sw-tool', { hasText: /^TextBox$/ }).click();
  await expect(page.locator('.sw-tool-status')).toContainText('Click to place TextBox');
  const stage = page.locator('.sw-canvas-stage .presentation-canvas');
  const box = await stage.boundingBox();
  if (!box) throw new Error('Missing canvas');
  await page.mouse.click(box.x + box.width * .1, box.y + box.height * .15);
  await expect.poll(() => getEditorSource(page)).toContain('sizing: "auto-width"');
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content]').last();
  const initial = await content.boundingBox();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveText('');
  await page.keyboard.type('A longer line of text that grows as you type');
  await expect.poll(async () => (await content.boundingBox())!.width).toBeGreaterThan(initial!.width * 3);
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.getByLabel('Text sizing', { exact: true }).selectOption('auto-height');
  await expect.poll(() => getEditorSource(page)).toContain('sizing: "auto-height"');
  const source = await getEditorSource(page);
  // Preserve the new box's chosen mode while constraining its width.
  await setHostSource(page, source.replace(/(sizing: "auto-height"[\s\S]*?width:) \d+/, '$1 180'));
  await expect.poll(async () => (await content.boundingBox())!.height).toBeGreaterThan(initial!.height * 2);
  await content.click();
  await page.getByLabel('Text sizing', { exact: true }).selectOption('fixed');
  await expect.poll(() => getEditorSource(page)).toContain('sizing: "fixed"');
});

test('auto sizing handles use actual bounds and horizontal resize creates a wrapping box', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await setHostSource(page, 'Deck { slides: [Slide { content: Freeform { children: [TextBox { x: 300 y: 250 content: "Hello" }] } }] }');
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content]');
  await content.click();
  const handle = page.locator('.sw-resize-e');
  await expect(handle).toBeVisible();
  const box = (await content.boundingBox())!;
  const grip = (await handle.boundingBox())!;
  expect(Math.abs(grip.x + grip.width / 2 - box.x - box.width)).toBeLessThan(2);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toContain('sizing: "auto-height"');
  await expect.poll(async () => (await content.boundingBox())!.width).toBeGreaterThan(box.width + 70);
});

test('sizing changes preview in a draft, cancel, and commit with one undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  await setHostSource(page, 'Deck { slides: [Slide { content: Freeform { children: [TextBox { x: 300 y: 250 content: "Hello" }] } }] }');
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content]');
  await content.dblclick();
  await page.getByLabel('Text sizing', { exact: true }).selectOption('fixed');
  await expect(page.getByLabel('Text sizing', { exact: true })).toHaveValue('fixed');
  expect(await getEditorSource(page)).not.toContain('sizing:');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Text sizing', { exact: true })).toHaveValue('auto-width');
  await content.dblclick();
  await page.getByLabel('Text sizing', { exact: true }).selectOption('auto-height');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('sizing: "auto-height"');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).not.toContain('sizing:');
});
