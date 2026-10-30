import { test, expect } from '@playwright/test';
import { execution } from '../decks/uist-2026/chart-data';
import { getEditorSource, setHostSource } from './editor-helpers';

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

test('axis explanations highlight expressions and technique captions follow stage boundaries', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  const source = await getEditorSource(page);
  const stage = demo.getByLabel('Demo stage');
  const caption = demo.getByLabel('Debugging technique');
  await expect(caption).toHaveCount(0);
  await stage.selectOption('3');
  const state = demo.locator('[data-demo-annotation="state-vars"]');
  await expect(state).toHaveText(['item', 'cart', 'item.qty', 'item.price', 'item.total()', 'item.free_shipping']);
  await expect(state.first()).toHaveCSS('background-color', 'rgb(254, 240, 138)');
  await expect.poll(() => demo.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  await demo.screenshot({ path: test.info().outputPath('state-expressions.png') });
  await stage.selectOption('7');
  const cost = demo.locator('[data-demo-annotation="cost"]');
  await expect(cost).toHaveText(['item.price', 'item.total()']);
  await expect(state).toHaveCount(0);
  await expect(cost.first()).toHaveCSS('background-color', 'rgb(254, 240, 138)');
  await stage.selectOption('10');
  await expect(demo.locator('[data-demo-annotation]')).toHaveCount(0);
  await expect(caption).toContainText('breakpoint debugger');
  await expect(caption).toContainText('all state · one moment');
  const bounds = (await caption.boundingBox())!;
  const owner = (await demo.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(owner.x);
  expect(bounds.x + bounds.width).toBeLessThan(owner.x + owner.width);
  await expect.poll(() => demo.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  await demo.screenshot({ path: test.info().outputPath('technique-caption.png') });
  await stage.selectOption('13');
  await expect(caption).toContainText('print debugging');
  await expect(caption).toContainText('some state · many moments');
  await stage.selectOption('21');
  await expect(caption).toHaveCount(0);
  await stage.selectOption('10');
  await expect(caption).toContainText('all state · one moment');
  expect(await getEditorSource(page)).toBe(source);
});


test('axis explanations center over the full chart and retain original cost rows when resized', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  const source = await getEditorSource(page);
  const stage = demo.getByLabel('Demo stage');
  const settle = () => expect.poll(() => demo.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  async function checkGeometry() {
    await settle();
    const owner = (await demo.boundingBox())!;
    const chart = (await demo.locator('[data-demo-chart]').boundingBox())!;
    const panel = (await demo.locator('[data-demo-explanation]').boundingBox())!;
    expect(chart.width).toBeCloseTo(owner.width, 0);
    expect(panel.width).toBeCloseTo(owner.width * .75, 0);
    expect(panel.x + panel.width / 2).toBeCloseTo(owner.x + owner.width / 2, 0);
    const fit = await demo.getByLabel('Demo code').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.width + 1);
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.height + 1);
  }
  await stage.selectOption('3');
  await checkGeometry();
  expect(await demo.getByLabel('Demo code').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(30);
  await stage.selectOption('7');
  await checkGeometry();
  const rows = demo.locator('[data-demo-cost-row]');
  await expect(rows).toHaveText(execution.terminalLines.map(([label, value]) => `${label} ${value}`));
  await expect(demo.locator('[data-demo-cost-value]').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  const code = (await demo.getByLabel('Demo code').boundingBox())!;
  const terminal = (await demo.getByLabel('Demo terminal').boundingBox())!;
  expect(terminal.x).toBeGreaterThanOrEqual(code.x + code.width);
  await demo.screenshot({ path: test.info().outputPath('centered-cost-explanation.png') });
  expect(await getEditorSource(page)).toBe(source);
  await setHostSource(page, source.replace('width: 1500 height: 700', 'width: 1100 height: 600'));
  await stage.selectOption('7');
  await checkGeometry();
  await expect(rows).toHaveText(execution.terminalLines.map(([label, value]) => `${label} ${value}`));
  await stage.selectOption('10');
  await expect(demo.locator('[data-demo-explanation]')).toHaveCount(0);
  await stage.selectOption('3');
  await checkGeometry();
});

test('variables and execution use original palette and introduced print lines flash briefly', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  const source = await getEditorSource(page);
  const stage = demo.getByLabel('Demo stage');
  await stage.selectOption('10');
  await expect(demo.getByLabel('Demo variables')).toHaveCSS('background-color', 'rgb(17, 24, 39)');
  await expect(demo.locator('[data-demo-variable-value]').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(demo.locator('[data-demo-code-line="2"]')).toHaveCSS('background-color', 'rgb(254, 240, 138)');
  await stage.selectOption('14');
  const accent = demo.locator('[data-demo-print-accent]');
  await expect(accent).toHaveCount(1);
  const flash = await accent.evaluate(element => {
    const animation = element.getAnimations()[0]!;
    animation.pause();
    animation.currentTime = 400;
    const during = getComputedStyle(element).backgroundColor;
    animation.finish();
    return { duration: animation.effect!.getTiming().duration, during, after: getComputedStyle(element).backgroundColor };
  });
  expect(flash).toEqual({ duration: 800, during: 'rgb(254, 240, 138)', after: 'rgba(0, 0, 0, 0)' });
  await stage.selectOption('17');
  await expect(accent).toHaveCount(2);
  expect(await accent.first().evaluate(element => element.getAnimations().length)).toBe(1);
  await expect(accent.first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await stage.selectOption('13');
  await expect(accent).toHaveCount(0);
  expect(await getEditorSource(page)).toBe(source);
});

test('opening code uses original syntax palette without altering program text or later scenes', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  const source = await getEditorSource(page);
  const code = demo.getByLabel('Demo code');
  await expect(code.locator('.token.keyword').first()).toHaveCSS('color', 'rgb(215, 58, 73)');
  await expect(code.locator('.token.number').first()).toHaveCSS('color', 'rgb(0, 92, 197)');
  expect(await code.locator('[data-demo-code-line]').allTextContents()).toEqual(execution.codeVariants.base.lines.map((line, index) => `${index + 1} ${line}`));
  await demo.screenshot({ path: test.info().outputPath('opening-syntax.png') });
  await demo.getByLabel('Demo stage').selectOption('10');
  await expect(code.locator('.token')).toHaveCount(0);
  await expect(code).toContainText('item.price *= 0.9');
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await expect(code.locator('.token.keyword').first()).toHaveCSS('color', 'rgb(215, 58, 73)');
  expect(await getEditorSource(page)).toBe(source);
});

test('Place & Time uses Place labels and ends at the print zigzag', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  const original = await getEditorSource(page);
  await setHostSource(page, original.replace('DebuggerDemo {', 'DebuggerDemo { mode: "place-time"'));
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  await expect(demo.getByLabel('Demo stage').locator('option')).toHaveCount(21);
  await expect(demo.getByLabel('Demo stage')).not.toContainText('autopsy');
  for (const step of ['1', '2', '3', '4', '5', '10', '20']) {
    await demo.getByLabel('Demo stage').selectOption(step);
    await expect(demo.locator('[data-demo-state-label]')).toHaveText('Place');
    await expect(demo.locator('[data-demo-chart]')).toHaveAttribute('aria-label', 'Place over Time');
    await expect(demo.locator('[data-demo-time-label]')).toHaveText('Time');
    await expect(demo).not.toContainText(/state/i);
  }
  for (let step = 10; step <= 20; step++) {
    await demo.getByLabel('Demo stage').selectOption(String(step));
    const annotation = demo.getByLabel('Debugging technique');
    await expect(annotation).toContainText(step <= 12 ? 'Across Place · Point in Time' : 'some Place · Across Time');
    // Both annotation lines must clear the chart's plotting rectangle.
    await expect.poll(async () => {
      const label = (await annotation.boundingBox())!;
      const plot = (await demo.locator('[data-demo-chart] > rect').first().boundingBox())!;
      return label.y + label.height <= plot.y;
    }).toBe(true);
  }
  await expect(demo.locator('[data-demo-zigzag]')).toHaveCount(1);
  await expect(demo.locator('[data-demo-slice]')).toHaveCount(0);
  await expect(demo.getByRole('button', { name: 'Next demo step' })).toBeDisabled();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  for (let step = 1; step <= 20; step++) await page.keyboard.press('ArrowRight');
  await expect(demo).toHaveAttribute('data-step', '20');
  await page.keyboard.press('ArrowRight');
  await expect(demo).toHaveAttribute('data-step', '20');
  await expect(demo.locator('[data-demo-slice]')).toHaveCount(0);
});
