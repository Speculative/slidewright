import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getEditorSource, setHostSource } from './editor-helpers';

test('preserved PLATEAU demo edits stay in browser drafts and export independently of the working talk', async ({ page, request }) => {
  const source = await readFile('decks/plateau-demo/deck.sw', 'utf8');
  const working = await (await request.get('/__slidewright/source?deck=uist-2026')).json();
  const syncRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/__slidewright/source')) syncRequests.push(request.url());
  });
  await page.goto('/canvas.html?deck=plateau-demo');
  await expect(page.getByLabel('Deck', { exact: true })).toHaveValue('plateau-demo');
  await expect(page.getByRole('option', { name: /^Slide \d+$/ })).toHaveCount(20);
  await expect(page.locator('.sw-canvas-stage [data-sw-plateau-slide]')).toBeVisible();
  expect(await getEditorSource(page)).toBe(source);
  await expect(page.getByRole('button', { name: 'Reload from disk', exact: true })).toHaveCount(0);
  const edited = source.replace('PLATEAU 2026', 'Demo experiment');
  await setHostSource(page, edited);
  await page.reload();
  await expect.poll(() => getEditorSource(page)).toBe(edited);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('plateau-demo.sw');
  expect(await readFile((await download.path())!, 'utf8')).toBe(edited);
  expect(syncRequests).toEqual([]);

  await page.getByLabel('Deck', { exact: true }).selectOption('uist-2026');
  await expect(page.getByRole('status')).toHaveText('Saved to source file');
  expect(await getEditorSource(page)).toBe(working.source);
  await page.getByLabel('Deck', { exact: true }).selectOption('plateau-demo');
  await expect.poll(() => getEditorSource(page)).toBe(edited);
  expect(await readFile('decks/plateau-demo/deck.sw', 'utf8')).toBe(source);
});
