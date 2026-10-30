import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const source = readFileSync('tests/fixtures/code-terminal.sw', 'utf8');

test('calculator terminal fits beside code and accepts custom transcripts', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
  const stage = page.locator('.sw-canvas-stage');
  const terminal = stage.locator('[data-sw-terminal-display]');
  await expect(terminal).toBeVisible();
  await expect(terminal.getByLabel('Demo terminal')).toHaveText('Terminal>>> calculate("2 + 3 * 4 ^ 2")26');
  const codeBox = await stage.locator('[data-sw-code-display]').boundingBox();
  const terminalBox = await terminal.boundingBox();
  expect(terminalBox!.x).toBeGreaterThan(codeBox!.x + codeBox!.width);
  expect(Math.abs(terminalBox!.y - codeBox!.y)).toBeLessThan(5);
  expect(await terminal.getByLabel('Demo terminal').evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
  await stage.screenshot({ path: test.info().outputPath('calculator-terminal.png') });

  await page.locator('.sw-hierarchy-node[data-sw-component="TerminalDisplay"]').click();
  const content = page.locator('.sw-property-row').filter({ has: page.locator('.sw-property-key', { hasText: /^content$/ }) }).getByRole('textbox');
  const transcript = '>>> custom()\n\n  indented output\n' + 'long output '.repeat(12);
  await content.fill(JSON.stringify(transcript));
  await content.press('Enter');
  await expect(terminal.getByLabel('Demo terminal').locator(':scope > div')).toHaveText(transcript.split('\n'));
  await expect.poll(async () => (await getEditorSource(page)).includes('custom()')).toBe(true);
  expect(await terminal.getByLabel('Demo terminal').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
