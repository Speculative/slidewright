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

test('calculator Place-Time introduction follows slide 3 through ten stages', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const { loadDeck } = await import('../slidewright/runtime/loader');
  const { components } = await import('../decks/uist-2026/registry');
  const source = readFileSync('decks/uist-2026/deck.sw', 'utf8');
  const assets = ['plateauHeadshot', 'plateauPennHci', 'plateauStackTrace', 'plateauConsole', 'plateauPandas', 'plateauStreams', 'plateauStepping', 'plateauComputed', 'plateauFiltering'];
  const deck = loadDeck({ source, components, scope: { bindings: Object.fromEntries(assets.map(name => [name, `${name}.png`])) } });
  expect(deck.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  const labels = deck.slidesData.filter(slide => slide.buildIndex === 0).map(slide => slide.comp.fills.find(fill => fill.name === 'label')?.value);
  expect(labels[2]).toMatchObject({ kind: 'string', value: 'Example — evaluate' });
  expect(labels[3]).toMatchObject({ kind: 'string', value: 'Place & Time — Calculator' });

  await page.goto('/canvas.html?fixture=plateau-debugger');
  await setHostSource(page, (await getEditorSource(page)).replace('DebuggerDemo {', 'DebuggerDemo { mode: "calculator-place-time"'));
  const demo = page.locator('.sw-canvas-stage [data-sw-debugger]');
  const stage = demo.getByLabel('Demo stage');
  await expect(stage.locator('option')).toHaveCount(10);
  await expect(demo.getByLabel('Demo code')).toContainText('case "^": result = left * right');
  for (let step = 0; step < 10; step++) {
    await stage.selectOption(String(step));
    await expect(demo).toHaveAttribute('data-step', String(step));
  }
  await expect(demo.getByRole('button', { name: 'Next demo step' })).toBeDisabled();
  await expect(demo.locator('[data-demo-state-label]')).toHaveText('Place');
  await expect(demo.locator('[data-demo-time-label]')).toHaveText('Time');
  await stage.selectOption('3');
  const annotations = demo.locator('[data-demo-annotation="state-vars"]');
  expect(await annotations.allTextContents()).toEqual(expect.arrayContaining(['node', 'node.value', 'node.left', 'node.right', 'left', 'right', 'node.op', 'result']));
  await stage.selectOption('4');
  await expect(demo.locator('[data-demo-variable-label]')).toHaveText(['node', 'node.value', 'node.left', 'node.right', 'left', 'right', 'node.op', 'result']);
  await stage.selectOption('7');
  await expect(demo.getByLabel('Demo code')).toContainText('print(node.op)');
  await expect(demo.locator('[data-demo-annotation="cost"]')).toHaveText(['node.op', 'node.op']);
  await expect(demo.locator('[data-demo-cost-row]')).toHaveText(['>>> calculate("2 + 3 * 4 ^ 2") ', '^ ', '* ', '+ ', ' 26']);
  // After transitions settle, neither card should need a scrollbar.
  await expect.poll(() => demo.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  for (const name of ['Demo code', 'Demo terminal']) {
    expect(await demo.getByLabel(name).evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  }
  await demo.screenshot({ path: test.info().outputPath('calculator-time.png') });
  await stage.selectOption('8');
  await expect(demo.locator('[data-demo-cost-label]')).toHaveText(['^', '*', '+']);
  await stage.selectOption('3');
  await expect(demo.getByLabel('Demo code')).not.toContainText('print(node.op)');
});

test('calculator print slide animates three operations with synchronized output and Place-Time points', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const { loadDeck } = await import('../slidewright/runtime/loader');
  const { components } = await import('../decks/uist-2026/registry');
  const source = readFileSync('decks/uist-2026/deck.sw', 'utf8');
  const assets = ['plateauHeadshot', 'plateauPennHci', 'plateauStackTrace', 'plateauConsole', 'plateauPandas', 'plateauStreams', 'plateauStepping', 'plateauComputed', 'plateauFiltering'];
  const deck = loadDeck({ source, components, scope: { bindings: Object.fromEntries(assets.map(name => [name, `${name}.png`])) } });
  expect(deck.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  const slides = deck.slidesData.filter(slide => slide.buildIndex === 0);
  expect(slides[4]!.comp.fills.find(fill => fill.name === 'label')?.value).toMatchObject({ kind: 'string', value: 'Place & Time — Print debugging' });
  expect(source).toContain('mode: "calculator-print-place-time"');

  await page.goto('/canvas.html?fixture=plateau-debugger');
  const fixture = await getEditorSource(page);
  await setHostSource(page, fixture.replace('DebuggerDemo {', 'DebuggerDemo { mode: "calculator-place-time"'));
  const previous = page.locator('.sw-canvas-stage [data-sw-debugger]');
  await previous.getByLabel('Demo stage').selectOption('9');
  await expect.poll(() => previous.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  const axisSelectors = ['[data-demo-chart] path', '[data-demo-state-label]', '[data-demo-time-label]'];
  const previousBounds = await Promise.all(axisSelectors.map(selector => previous.locator(selector).boundingBox()));
  await setHostSource(page, fixture.replace('DebuggerDemo {', 'DebuggerDemo { mode: "calculator-print-place-time"'));
  const before = await getEditorSource(page);
  const demo = page.locator('.sw-canvas-stage [data-demo-calculator-print]');
  const stage = demo.getByLabel('Demo stage');
  const terminal = demo.getByLabel('Demo terminal');
  await expect(stage.locator('option')).toHaveCount(5);
  await expect(demo.locator('[data-demo-panels]')).toHaveAttribute('aria-hidden', 'true');
  await expect(demo.getByLabel('Debugging technique')).toHaveCSS('opacity', '0');
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(0);
  for (const [index, selector] of axisSelectors.entries()) {
    const bounds = (await demo.locator(selector).boundingBox())!;
    const prior = previousBounds[index]!;
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(bounds[key]).toBeCloseTo(prior[key], 1);
  }
  const fullWidth = (await demo.locator('[data-demo-chart-layout]').boundingBox())!.width;
  await stage.selectOption('1');
  const morph = await demo.evaluate(element => {
    const layout = element.querySelector('[data-demo-chart-layout]')!;
    const panels = element.querySelector('[data-demo-panels]')!;
    const label = element.querySelector('[data-demo-time-label]')!;
    const animations = [layout, panels].map(node => node.getAnimations()[0]!);
    for (const animation of animations) { animation.pause(); animation.currentTime = 350; }
    const midwayWidth = layout.getBoundingClientRect().width;
    const midwayLabelHeight = label.getBoundingClientRect().height;
    const midwayOpacity = Number(getComputedStyle(panels).opacity);
    for (const animation of animations) animation.finish();
    return { duration: animations[0]!.effect!.getTiming().duration, midwayWidth, midwayLabelHeight, midwayOpacity, endWidth: layout.getBoundingClientRect().width, endLabelHeight: label.getBoundingClientRect().height };
  });
  expect(morph.duration).toBe(700);
  expect(morph.midwayWidth).toBeLessThan(fullWidth);
  expect(morph.midwayWidth).toBeGreaterThan(morph.endWidth);
  expect(morph.midwayLabelHeight).toBeGreaterThan(morph.endLabelHeight);
  expect(morph.midwayOpacity).toBeGreaterThan(0);
  expect(morph.midwayOpacity).toBeLessThan(1);
  await expect(demo.locator('[data-demo-panels]')).toHaveCSS('opacity', '1');
  await expect(demo.getByLabel('Demo code')).toContainText('case "^": result = left * right');
  await expect(demo.locator('[data-demo-inserted-line]')).toHaveAttribute('aria-hidden', 'true');
  await stage.selectOption('2');
  await expect(demo.locator('[data-demo-inserted-line]')).toHaveAttribute('data-demo-print-accent', 'true');
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(0);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  async function advanceFrames(from: number, to: number, delay: number) {
    for (let frame = from + 1; frame <= to; frame++) {
      await page.clock.runFor(delay);
      await expect(demo).toHaveAttribute('data-frame', String(frame));
    }
  }
  await stage.selectOption('3');
  await expect(demo.locator('[data-demo-call]')).toHaveText('evaluate(node) · 4 ^ 2');
  await advanceFrames(0, 5, 360);
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(0);
  await expect(demo.locator('[data-demo-paused-line]')).toContainText('case "^"');
  await advanceFrames(5, 6, 360);
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(1);
  await expect(demo.locator('[data-demo-paused-line]')).toContainText('print(node.op)');
  await expect(terminal).toContainText('^');
  await expect(terminal).not.toContainText('26');
  await advanceFrames(6, 7, 360);
  await stage.selectOption('4');
  await expect(demo.locator('[data-demo-call]')).toHaveText('evaluate(node) · 3 * 8');
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(1);
  await advanceFrames(8, 14, 240);
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(2);
  await expect(terminal).toContainText('*');
  await advanceFrames(14, 22, 240);
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(3);
  await expect(demo.locator('[data-demo-call]')).toContainText('2 + 24');
  await expect(terminal).toContainText('+');
  await expect(terminal).not.toContainText('26');
  await advanceFrames(22, 23, 240);
  await expect(terminal).toContainText('26');
  await expect(demo.locator('[data-demo-operation-label]')).toHaveText(['^', '*', '+']);
  await expect(demo.locator('[data-demo-dot]').first()).toHaveCSS('fill', 'rgb(0, 0, 255)');
  await expect(demo.locator('[data-demo-chart] line').first()).toHaveCSS('stroke', 'rgb(0, 0, 255)');
  await demo.screenshot({ path: test.info().outputPath('calculator-print-complete.png') });
  for (const name of ['Demo code', 'Demo terminal']) {
    const size = await demo.getByLabel(name).evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight }));
    expect(size.contentWidth, `${name}: ${JSON.stringify(size)}`).toBeLessThanOrEqual(size.width);
    expect(size.contentHeight, `${name}: ${JSON.stringify(size)}`).toBeLessThanOrEqual(size.height);
  }
  await stage.selectOption('3');
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(0);
  await expect(terminal).not.toContainText('26');
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await expect(demo.locator('[data-demo-panels]')).toHaveAttribute('aria-hidden', 'true');
  expect(await getEditorSource(page)).toBe(before);
  // Presenter navigation waits at builds, while the execution inside a build runs.
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(demo).toHaveAttribute('data-step', '3');
  await advanceFrames(0, 7, 360);
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(1);
  await expect(demo).toHaveAttribute('data-step', '3');
  await page.keyboard.press('ArrowRight');
  await advanceFrames(8, 23, 240);
  await expect(demo.locator('[data-demo-dot]')).toHaveCount(3);
  await expect(terminal).toContainText('26');
});

