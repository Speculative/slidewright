import { test, expect } from '@playwright/test';
import { getEditorSource, selectRichText } from './editor-helpers';

test('all twenty PLATEAU slides render packaged assets and native/opaque objects', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/canvas.html?deck=plateau-demo');
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
    await slide.screenshot({ path: test.info().outputPath(`slide-${String(index + 1).padStart(2, '0')}.png`) });
  }
  expect(await getEditorSource(page)).toBe(source);
});

test('PLATEAU native heading edits and styling remain source backed', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau-demo');
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
  await page.goto('/canvas.html?deck=plateau-demo');
  const before = await getEditorSource(page);
  const title = page.locator('.sw-canvas-stage').getByText('autopsy', { exact: true });
  const box = title.locator('xpath=ancestor::*[@data-sw-component="TextBox"]').locator(':scope > div').first();
  await title.click();
  await expect(page.locator('.sw-hierarchy-node[data-sw-component="Group"]')).toHaveClass(/selected/);
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
  await page.goto('/canvas.html?deck=plateau-demo');
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
  await stage.screenshot({ path: test.info().outputPath('title-fitted.png') });
});

test('PLATEAU fonts load locally and panel borders match the original talk', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto('/canvas.html?deck=plateau-demo');
  await expect(page.locator('.sw-canvas-stage [data-sw-plateau-slide]')).toBeVisible();
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter(face => face.family.includes('Plateau')).map(face => ({ family: face.family, status: face.status }));
  });
  expect(fonts).toHaveLength(3);
  expect(fonts.every(face => face.status === 'loaded')).toBe(true);
  const author = page.locator('.sw-canvas-stage').getByText('Jeffrey Tao', { exact: true });
  await expect(author).toHaveCSS('color', 'rgb(0, 0, 255)');
  await expect(author).toHaveCSS('font-weight', '700');
  const mono = page.locator('.sw-canvas-stage [data-sw-textbox-content]').nth(1);
  await expect(mono).toHaveCSS('font-family', '"Plateau Monaspace Neon", monospace');
  await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"] > div')).toHaveCSS('border-top-width', '0px');
  await page.getByRole('option', { name: 'Slide 5', exact: true }).click();
  const panels = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div');
  await expect(panels.first()).toHaveCSS('border-top-color', 'rgb(253, 230, 138)');
  await expect(panels.last()).toHaveCSS('border-top-color', 'rgb(191, 219, 254)');
  await expect(panels.first()).toHaveCSS('border-radius', '18px');
  // The aliases do not redefine the host's font tokens.
  await page.getByLabel('Deck', { exact: true }).selectOption('reference');
  expect(await page.locator('.sw-canvas-stage .presentation-canvas').evaluate(node => getComputedStyle(node).getPropertyValue('--font-mono'))).not.toContain('Plateau');
});


test('autopsy introduction background contains the editable word frame', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau-demo');
  await page.getByRole('option', { name: 'Slide 8', exact: true }).click();
  const stage = page.locator('.sw-canvas-stage');
  const word = (await stage.locator('[data-sw-component="TextBox"] > div').first().boundingBox())!;
  const background = (await stage.locator('[data-sw-component="Box"] > div').first().boundingBox())!;
  expect(background.x).toBeLessThan(word.x);
  expect(background.y).toBeLessThanOrEqual(word.y);
  expect(background.x + background.width).toBeGreaterThan(word.x + word.width);
  expect(background.y + background.height + 0.01).toBeGreaterThanOrEqual(word.y + word.height);
});

for (const slideNumber of [1, 8]) {
  test(`slide ${slideNumber} autopsy group moves text and background together and keeps text editable`, async ({ page }) => {
    await page.goto('/canvas.html?deck=plateau-demo');
    await page.getByRole('option', { name: `Slide ${slideNumber}`, exact: true }).click();
    const stage = page.locator('.sw-canvas-stage');
    const group = stage.locator('[data-sw-component="Group"] > div');
    const word = group.locator('[data-sw-component="TextBox"] > div');
    const background = group.locator('[data-sw-component="Box"] > div');
    const source = await getEditorSource(page);
    const beforeWord = (await word.boundingBox())!;
    const beforeBackground = (await background.boundingBox())!;
    const scale = beforeWord.width / 550;
    // The first gesture selects and moves the group, preserving local offsets.
    const x = beforeWord.x + beforeWord.width / 2;
    const y = beforeWord.y + beforeWord.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100 * scale, y + 50 * scale, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => getEditorSource(page)).not.toBe(source);
    for (const [node, before] of [[word, beforeWord], [background, beforeBackground]] as const) {
      const after = (await node.boundingBox())!;
      expect(after.x - before.x).toBeCloseTo(100 * scale, 0);
      expect(after.y - before.y).toBeCloseTo(50 * scale, 0);
      expect(after.width).toBeCloseTo(before.width, 1);
      expect(after.height).toBeCloseTo(before.height, 1);
    }
    await page.keyboard.press('Control+z');
    await expect.poll(() => getEditorSource(page)).toBe(source);
    await word.getByText('autopsy', { exact: true }).dblclick();
    await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
    await selectRichText(page, 'autopsy', 0, 'autopsy', 7);
    await page.keyboard.type('autopsy!');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect.poll(() => getEditorSource(page)).toContain('"autopsy!"');
    await expect(group.locator('[data-sw-component="TextBox"]')).toHaveCount(1);
  });
}
