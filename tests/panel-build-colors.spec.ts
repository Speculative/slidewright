import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const source = readFileSync('tests/fixtures/panel-build-colors.sw', 'utf8');
const cases = ['code', 'terminal'].flatMap(panel => ['+', '*', '^'].map(operator => ({ panel, operator, arithmetic: false, output: false })));
cases.push(...['+', '*'].map(operator => ({ panel: 'code', operator, arithmetic: true, output: false })));
cases.push(...['^', '*', '+'].map(operator => ({ panel: 'terminal', operator, arithmetic: false, output: true })));
for (const { panel, operator, arithmetic, output } of cases) {
  test(`${panel} ${operator}${arithmetic ? ' arithmetic' : output ? ' output' : ''} color applies on the fourth frame through the foreground picker`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    await getEditorSource(page);
    await setHostSource(page, source);
    await page.locator('.sw-build-thumb').nth(2).click();
    const stage = page.locator('.sw-canvas-stage');
    const root = stage.locator(panel === 'code' ? '[data-sw-code-display]' : '[data-sw-terminal-display]:visible');
    const lines = root.locator(panel === 'code' ? '[data-demo-code-line]' : '[data-sw-terminal-line]');
    const before = await lines.allTextContents();
    await root.getByRole('button', { name: panel === 'code' ? 'Edit code' : 'Edit output', exact: true }).click();
    await stage.locator('.ProseMirror').evaluate((root, { panel, operator, arithmetic, output }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let skipped = false;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent!;
        const index = text.indexOf(panel === 'code' ? arithmetic ? `left ${operator} right` : `case "${operator}"` : operator);
        if (index < 0) continue;
        if (output && !skipped) { skipped = true; continue; }
        const offset = index + (panel === 'code' ? arithmetic ? 5 : 6 : 0);
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
        const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        return;
      }
      throw new Error('Missing operator');
    }, { panel, operator, arithmetic, output });
    await page.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
    await page.getByRole('group', { name: 'global colors', exact: true }).getByRole('button', { name: 'red', exact: true }).click();
    await expect(stage.locator('.ProseMirror').getByText(operator, { exact: true }).last()).toHaveCSS('color', 'rgb(212, 42, 12)');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(root.getByText(operator, { exact: true }).first()).toHaveCSS('color', 'rgb(212, 42, 12)');
    await expect(root.locator('[data-sw-slot-empty]')).toHaveCount(0);
    await expect(root.locator('[data-sw-text-span-start]:empty')).toHaveCount(0);
    expect(await lines.allTextContents()).toEqual(before);
    const saved = await getEditorSource(page);
    expect(saved).not.toBe(source);
    await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
    await page.locator('.sw-build-thumb').nth(2).click();
    await expect(root.getByText(operator, { exact: true }).first()).toHaveCSS('color', 'rgb(212, 42, 12)');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await getEditorSource(page)).toBe(source);
  });
}
