import { test, expect } from '@playwright/test';
import { getEditorSource } from './editor-helpers';

test('debugger stages preserve code, variables, output, rewind, and final autopsy view', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  await expect(demo).toBeVisible();
  const source = await getEditorSource(page);
  await expect(demo.getByRole('button', { name: 'Previous demo step' })).toBeDisabled();
  await expect(demo.getByLabel('Demo code')).toContainText('item.price *= 0.9');
  for (const stage of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '13', '14', '17', '20', '21']) {
    await demo.getByLabel('Demo stage').selectOption(stage);
    await expect(demo).toHaveAttribute('data-step', stage);
  }
  await expect(demo.locator('[data-demo-slice]')).toHaveCount(16);
  await expect(demo.getByRole('button', { name: 'Next demo step' })).toBeDisabled();
  await demo.getByRole('button', { name: 'Previous demo step' }).click();
  await expect(demo.locator('[data-demo-zigzag]')).toHaveCount(1);
  await demo.getByLabel('Demo stage').selectOption('10');
  await expect(demo.getByLabel('Demo variables')).toContainText('item.price');
  await expect(demo.locator('[data-demo-breakpoint]')).toHaveCount(1);
  await demo.getByLabel('Demo stage').selectOption('18');
  await expect(demo.getByLabel('Demo terminal')).toContainText('Price');
  await expect(demo.locator('[data-demo-dot]')).not.toHaveCount(0);
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await demo.getByRole('button', { name: 'Play demo' }).click();
  await expect.poll(() => demo.getAttribute('data-step')).not.toBe('0');
  await demo.getByRole('button', { name: 'Pause demo' }).click();
  await demo.getByLabel('Demo stage').selectOption('11');
  await demo.getByRole('button', { name: 'Play demo' }).click();
  await expect.poll(() => demo.getAttribute('data-frame')).not.toBe('0');
  await demo.getByRole('button', { name: 'Pause demo' }).click();
  const pausedFrame = await demo.getAttribute('data-frame');
  await page.waitForTimeout(450);
  expect(await demo.getAttribute('data-frame')).toBe(pausedFrame);
  expect(await getEditorSource(page)).toBe(source);
  for (const stage of ['0', '4', '10', '19', '21']) {
    await demo.getByLabel('Demo stage').selectOption(stage);
    if (stage === '19') await expect(demo.getByLabel('Demo terminal')).toContainText('Free');
    await page.waitForTimeout(700);
    await demo.screenshot({ path: test.info().outputPath(`stage-${stage}.png`) });
  }
});

test('opaque debugger moves and resizes through registered adapters', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  const code = page.locator('.sw-canvas-stage').getByLabel('Demo code');
  await expect(code).toBeVisible();
  const bounds = (await code.boundingBox())!;
  const canvas = (await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox())!;
  const scale = canvas.width / 1920;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(bounds.x + bounds.width / 2 + 40 * scale, bounds.y + bounds.height / 2 + 20 * scale, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toMatch(/x:\s*140\s+y:\s*100/);
  const handle = (await page.locator('.sw-resize-ne').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(handle.x + handle.width / 2 + 60 * scale, handle.y + handle.height / 2 - 30 * scale, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toMatch(/width:\s*1560\s+height:\s*730/);
});
