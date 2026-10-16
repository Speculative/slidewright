import { test, expect, type Page } from '@playwright/test';
import { focusEditor, getEditorSource, setHostSource } from './editor-helpers';

const rows = (page: Page, name: string) => page.locator(`.sw-hierarchy-node[data-sw-component="${name}"]`);

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('Ctrl+C/V copies the selected shape, selects the paste, and supports undo/redo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await rows(page, 'Box').first().click();
  const before = await getEditorSource(page);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(rows(page, 'Box')).toHaveCount(3);
  await expect(rows(page, 'Box').last()).toHaveClass(/selected/);
  const after = await getEditorSource(page);
  expect(after.match(/fill: amber/g)).toHaveLength(2);
  expect(after).not.toContain('Slidewright elements v1');
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => getEditorSource(page)).toBe(after);
  await page.keyboard.press('Control+v');
  await expect(rows(page, 'Box')).toHaveCount(4);
});

test('copying an inline descendant copies its enclosing TextBox with source content', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform {
    TextBox { x: 50 y: 60 width: 500 height: 200 content: [
      Paragraph { content: ["Keep " Span { weight: 700 content: "formatting" }] }
    ] }
  } }] }`);
  await rows(page, 'Span').click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(rows(page, 'TextBox')).toHaveCount(2);
  await expect(rows(page, 'TextBox').last()).toHaveClass(/selected/);
  expect((await getEditorSource(page)).match(/weight: 700/g)).toHaveLength(2);
});

test('a selected group copies as a unit; a selected child copies only that child', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
    Group { x: 100 y: 150 children: [Box { x: 20 y: 30 width: 100 height: 80 fill: amber }] }
  ] } }] }`);
  await rows(page, 'Box').click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(rows(page, 'Box')).toHaveCount(2);
  await expect(rows(page, 'Group')).toHaveCount(1);
  await rows(page, 'Group').click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(rows(page, 'Group')).toHaveCount(2);
  await expect(rows(page, 'Box')).toHaveCount(4);
  await expect(rows(page, 'Group').last()).toHaveClass(/selected/);
});

test('clipboard survives slide navigation and pastes into an empty Freeform', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await rows(page, 'Box').click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+m');
  await expect(rows(page, 'Box')).toHaveCount(0);
  await page.keyboard.press('Control+v');
  await expect(rows(page, 'Box')).toHaveCount(1);
  await expect(rows(page, 'Box')).toHaveClass(/selected/);
  expect((await getEditorSource(page)).match(/fill: amber/g)).toHaveLength(2);
});

test('source editor keeps native text copy/paste and unrelated clipboard text does not create elements', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await rows(page, 'Box').first().click();
  const before = await getEditorSource(page);
  await page.evaluate(() => navigator.clipboard.writeText('ordinary text'));
  await page.keyboard.press('Control+v');
  expect(await getEditorSource(page)).toBe(before);
  await focusEditor(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Deck {');
  expect(copied).not.toContain('Slidewright elements v1');
  await page.keyboard.press('End');
  await page.evaluate(() => navigator.clipboard.writeText('\n// pasted text'));
  await page.keyboard.press('Control+v');
  await expect.poll(() => getEditorSource(page)).toContain('// pasted text');
  await expect(rows(page, 'Box')).toHaveCount(2);
});
