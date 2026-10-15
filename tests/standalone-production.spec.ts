import { test, expect } from '@playwright/test';
// This case runs only with playwright.production.config.ts against dist/.
test('production canvas loads all packaged PLATEAU media and saves a reloadable draft', async ({ page }) => {
  test.skip(!test.info().config.configFile?.endsWith('playwright.production.config.ts'), 'Production build check has its own server/config.');
  const failures: string[] = [];
  page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) failures.push(response.url()); });
  await page.goto('/canvas.html?deck=plateau-demo');
  await expect(page.getByRole('option', { name: /^Slide \d+$/ })).toHaveCount(20);
  for (const number of [1, 9, 10, 12, 14, 16, 18]) {
    await page.getByRole('option', { name: `Slide ${number}`, exact: true }).click();
    const slide = page.locator('.sw-canvas-stage [data-sw-plateau-slide]');
    for (const image of await slide.locator('img').all()) await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    for (const video of await slide.locator('video').all()) {
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
      expect(await video.getAttribute('src')).toContain('/assets/');
    }
  }
  await page.getByRole('option', { name: 'Slide 3', exact: true }).click();
  await expect(page.locator('.sw-canvas-stage [data-sw-debugger] .token.keyword').first()).toHaveCSS('color', 'rgb(215, 58, 73)');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter(face => face.family.includes('Plateau')).map(face => face.status);
  });
  expect(fonts.every(status => status === 'loaded')).toBe(true);
  expect(fonts).toHaveLength(3);
  expect(failures).toEqual([]);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('option', { name: /^Slide \d+$/ })).toHaveCount(20);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Presenter view', exact: true }).click();
  const presenter = await popupPromise;
  await expect(presenter.getByLabel('Speaker notes')).toBeInViewport();
  for (const preview of await presenter.locator('.sw-presenter-previews > div').all()) expect((await preview.boundingBox())!.width).toBeLessThan(650);
});