test('calculator breakpoint slide moves from line 6 to line 9 and updates the inspector', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const { loadDeck } = await import('../slidewright/runtime/loader');
  const { components } = await import('../decks/uist-2026/registry');
  const source = readFileSync('decks/uist-2026/deck.sw', 'utf8');
  const assets = ['plateauHeadshot', 'plateauPennHci', 'plateauStackTrace', 'plateauConsole', 'plateauPandas', 'plateauStreams', 'plateauStepping', 'plateauComputed', 'plateauFiltering'];
  const deck = loadDeck({ source, components, scope: { bindings: Object.fromEntries(assets.map(name => [name, `${name}.png`])) } });
  expect(deck.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  const slides = deck.slidesData.filter(slide => slide.buildIndex === 0);
  expect(slides[5]!.comp.fills.find(fill => fill.name === 'label')?.value).toMatchObject({ kind: 'string', value: 'Place & Time — Breakpoint debugging' });
  await page.goto('/canvas.html?fixture=plateau-debugger');
  await setHostSource(page, (await getEditorSource(page)).replace('DebuggerDemo {', 'DebuggerDemo { mode: "calculator-breakpoint-place-time"'));
  const before = await getEditorSource(page);
  const demo = page.locator('.sw-canvas-stage [data-demo-calculator-breakpoint]');
  const stage = demo.getByLabel('Demo stage');
  await expect(stage.locator('option')).toHaveCount(2);
  await expect(demo.getByLabel('Demo terminal')).toHaveCount(0);
  await expect(demo.getByLabel('Debugging technique')).toContainText('Across Place · Point in Time');
  await expect(demo.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '5');
  await expect(demo.locator('[data-demo-variable="result"] dd')).toHaveText('not assigned');
  await expect(demo.locator('[data-demo-variable="left"] dd')).toHaveText('4');
  await expect(demo.locator('[data-demo-variable="right"] dd')).toHaveText('2');
  await stage.selectOption('1');
  await expect(demo.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '8');
  await expect(demo.locator('[data-demo-variable="result"] dd')).toHaveText('8');
  const motion = await demo.evaluate(element => {
    const bar = element.querySelector('[data-demo-breakpoint]')!;
    const highlight = element.querySelector('[data-demo-line-highlight]')!;
    const animations = [bar, highlight].map(node => node.getAnimations()[0]!);
    for (const animation of animations) { animation.pause(); animation.currentTime = Number(animation.effect!.getTiming().duration) / 2; }
    const midwayX = Number.parseFloat(getComputedStyle(bar).x);
    const midwayHighlight = getComputedStyle(highlight).transform;
    for (const animation of animations) animation.finish();
    return { midwayX, midwayHighlight, finalHighlight: getComputedStyle(highlight).transform };
  });
  expect(motion.midwayX).toBeGreaterThan(208);
  expect(motion.midwayX).toBeLessThan(308);
  expect(motion.midwayHighlight).not.toBe(motion.finalHighlight);
  await expect(demo.locator('[data-demo-breakpoint]')).toHaveCSS('fill', 'rgb(0, 0, 255)');
  for (const name of ['Demo code', 'Demo variables']) {
    const size = await demo.getByLabel(name).evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight }));
    expect(size.contentWidth, `${name}: ${JSON.stringify(size)}`).toBeLessThanOrEqual(size.width);
    expect(size.contentHeight, `${name}: ${JSON.stringify(size)}`).toBeLessThanOrEqual(size.height);
  }
  await demo.screenshot({ path: test.info().outputPath('calculator-breakpoint-line9.png') });
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await expect(demo.locator('[data-demo-variable="result"] dd')).toHaveText('not assigned');
  await expect(demo.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '5');
  expect(await getEditorSource(page)).toBe(before);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(demo).toHaveAttribute('data-step', '1');
  await expect(demo.locator('[data-demo-variable="result"] dd')).toHaveText('8');
  await page.keyboard.press('ArrowLeft');
  await expect(demo).toHaveAttribute('data-step', '0');
  await expect(demo.locator('[data-demo-variable="result"] dd')).toHaveText('not assigned');
});

