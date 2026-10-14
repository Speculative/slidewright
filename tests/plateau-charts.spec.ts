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
    if (mode === 'streams') {
      expect(await chart.locator('[data-chart-stream]').last().evaluate(element => element.getAnimations()[0]!.effect!.getTiming().delay)).toBe(60);
      await expect(chart.locator('[data-chart-stream]').last()).toHaveCSS('opacity', '1');
    }
    if (mode === 'computed') { await expect(chart.locator('[data-chart-total]')).toHaveCount(1); await chart.getByRole('button', { name: 'Next step', exact: true }).click(); await expect(chart.locator('[data-chart-total]')).not.toHaveCount(1); }
    if (mode === 'filtering') { await chart.getByRole('button', { name: 'Next step', exact: true }).click(); await expect(chart.locator('[data-included="false"]').first()).toHaveCSS('opacity', '0'); }
    await chart.getByRole('button', { name: 'Reset chart', exact: true }).click();
    await chart.getByRole('button', { name: 'Play chart', exact: true }).click();
    await expect.poll(() => chart.getAttribute('data-step')).not.toBe('0');
    await chart.getByRole('button', { name: /Pause chart|Play chart/ }).click();
    expect(await getEditorSource(page)).toBe(before);
  });
}

test('collection builds stagger and replay while existing print dots stay visible', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-charts');
  const chart = page.locator('.sw-canvas-stage [data-sw-chart]');
  const before = await getEditorSource(page);
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  const reveal = await chart.locator('[data-chart-dot]').last().evaluate(element => {
    const animation = element.getAnimations()[0]!;
    animation.pause();
    const timing = animation.effect!.getTiming();
    animation.currentTime = Number(timing.delay) / 2;
    const before = getComputedStyle(element).opacity;
    animation.currentTime = Number(timing.delay) + Number(timing.duration) / 2;
    const during = Number(getComputedStyle(element).opacity);
    animation.finish();
    return { delay: timing.delay, before, during, after: getComputedStyle(element).opacity };
  });
  expect(reveal.delay).toBeGreaterThan(300);
  expect(reveal.before).toBe('0');
  expect(reveal.during).toBeGreaterThan(0);
  expect(reveal.during).toBeLessThan(1);
  expect(reveal.after).toBe('1');
  await expect(chart.locator('[data-chart-breakpoint]')).toHaveCSS('opacity', '0');
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(chart.locator('[data-chart-dot]').last()).toHaveCSS('opacity', '1');
  expect(await chart.locator('[data-chart-dot]').last().evaluate(element => element.getAnimations().length)).toBe(0);
  const slices = chart.locator('[data-chart-slice]');
  expect(await slices.last().evaluate(element => element.getAnimations()[0]!.effect!.getTiming().delay)).toBe(900);
  await expect(slices.last()).toHaveCSS('opacity', '1');
  await chart.getByRole('button', { name: 'Previous step', exact: true }).click();
  expect(await chart.locator('[data-chart-dot]').last().evaluate(element => element.getAnimations().length)).toBe(1);
  await chart.getByRole('button', { name: 'Reset chart', exact: true }).click();
  await expect(chart.locator('[data-chart-breakpoint]')).toHaveCSS('opacity', '1');
  expect(await getEditorSource(page)).toBe(before);
});

test('computed and filtering transitions retain authored geometry and correct connectors', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-charts');
  const before = await getEditorSource(page);
  await page.getByRole('option', { name: 'Slide 4', exact: true }).click();
  const chart = page.locator('.sw-canvas-stage [data-sw-chart]');
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  const arrow = chart.locator('[data-chart-total] line');
  const marker = await arrow.getAttribute('marker-end');
  expect(marker).toMatch(/^url\(#chart-arrow-/);
  expect(await chart.locator('marker').getAttribute('id')).toBe(marker!.slice(5, -1));
  await expect(chart.locator('[data-chart-price-highlight]')).toHaveCSS('opacity', '1');
  await expect(chart.locator('[data-chart-total] circle')).toHaveCSS('opacity', '1');
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(chart.locator('[data-chart-total] circle').last()).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/chart-computed-restored.png' });
  await page.getByRole('option', { name: 'Slide 5', exact: true }).click();
  const line = chart.locator('[data-chart-filter-line]');
  const originalStart = Number(await line.getAttribute('x1'));
  const originalEnd = Number(await line.getAttribute('x2'));
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(chart.locator('[data-chart-selection]').last()).toHaveCSS('opacity', '1');
  await chart.getByRole('button', { name: 'Next step', exact: true }).click();
  const discarded = chart.locator('[data-included="false"]').first();
  await expect(discarded).toHaveCSS('opacity', '0');
  expect(await discarded.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(0.3, 0, 0, 0.3, 0, 80)');
  const firstKept = chart.locator('[data-included="true"] circle').first();
  const lastKept = chart.locator('[data-included="true"] circle').last();
  expect(Number(await line.getAttribute('x1'))).toBe(Number(await firstKept.getAttribute('cx')));
  expect(Number(await line.getAttribute('x2'))).toBe(Number(await lastKept.getAttribute('cx')));
  expect(Number(await line.getAttribute('x1'))).toBeGreaterThanOrEqual(originalStart);
  expect(Number(await line.getAttribute('x2'))).toBeLessThanOrEqual(originalEnd);
  await chart.getByRole('button', { name: 'Reset chart', exact: true }).click();
  await expect(discarded).toHaveCSS('opacity', '1');
  await expect(discarded).toHaveCSS('transform', 'none');
  expect(await getEditorSource(page)).toBe(before);
});
