import { test, expect } from '@playwright/test';
import { execution } from '../decks/uist-2026/chart-data';
import { getEditorSource } from './editor-helpers';

test('breakpoint build pauses before the discount and rewinds without source edits', async ({ page }) => {
  await page.goto('/canvas.html?fixture=breakpoint-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-breakpoint-debugger]');
  await expect(demo).toBeVisible();
  const source = await getEditorSource(page);
  const code = demo.getByLabel('Demo code');
  const inspector = demo.getByLabel('Demo variables');
  await expect(code).toContainText('item.price *= 0.9');
  await expect(demo.locator('[data-demo-breakpoint-marker]')).toHaveCount(0);
  await expect(inspector).toHaveCount(0);
  const discountToken = code.locator('[data-demo-code-line="2"] > span').last();
  const initialTokenBounds = await discountToken.boundingBox();
  await demo.getByRole('button', { name: 'Next demo step' }).click();
  await expect(code.locator('[data-demo-code-line="2"] [data-demo-breakpoint-marker]')).toHaveText('●');
  expect(await discountToken.boundingBox()).toEqual(initialTokenBounds);
  await expect(code.locator('[data-demo-paused-line]')).toHaveCount(0);
  await expect(inspector).toHaveCount(0);
  await demo.getByRole('button', { name: 'Next demo step' }).click();
  await expect(inspector).toBeVisible();
  await expect(code.locator('[data-demo-paused-line]')).toContainText('item.price *= 0.9');
  const hit = execution.traces.base.find(trace => trace.path.includes(2))!;
  const before = hit.snapshots[hit.path.indexOf(2) - 1]!;
  await expect(inspector.locator('[data-demo-variable-value]')).toHaveText([...Object.values(before), 'False']);
  await page.waitForTimeout(600);
  for (const panel of [code, inspector]) {
    expect(await panel.evaluate(element => ({ horizontal: element.scrollWidth <= element.clientWidth, vertical: element.scrollHeight <= element.clientHeight }))).toEqual({ horizontal: true, vertical: true });
  }
  await demo.screenshot({ path: test.info().outputPath('paused-inspector.png') });
  await expect(demo.getByRole('button', { name: 'Next demo step' })).toBeDisabled();
  await demo.getByRole('button', { name: 'Previous demo step' }).click();
  await expect(inspector).toHaveCount(0);
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await expect(code.locator('[data-demo-breakpoint-marker]')).toHaveCount(0);
  await demo.getByRole('button', { name: 'Play demo' }).click();
  await expect(demo).toHaveAttribute('data-step', '2');
  expect(await getEditorSource(page)).toBe(source);
});
