import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getEditorSource, setHostSource } from './editor-helpers';

test('deck switching keeps independent drafts across reload and exports actual source', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau');
  const source = await getEditorSource(page);
  const edited = source.replace('PLATEAU 2026', 'UIST draft');
  await setHostSource(page, edited);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved in this browser');
  await page.reload();
  await expect.poll(() => getEditorSource(page)).toBe(edited);
  await page.getByLabel('Deck', { exact: true }).selectOption('reference');
  await expect(page.getByRole('option', { name: /^Slide \d+$/ })).toHaveCount(7);
  expect(await getEditorSource(page)).not.toBe(edited);
  await page.getByLabel('Deck', { exact: true }).selectOption('plateau');
  await expect.poll(() => getEditorSource(page)).toBe(edited);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('plateau-2026.sw');
  expect(await readFile((await download.path())!, 'utf8')).toBe(edited);
  await page.getByLabel('Open deck file', { exact: true }).setInputFiles({ name: 'uist-talk.sw', mimeType: 'text/plain', buffer: Buffer.from(edited) });
  await expect(page.getByRole('status')).toContainText('Opened uist-talk.sw');
  await expect.poll(() => getEditorSource(page)).toBe(edited);
  await page.reload();
  await expect(page.getByLabel('Deck', { exact: true })).toHaveValue('custom');
  await expect.poll(() => getEditorSource(page)).toBe(edited);
});

test('invalid imports preserve the current deck and fixture edits do not persist', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.getByLabel('Open deck file', { exact: true }).setInputFiles({ name: 'broken.sw', mimeType: 'text/plain', buffer: Buffer.from('Deck { slides: [') });
  await expect(page.getByRole('status')).toContainText('Could not open');
  expect(await getEditorSource(page)).toBe(before);
  await setHostSource(page, before.replace('Hello', 'Temporary'));
  await page.reload();
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

test('presentation view hides editor chrome and retains slide and opaque playback controls', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Data-oriented Debugging with', { exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.keyboard.press('Delete');
  expect(await getEditorSource(page)).toBe(before);
  await expect(page.locator('.sw-editor-pane')).toBeHidden();
  await expect(page.locator('.sw-tool-palette')).toBeHidden();
  await page.locator('.sw-standalone-controls').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  await expect(demo).toBeVisible();
  await demo.getByRole('button', { name: 'Next demo step', exact: true }).click();
  await expect(demo).toHaveAttribute('data-step', '1');
  await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
  await expect(page.locator('.sw-editor-pane')).toBeVisible();
  expect(await getEditorSource(page)).toBe(before);
});
