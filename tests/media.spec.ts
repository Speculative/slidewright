import { test, expect, type Page, type Locator } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

async function drag(page: Page, target: Locator, dx: number, dy: number) {
  const bounds = await target.boundingBox();
  const canvas = await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox();
  if (!bounds || !canvas) throw new Error('Missing canvas or media');
  const scale = canvas.width / 1920;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(x + dx * scale, y + dy * scale, { steps: 8 });
  await page.mouse.up();
}

test('image loads, moves, resizes, and retains its asset and styling', async ({ page }) => {
  await page.goto('/canvas.html?fixture=media');
  const image = page.locator('.sw-canvas-stage [data-sw-component="Image"] img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(160);
  await drag(page, image, 50, 30);
  let source = await getEditorSource(page);
  expect(source).toMatch(/Image\s*\{\s*x:\s*350\s+y:\s*230/);
  await drag(page, page.locator('.sw-resize-se'), 80, 45);
  source = await getEditorSource(page);
  expect(source).toMatch(/width:\s*480\s+height:\s*270/);
  expect(source).toContain('src: "/tests/fixtures/media.svg"');
  expect(source).toContain('alt: "Fixture logo"');
  expect(source).toContain('fit: "cover"');
  expect(source).toContain('radius: 20');
});

test('video controls play, pause, restart without editing source; body moves and resizes', async ({ page }) => {
  await page.goto('/canvas.html?fixture=media');
  const video = page.locator('.sw-canvas-stage video');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
  const original = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByRole('button', { name: 'Play Demo', exact: true }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0);
  await page.locator('.sw-canvas-stage').getByRole('button', { name: 'Pause Demo', exact: true }).click();
  expect(await video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await video.evaluate((node: HTMLVideoElement) => { node.currentTime = 0.9; });
  await page.locator('.sw-canvas-stage').getByRole('button', { name: 'Restart Demo', exact: true }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeLessThan(0.8);
  expect(await getEditorSource(page)).toBe(original);
  await drag(page, video, 60, 40);
  await drag(page, page.locator('.sw-resize-se'), 80, 45);
  const source = await getEditorSource(page);
  expect(source).toMatch(/Video\s*\{\s*x:\s*960\s+y:\s*240\s+width:\s*720\s+height:\s*405/);
  expect(source).toContain('src: "/tests/fixtures/media.webm"');
});

test('missing media stays selectable and bad video reports a playback error', async ({ page }) => {
  await page.goto('/canvas.html?fixture=media');
  const source = await getEditorSource(page);
  await setHostSource(page, source.replace('/tests/fixtures/media.svg', '').replace('/tests/fixtures/media.webm', '/missing-video.webm'));
  await expect(page.locator('.sw-canvas-stage').getByText('Set image source')).toBeVisible();
  await page.locator('.sw-canvas-stage').getByText('Set image source').click();
  await expect(page.locator('.sw-resize-se')).toBeVisible();
  await expect(page.locator('.sw-canvas-stage').getByRole('status')).toHaveText('Unable to load video');
});

test('inspector changes media source and fit through the DSL', async ({ page }) => {
  await page.goto('/canvas.html?fixture=media');
  await page.locator('.sw-canvas-stage [data-sw-component="Image"] > div').click();
  const fit = page.locator('.sw-property-row', { hasText: /^fit/ }).locator('input.sw-property-value');
  await fit.fill('"contain"');
  await fit.press('Enter');
  const src = page.locator('.sw-property-row', { hasText: /^src/ }).locator('input.sw-property-value');
  await src.fill('"/tests/fixtures/media.svg?updated"');
  await src.press('Enter');
  const image = page.locator('.sw-canvas-stage img');
  await expect(image).toHaveAttribute('src', '/tests/fixtures/media.svg?updated');
  await expect(image).toHaveCSS('object-fit', 'contain');
  expect(await getEditorSource(page)).toContain('src: "/tests/fixtures/media.svg?updated"');
});

for (const name of ['Image', 'Video']) {
  test(`toolbar draws an editable ${name} placeholder`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    await page.locator('.sw-tool', { hasText: new RegExp(`^${name}$`) }).click();
    const freeform = await page.locator('.sw-canvas-stage [data-sw-component="Freeform"] > div').boundingBox();
    const canvas = await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox();
    if (!freeform || !canvas) throw new Error('Missing drawing surface');
    const scale = canvas.width / 1920;
    await page.mouse.move(freeform.x + 300 * scale, freeform.y + 200 * scale);
    await page.mouse.down();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.move(freeform.x + 700 * scale, freeform.y + 425 * scale, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.sw-canvas-stage').getByText(`Set ${name.toLowerCase()} source`)).toBeVisible();
    expect(await getEditorSource(page)).toMatch(new RegExp(`${name}\\s*\\{\\s*x:\\s*300\\s+y:\\s*200\\s+width:\\s*400\\s+height:\\s*225\\s+src:\\s*""`));
  });
}