test('calculator print and breakpoint slides crossfade across real slide navigation', async ({ page }) => {
  await page.goto('/canvas.html?fixture=calculator-slide-transition');
  const print = page.locator('.sw-canvas-stage [data-demo-calculator-print]');
  await expect(print).toBeVisible();
  await expect(page.locator('.sw-canvas-stage [data-demo-slide-transition]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  for (let step = 1; step <= 4; step++) await page.keyboard.press('ArrowRight');
  await expect(print).toHaveAttribute('data-step', '4');
  await expect(print.getByLabel('Demo terminal')).toContainText('26');
  const before = await getEditorSource(page);
  await page.keyboard.press('ArrowRight');
  const breakpoint = page.locator('.sw-canvas-stage [data-demo-calculator-breakpoint]');
  await expect(breakpoint).toBeVisible();
  const outgoing = breakpoint.locator('[data-demo-slide-transition="outgoing"]');
  await expect(outgoing).toHaveCount(1);
  await expect(outgoing).toHaveAttribute('aria-hidden', 'true');
  expect(await outgoing.textContent()).toContain('Some Place · Across Time');
  const fade = await breakpoint.evaluate(element => {
    const incoming = element.querySelector('[data-demo-transition-body]')!;
    const outgoing = element.querySelector('[data-demo-slide-transition]')!;
    const animations = [incoming, outgoing].map(node => node.getAnimations()[0]!);
    for (const animation of animations) { animation.pause(); animation.currentTime = 350; }
    const values = [incoming, outgoing].map(node => Number(getComputedStyle(node).opacity));
    const duration = animations[0]!.effect!.getTiming().duration;
    for (const animation of animations) animation.finish();
    return { values, duration };
  });
  expect(fade.duration).toBe(700);
  for (const opacity of fade.values) { expect(opacity).toBeGreaterThan(0); expect(opacity).toBeLessThan(1); }
  await expect(outgoing).toHaveCount(0);
  await expect(breakpoint.getByLabel('Demo variables')).toBeVisible();
  await expect(breakpoint.locator('[data-demo-paused-line]')).toHaveAttribute('data-demo-code-line', '5');
  expect(await getEditorSource(page)).toBe(before);
  // Navigating back uses the same crossfade; reduced motion skips it.
  await page.keyboard.press('ArrowLeft');
  await expect(print).toBeVisible();
  await expect(print.locator('[data-demo-slide-transition]')).toHaveCount(1);
  await expect(print.locator('[data-demo-slide-transition]')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let step = 1; step <= 4; step++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(breakpoint).toBeVisible();
  await expect(breakpoint.locator('[data-demo-slide-transition]')).toHaveCount(0);
});

test('slide 7 compares print, breakpoint and backward causal queries in Place-Time', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const { loadDeck } = await import('../slidewright/runtime/loader');
  const { components } = await import('../decks/uist-2026/registry');
  const source = readFileSync('decks/uist-2026/deck.sw', 'utf8');
  const assets = ['plateauHeadshot', 'plateauPennHci', 'plateauStackTrace', 'plateauConsole', 'plateauPandas', 'plateauStreams', 'plateauStepping', 'plateauComputed', 'plateauFiltering'];
  const deck = loadDeck({ source, components, scope: { bindings: Object.fromEntries(assets.map(name => [name, `${name}.png`])) } });
  expect(deck.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
  const slides = deck.slidesData.filter(slide => slide.buildIndex === 0);
  expect(slides[6]!.comp.fills.find(fill => fill.name === 'label')?.value).toMatchObject({ kind: 'string', value: 'Place & Time — Debugging tools' });
  expect(JSON.stringify(slides[6]!.comp).match(/"name":"PlaceTimeDiagram"/g)).toHaveLength(3);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/canvas.html?fixture=plateau-debugger');
  await getEditorSource(page);
  await setHostSource(page, source);
  await page.getByRole('option', { name: 'Slide 7', exact: true }).click();
  const comparison = page.locator('.sw-canvas-stage');
  await expect(comparison.locator('[data-sw-component="PlaceTimeDiagram"]')).toHaveCount(3);
  const labels = ['Print debugging', 'Breakpoint debugging', 'Whyline'];
  for (const label of labels) {
    await expect(comparison.locator('[data-sw-textbox-content]').filter({ hasText: label })).toHaveCSS('color', 'rgb(0, 0, 0)');
  }
  for (const text of await comparison.locator('svg text').all()) await expect(text).toHaveCSS('fill', 'rgb(0, 0, 0)');
  const print = comparison.locator('[data-demo-comparison="print"]');
  const breakpoint = comparison.locator('[data-demo-comparison="breakpoint"]');
  const whyline = comparison.locator('[data-demo-comparison="whyline"]');
  await expect(print.locator('[data-demo-comparison-dot]')).toHaveCount(3);
  expect(new Set(await print.locator('circle').evaluateAll(nodes => nodes.map(node => node.getAttribute('cy')))).size).toBe(1);
  await expect(breakpoint.locator('[data-demo-comparison-bar]')).toHaveCount(1);
  await expect(whyline.locator('[data-demo-comparison-dot]')).toHaveCount(3);
  for (const axis of ['cx', 'cy']) {
    expect(new Set(await whyline.locator('circle').evaluateAll((nodes, attribute) => nodes.map(node => node.getAttribute(attribute)), axis)).size).toBe(3);
  }
  const links = whyline.locator('[data-demo-causal-link]');
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    expect(await link.evaluate(node => Number(node.getAttribute('x2')) < Number(node.getAttribute('x1')))).toBe(true);
    expect(await link.evaluate(node => {
      const id = node.getAttribute('marker-end')!.slice(5, -1);
      return !!node.ownerDocument.getElementById(id);
    })).toBe(true);
  }
  const plots = await Promise.all([print, breakpoint, whyline].map(plot => plot.boundingBox()));
  for (let index = 0; index < 2; index++) expect(plots[index]!.x + plots[index]!.width).toBeLessThan(plots[index + 1]!.x);
  for (const [index, label] of labels.entries()) {
    const caption = (await comparison.getByText(label, { exact: true }).boundingBox())!;
    expect(caption.y).toBeGreaterThan(plots[index]!.y + plots[index]!.height);
  }
  await comparison.screenshot({ path: test.info().outputPath('place-time-tools.png') });
  // Moving a diagram writes only its geometry; labels remain separate objects.
  const diagram = comparison.locator('[data-demo-place-time-diagram="print"]');
  const bounds = (await diagram.boundingBox())!;
  const captionBefore = (await comparison.getByText('Print debugging', { exact: true }).boundingBox())!;
  const canvas = (await comparison.locator('.presentation-canvas').boundingBox())!;
  const scale = canvas.width / 1920;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(bounds.x + bounds.width / 2 + 40 * scale, bounds.y + bounds.height / 2 + 20 * scale, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toMatch(/PlaceTimeDiagram\s*{\s*kind: "print"\s*x: 140\s*y: 280/);
  expect((await comparison.getByText('Print debugging', { exact: true }).boundingBox())!.x).toBeCloseTo(captionBefore.x, 1);
  await comparison.getByText('Print debugging', { exact: true }).click();
  const toolbar = page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });
  await toolbar.getByLabel('Font size', { exact: true }).fill('44');
  await page.keyboard.press('Enter');
  await expect(toolbar.getByLabel('Font size', { exact: true })).toHaveValue('44');
  await expect.poll(() => getEditorSource(page)).toMatch(/fontSize: 44[\s\S]*?Print debugging/);
});
