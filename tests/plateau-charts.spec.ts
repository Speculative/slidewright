import { test, expect } from '@playwright/test';
import { getEditorSource } from './editor-helpers';

test('opaque chart controls preserve source while geometry drags and resize commit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-charts');
  const chart = page.locator('.sw-canvas-stage [data-sw-chart]');
  await expect(chart).toBeVisible();
  const before = await getEditorSource(page);
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(chart).toHaveAttribute('data-step', '1');
  await expect(chart.locator('[data-chart-dot]')).not.toHaveCount(0);
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(chart.locator('[data-chart-slice]')).toHaveCount(16);
  await chart.getByRole('button', { name: 'Previous step', exact: true }).click();
  await chart.getByRole('button', { name: 'Reset chart', exact: true }).click();
  expect(await getEditorSource(page)).toBe(before);
  const bounds = (await chart.locator('svg').boundingBox())!;
  const canvas = (await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox())!;
  const scale = canvas.width / 1920;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(bounds.x + bounds.width / 2 + 50 * scale, bounds.y + bounds.height / 2 + 30 * scale, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toMatch(/x:\s*350\s+y:\s*180/);
  const handle = (await page.locator('.sw-resize-ne').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(handle.x + handle.width / 2 + 80 * scale, handle.y + handle.height / 2 - 40 * scale, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toMatch(/width:\s*1280\s+height:\s*780/);
});

for (const [label, mode] of [['Streams', 'streams'], ['Stepping', 'stepping'], ['Computed', 'computed'], ['Filtering', 'filtering']]) {
  test(`${label} stages and playback work without source edits`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=plateau-charts');
    await page.getByRole('option', { name: `Slide ${['Streams', 'Stepping', 'Computed', 'Filtering'].indexOf(label!) + 2}`, exact: true }).click();
    const chart = page.locator(`.sw-canvas-stage [data-sw-chart="${mode}"]`);
    await expect(chart).toBeVisible();
    const before = await getEditorSource(page);
    await chart.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(chart).toHaveAttribute('data-step', '1');
    if (mode === 'computed') { await expect(chart.locator('[data-chart-total]')).toHaveCount(1); await chart.getByRole('button', { name: 'Next step', exact: true }).click(); await expect(chart.locator('[data-chart-total]')).not.toHaveCount(1); }
    if (mode === 'filtering') { await chart.getByRole('button', { name: 'Next step', exact: true }).click(); await expect(chart.locator('[data-included="false"]').first()).toHaveCSS('opacity', '0'); }
    await chart.getByRole('button', { name: 'Reset chart', exact: true }).click();
    await chart.getByRole('button', { name: 'Play chart', exact: true }).click();
    await expect.poll(() => chart.getAttribute('data-step')).not.toBe('0');
    await chart.getByRole('button', { name: /Pause chart|Play chart/ }).click();
    expect(await getEditorSource(page)).toBe(before);
  });
}
