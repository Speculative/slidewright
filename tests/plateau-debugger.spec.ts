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

test('debugger morphs, axis fades and staggered builds follow original visual stages', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  const before = await getEditorSource(page);
  const chart = demo.locator('[data-demo-chart]');
  const stage = demo.getByLabel('Demo stage');
  await expect(chart).toHaveCSS('opacity', '0');
  await stage.selectOption('1');
  const morph = await chart.evaluate(element => {
    const animation = element.getAnimations().find(value => (value as CSSTransition).transitionProperty === 'width')!;
    animation.pause();
    animation.currentTime = 350;
    const midway = element.getBoundingClientRect().width;
    animation.finish();
    return { duration: animation.effect!.getTiming().duration, midway, end: element.getBoundingClientRect().width };
  });
  expect(morph.duration).toBe(700);
  expect(morph.midway).toBeGreaterThan(0);
  expect(morph.midway).toBeLessThan(morph.end);
  await stage.selectOption('2');
  await expect(demo.locator('[data-demo-axes]')).toHaveCSS('opacity', '0.15');
  await expect(demo.locator('[data-demo-time-label]')).toHaveCSS('opacity', '0.15');
  await stage.selectOption('4');
  const labelMotion = await demo.locator('[data-demo-variable-label]').first().evaluate(element => {
    const animation = element.getAnimations().find(value => (value as CSSTransition).transitionProperty === 'transform')!;
    animation.pause();
    animation.currentTime = 250;
    const midway = getComputedStyle(element).transform;
    animation.finish();
    return { duration: animation.effect!.getTiming().duration, midway, end: getComputedStyle(element).transform };
  });
  expect(labelMotion.duration).toBe(500);
  expect(labelMotion.midway).not.toBe(labelMotion.end);
  await expect(demo.locator('[data-demo-variable-label]').first()).toHaveCSS('opacity', '1');
  await stage.selectOption('5');
  await expect(demo.locator('[data-demo-variable-label]').first()).toHaveCSS('opacity', '0');
  await expect(demo.locator('[data-demo-axes]')).toHaveCSS('opacity', '1');
  await stage.selectOption('20');
  await expect(demo.locator('[data-demo-row]')).toHaveCount(0);
  const dots = demo.locator('[data-demo-dot]');
  await expect(dots).not.toHaveCount(0);
  expect(await dots.last().evaluate(element => element.getAnimations()[0]!.effect!.getTiming().delay)).toBeGreaterThan(300);
  await expect(dots.last()).toHaveCSS('opacity', '1');
  await stage.selectOption('21');
  const slices = demo.locator('[data-demo-slice]');
  expect(await slices.last().evaluate(element => element.getAnimations()[0]!.effect!.getTiming().delay)).toBe(900);
  await expect(slices.last()).toHaveCSS('opacity', '1');
  await stage.selectOption('20');
  await expect(slices).toHaveCount(0);
  expect(await dots.last().evaluate(element => element.getAnimations().length)).toBe(1);
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await expect(chart).toHaveCSS('opacity', '0');
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(0);
  expect(await getEditorSource(page)).toBe(before);
});
