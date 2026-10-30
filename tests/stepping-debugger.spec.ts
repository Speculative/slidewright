import { test, expect } from '@playwright/test';
import { execution } from '../decks/uist-2026/chart-data';
import { getEditorSource } from './editor-helpers';

test('stepping continues the breakpoint view, executes the discount, and advances two positions and reverses three', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto('/canvas.html?fixture=breakpoint-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-breakpoint-debugger]');
  await demo.getByLabel('Demo stage').selectOption('2');
  await page.waitForTimeout(600);
  const baselineCode = await demo.getByLabel('Demo code').boundingBox();
  const baselineInspector = await demo.getByLabel('Demo variables').boundingBox();
  const baselineValues = await demo.locator('[data-demo-variable-value]').allTextContents();

  await page.goto('/canvas.html?fixture=stepping-debugger');
  await expect(demo).toHaveAttribute('data-mode', 'stepping');
  const source = await getEditorSource(page);
  const code = demo.getByLabel('Demo code');
  const inspector = demo.getByLabel('Demo variables');
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '2');
  await expect(inspector.locator('[data-demo-variable-value]')).toHaveText(baselineValues);
  expect(await code.boundingBox()).toEqual(baselineCode);
  expect(await inspector.boundingBox()).toEqual(baselineInspector);
  const hit = execution.traces.base.find(trace => trace.path.includes(2))!;
  const discounted = hit.snapshots[hit.path.indexOf(2)]!;
  expect(discounted['item.price']).not.toBe(baselineValues[3]);

  await demo.getByRole('button', { name: 'Next demo step' }).click();
  await expect(inspector.locator('strong')).toHaveText('Stepped forward ×2');
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '3');
  await expect(inspector.locator('[data-demo-variable-value]')).toHaveText([...Object.values(discounted), 'False']);
  // Check the highlight actually travels through intermediate positions.
  const highlight = code.locator('[data-demo-line-highlight]');
  const motion = await highlight.evaluate(element => ({
    y: new DOMMatrixReadOnly(getComputedStyle(element).transform).m42,
    localHeight: (element as HTMLElement).offsetHeight,
  }));
  expect(motion.y).toBeGreaterThanOrEqual(motion.localHeight * 2 - 1);
  expect(motion.y).toBeLessThan(motion.localHeight * 3);
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '4');
  await expect(demo).toHaveAttribute('data-animating', 'false');
  await expect(inspector.locator('strong')).toHaveText('Stepped forward ×2');
  await expect(inspector.locator('[data-demo-variable-value]')).toHaveText([...Object.values(discounted), 'False']);
  await page.waitForTimeout(400);
  await demo.screenshot({ path: test.info().outputPath('step-forward.png') });
  await demo.getByRole('button', { name: 'Next demo step' }).click();
  await expect(demo).toHaveAttribute('data-animating', 'true');
  await expect(inspector.locator('strong')).toHaveText('Stepped backward ×3');
  // The rewind visits the ellipsis and breakpoint before the quantity check.
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '3');
  await expect(inspector.locator('[data-demo-variable-value]')).toHaveText([...Object.values(discounted), 'False']);
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '2');
  await expect(inspector.locator('[data-demo-variable-value]')).toHaveText(baselineValues);
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '1');
  await expect(demo).toHaveAttribute('data-animating', 'false');
  await expect(inspector.locator('[data-demo-variable-value]')).toHaveText(baselineValues);
  await expect(demo.getByRole('button', { name: 'Next demo step' })).toBeDisabled();
  expect(await code.boundingBox()).toEqual(baselineCode);
  expect(await inspector.boundingBox()).toEqual(baselineInspector);
  await expect(code.locator('[data-demo-code-line="2"] [data-demo-breakpoint-marker]')).toHaveText('●');
  for (const panel of [code, inspector]) {
    expect(await panel.evaluate(element => ({ horizontal: element.scrollWidth <= element.clientWidth, vertical: element.scrollHeight <= element.clientHeight }))).toEqual({ horizontal: true, vertical: true });
  }
  await demo.screenshot({ path: test.info().outputPath('step-backward.png') });
  await demo.getByRole('button', { name: 'Previous demo step' }).click();
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '4');
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '2');
  await demo.getByRole('button', { name: 'Play demo' }).click();
  await expect(demo).toHaveAttribute('data-step', '2');
  await expect(demo).toHaveAttribute('data-animating', 'false');
  await expect(inspector.locator('[data-demo-variable-value]')).toHaveText(baselineValues);
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await demo.getByLabel('Demo stage').selectOption('2');
  await expect(demo).toHaveAttribute('data-animating', 'true');
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await page.waitForTimeout(700);
  await expect(code.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '2');
  await expect(demo).toHaveAttribute('data-animating', 'false');
  expect(await getEditorSource(page)).toBe(source);
});
