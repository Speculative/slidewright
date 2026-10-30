import { test, expect } from '@playwright/test';
import { execution } from '../decks/uist-2026/chart-data';
import { getEditorSource } from './editor-helpers';

test('opening print build reveals probes and matching output, and rewinds without source edits', async ({ page }) => {
  await page.goto('/canvas.html?fixture=print-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-print-debugger]');
  await expect(demo).toBeVisible();
  const source = await getEditorSource(page);
  const code = demo.getByLabel('Demo code');
  const terminal = demo.getByLabel('Demo terminal');
  await expect(code).toContainText('item.price *= 0.9');
  await expect.poll(() => code.innerText()).not.toContain('print(');
  await expect(terminal).toHaveCount(0);
  await demo.getByRole('button', { name: 'Next demo step' }).click();
  await expect(demo).toHaveAttribute('data-step', '1');
  for (const line of execution.codeVariants.printV2.printLines) {
    await expect(code.locator(`[data-demo-code-line="${line}"]`)).toHaveAttribute('data-demo-print-accent', 'true');
  }
  await expect(terminal).toHaveCount(0);
  await demo.getByRole('button', { name: 'Next demo step' }).click();
  await expect(terminal).toBeVisible();
  for (const line of execution.codeVariants.printV2.printLines) {
    await expect(code.locator(`[data-demo-code-line="${line}"]`)).toHaveAttribute('data-demo-print-accent', 'true');
  }
  await expect(terminal.locator('div')).toHaveText(execution.traces.printV2.flatMap(trace => trace.printOutputs.map(output => output.text)));
  await page.waitForTimeout(600);
  for (const panel of [code, terminal]) {
    const fits = await panel.evaluate(element => ({ horizontal: element.scrollWidth <= element.clientWidth, vertical: element.scrollHeight <= element.clientHeight }));
    expect(fits).toEqual({ horizontal: true, vertical: true });
  }
  await demo.screenshot({ path: test.info().outputPath('console-output.png') });
  await expect(demo.getByRole('button', { name: 'Next demo step' })).toBeDisabled();
  await demo.getByRole('button', { name: 'Previous demo step' }).click();
  await expect(terminal).toHaveCount(0);
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await expect.poll(() => code.innerText()).not.toContain('print(');
  await demo.getByRole('button', { name: 'Play demo' }).click();
  await expect(demo).toHaveAttribute('data-step', '2');
  expect(await getEditorSource(page)).toBe(source);
});

test('print insertion opens space and fades in, and can replay with reduced motion', async ({ page }) => {
  await page.goto('/canvas.html?fixture=print-debugger');
  const demo = page.locator('.sw-canvas-stage [data-sw-print-debugger]');
  const probes = demo.locator('[data-demo-inserted-line]');
  await expect(probes).toHaveCount(2);
  await expect(probes.first()).toBeHidden();
  await demo.getByRole('button', { name: 'Next demo step' }).click();
  // Inspect the actual CSS transitions at their midpoint, avoiding wall-clock timing.
  const intermediate = await probes.evaluateAll(elements => elements.map(element => {
    const transitions = element.getAnimations();
    for (const animation of transitions) {
      animation.pause();
      const timing = animation.effect!.getTiming();
      animation.currentTime = Number(timing.delay) + Number(timing.duration) / 2;
    }
    const style = getComputedStyle(element);
    const result = { opacity: Number(style.opacity), height: parseFloat(style.height), lineHeight: parseFloat(style.lineHeight), transitions: transitions.length };
    for (const animation of transitions) animation.finish();
    return result;
  }));
  for (const row of intermediate) {
    expect(row.transitions).toBeGreaterThan(0);
    expect(row.opacity).toBeGreaterThan(0);
    expect(row.opacity).toBeLessThan(1);
    expect(row.height).toBeGreaterThan(0);
    expect(row.height).toBeLessThan(row.lineHeight);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await demo.getByRole('button', { name: 'Reset demo' }).click();
  await expect(probes.first()).toBeHidden();
  await demo.getByRole('button', { name: 'Next demo step' }).click();
  for (const probe of await probes.all()) {
    await expect(probe).toBeVisible();
    expect(await probe.evaluate(element => element.getAnimations().length)).toBe(0);
  }
});
