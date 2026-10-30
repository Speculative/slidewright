import { test, expect } from '@playwright/test';
import { getEditorSource } from './editor-helpers';

test('audience clicks and both windows navigate shared builds before slides', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-charts');
  const source = await getEditorSource(page);
  const chart = page.locator('.sw-canvas-stage [data-sw-chart]');
  // Presentation always starts at the first build, even after editor playback.
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Presenter view', exact: true }).click();
  const presenter = await popupPromise;
  const current = presenter.locator('.sw-presenter-previews > div').first().locator('[data-sw-chart]');
  const next = presenter.locator('.sw-presenter-previews > div').nth(1).locator('[data-sw-chart]');
  await expect(chart).toHaveAttribute('data-step', '0');
  await expect(chart.getByRole('group', { name: 'Chart playback' })).toHaveCount(0);
  await expect(presenter.getByRole('group', { name: 'Chart playback' })).toHaveCount(0);
  // A click on SVG content advances once without selecting or moving the shape.
  await chart.locator('svg').click({ position: { x: 100, y: 80 } });
  await expect(chart).toHaveAttribute('data-step', '1');
  await expect(current).toHaveAttribute('data-step', '1');
  await expect(next).toHaveAttribute('data-step', '0');
  await presenter.locator('h1').click();
  await presenter.keyboard.press('ArrowRight');
  await expect(chart).toHaveAttribute('data-step', '2');
  await expect(current).toHaveAttribute('data-step', '2');
  await presenter.keyboard.press('ArrowLeft');
  await expect(chart).toHaveAttribute('data-step', '1');
  await presenter.keyboard.press('r');
  await expect(chart).toHaveAttribute('data-step', '0');
  // Blank slide content is a forward target too; right click does nothing.
  const canvas = page.locator('.sw-canvas-stage .presentation-canvas');
  await canvas.click({ position: { x: 10, y: 10 }, button: 'right' });
  await expect(chart).toHaveAttribute('data-step', '0');
  await canvas.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(chart).toHaveAttribute('data-sw-chart', 'streams');
  await expect(chart).toHaveAttribute('data-step', '0');
  await expect(presenter.getByLabel('Presenter slide')).toContainText('Slide 2 of 5');
  await page.keyboard.press('ArrowLeft');
  await expect(chart).toHaveAttribute('data-sw-chart', 'collection');
  await expect(chart).toHaveAttribute('data-step', '0');
  await page.keyboard.press('ArrowLeft');
  await expect(presenter.getByLabel('Presenter slide')).toContainText('Slide 1 of 5');
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await canvas.click({ position: { x: 10, y: 10 } });
  await expect(chart).toHaveAttribute('data-step', '1');
  await page.evaluate(() => document.exitFullscreen());
  await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
  await expect(chart.getByRole('group', { name: 'Chart playback' })).toBeVisible();
  expect(await getEditorSource(page)).toBe(source);
});

for (const [fixture, selector] of [
  ['print-debugger', '[data-sw-print-debugger]'],
  ['breakpoint-debugger', '[data-sw-breakpoint-debugger]'],
  ['stepping-debugger', '[data-sw-breakpoint-debugger]'],
  ['plateau-debugger', '[data-sw-debugger]'],
]) {
  test(`${fixture} waits for presenter input while intra-build animation runs`, async ({ page }) => {
    await page.goto(`/canvas.html?fixture=${fixture}`);
    const source = await getEditorSource(page);
    const demo = page.locator(`.sw-canvas-stage ${selector}`);
    // Starting editor autoplay must not carry automatic stage progression into presentation.
    await demo.getByRole('button', { name: 'Play demo', exact: true }).click();
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await expect(demo.getByRole('group', { name: 'Demo playback' })).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(demo).toHaveAttribute('data-step', '1');
    if (fixture === 'stepping-debugger') {
      await expect(demo).toHaveAttribute('data-animating', 'true');
      await expect(demo).toHaveAttribute('data-animating', 'false');
    }
    await page.waitForTimeout(2000);
    await expect(demo).toHaveAttribute('data-step', '1');
    await page.keyboard.press('ArrowLeft');
    await expect(demo).toHaveAttribute('data-step', '0');
    await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
    expect(await getEditorSource(page)).toBe(source);
  });
}

test('static slides advance immediately and multiple visuals clamp at their own final stage', async ({ page }) => {
  await page.goto('/canvas.html?fixture=presentation-builds');
  const source = await getEditorSource(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  const canvas = page.locator('.sw-canvas-stage .presentation-canvas');
  await page.getByRole('button', { name: 'Play Demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause Demo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restart Demo', exact: true }).click();
  await page.getByRole('button', { name: 'Pause Demo', exact: true }).click();
  await canvas.click({ position: { x: 10, y: 10 } });
  const charts = page.locator('.sw-canvas-stage [data-sw-chart]');
  await expect(charts).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(charts.nth(0)).toHaveAttribute('data-step', '1');
  await expect(charts.nth(1)).toHaveAttribute('data-step', '1');
  await page.keyboard.press('ArrowRight');
  await expect(charts.nth(0)).toHaveAttribute('data-step', '2');
  await expect(charts.nth(1)).toHaveAttribute('data-step', '1');
  await page.keyboard.press('ArrowRight');
  await expect(charts.nth(0)).toHaveAttribute('data-step', '2');
  await page.keyboard.press('ArrowLeft');
  await expect(charts.nth(0)).toHaveAttribute('data-step', '1');
  await expect(charts.nth(1)).toHaveAttribute('data-step', '1');
  await page.keyboard.press('r');
  await expect(charts.nth(0)).toHaveAttribute('data-step', '0');
  await expect(charts.nth(1)).toHaveAttribute('data-step', '0');
  await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
  expect(await getEditorSource(page)).toBe(source);
});
