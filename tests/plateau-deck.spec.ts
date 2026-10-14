import { test, expect } from '@playwright/test';
import { getEditorSource, selectRichText } from './editor-helpers';

test('all twenty PLATEAU slides render packaged assets and native/opaque objects', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/canvas.html?deck=plateau');
  await expect(page.getByRole('option', { name: /^Slide \d+$/ })).toHaveCount(20);
  const source = await getEditorSource(page);
  for (let index = 0; index < 20; index++) {
    await page.getByRole('option', { name: `Slide ${index + 1}`, exact: true }).click();
    const slide = page.locator('.sw-canvas-stage [data-sw-plateau-slide]');
    await expect(slide).toBeVisible();
    await expect(slide.locator('[data-sw-component="TextBox"]')).not.toHaveCount(0);
    for (const image of await slide.locator('img').all()) await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    for (const video of await slide.locator('video').all()) await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
    if (index === 2) await expect(slide.locator('[data-sw-debugger]')).toBeVisible();
    if ([6, 10, 12, 14, 16].includes(index)) await expect(slide.locator('[data-sw-chart]')).toBeVisible();
    await page.locator('.sw-tool-palette').evaluate(node => { (node as HTMLElement).style.visibility = 'hidden'; });
    await slide.screenshot({ path: test.info().outputPath(`slide-${String(index + 1).padStart(2, '0')}.png`) });
  }
  await page.locator('.sw-tool-palette').evaluate(node => { (node as HTMLElement).style.visibility = ''; });
  expect(await getEditorSource(page)).toBe(source);
});

test('PLATEAU native heading edits and styling remain source backed', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau');
  const heading = page.locator('.sw-canvas-stage').getByText('Data-oriented Debugging with', { exact: true });
  await heading.dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await selectRichText(page, 'Data-oriented Debugging with', 0, 'Data-oriented Debugging with', 28);
  await page.keyboard.type('UIST conference talk');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('UIST conference talk');
  await page.locator('.sw-canvas-stage').getByText('UIST conference talk', { exact: true }).click();
  await page.getByLabel('TextBox setting', { exact: true }).selectOption('fontSize');
  await page.getByLabel('TextBox setting value', { exact: true }).fill('90');
  await page.getByRole('button', { name: 'Apply box setting', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('fontSize: 90');
});

test('title word keeps authored box bounds on repeated clicks and still enters text editing', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau');
  const before = await getEditorSource(page);
  const title = page.locator('.sw-canvas-stage').getByText('autopsy', { exact: true });
  const box = title.locator('xpath=ancestor::*[@data-sw-component="TextBox"]').locator(':scope > div').first();
  for (let index = 0; index < 3; index++) {
    await title.click();
    await expect(page.locator('.sw-canvas-stage .sw-resize-ne')).toHaveCount(1);
    await expect(page.locator('.sw-canvas-stage .sw-selection-slot')).toHaveCount(0);
    const outline = (await page.locator('.sw-canvas-stage .sw-selection-outline').boundingBox())!;
    const bounds = (await box.boundingBox())!;
    // Selection outlines deliberately expand four design pixels per edge.
    const scale = bounds.width / 550;
    expect(Math.abs(outline.width - (bounds.width + 8 * scale))).toBeLessThan(1);
    expect(Math.abs(outline.height - (bounds.height + 8 * scale))).toBeLessThan(1);
    expect(Math.abs(outline.x - (bounds.x - 4 * scale))).toBeLessThan(1);
    expect(Math.abs(outline.y - (bounds.y - 4 * scale))).toBeLessThan(1);
  }
  await title.dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await getEditorSource(page)).toBe(before);
});

test('title text fits its authored frames and the blue background contains the word frame', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau');
  const stage = page.locator('.sw-canvas-stage');
  const contents = stage.locator('[data-sw-textbox-content]');
  await expect(contents).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  for (const content of [contents.nth(0), contents.nth(1)]) {
    const fit = await content.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, width: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.height);
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.width);
  }
  const word = (await stage.locator('[data-sw-component="TextBox"] > div').nth(1).boundingBox())!;
  const background = (await stage.locator('[data-sw-component="Box"] > div').boundingBox())!;
  expect(background.x).toBeLessThan(word.x);
  expect(background.y).toBeLessThan(word.y);
  expect(background.x + background.width).toBeGreaterThan(word.x + word.width);
  expect(background.y + background.height).toBeGreaterThan(word.y + word.height);
  await page.locator('.sw-tool-palette').evaluate(node => { (node as HTMLElement).style.visibility = 'hidden'; });
  await stage.screenshot({ path: test.info().outputPath('title-fitted.png') });
});
