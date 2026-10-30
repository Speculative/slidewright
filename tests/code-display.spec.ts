import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const source = readFileSync('tests/fixtures/code-terminal.sw', 'utf8');
const example = [
  'def evaluate(node):',
  '    if isinstance(node, Num):',
  '        return node.value',
  '    left = evaluate(node.left)',
  '    right = evaluate(node.right)',
  '    match node.op:',
  '        case "+": result = left + right',
  '        case "*": result = left * right',
  '        case "^": result = left * right',
  '    return result',
];

test('example preserves Python source and supports emphasis and a narrower layout', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
  const stage = page.locator('.sw-canvas-stage');
  const code = stage.getByLabel('Python code', { exact: true });
  await expect(code).toBeVisible();
  await expect(stage.locator('[data-sw-print-debugger], [data-sw-debugger], [data-sw-breakpoint-debugger]')).toHaveCount(0);
  await expect(code.locator('[data-demo-code-line]')).toHaveText(example.map((line, i) => `${i + 1} ${line}`));
  await expect(code.locator('.token.keyword').first()).toHaveText('def');
  await expect(code.locator('.token.keyword').first()).toHaveCSS('color', 'rgb(128, 0, 255)');
  await expect(code.locator('.token.function').first()).toHaveCSS('color', 'rgb(0, 125, 112)');
  await expect(code.locator('.token.string').first()).toHaveText('"+"');
  await expect(code.locator('[data-demo-print-accent]')).toHaveCount(0);
  expect(await code.evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/mono/i);
  await code.screenshot({ path: test.info().outputPath('example.png') });

  const modified = source.replace('highlightedLines: []', 'highlightedLines: [7, 9]')
    .replace(/(CodeDisplay\s*\{[\s\S]*?width: )\d+/, '$1800')
    .replace('case "^": result = left * right', 'case "^": result = left ** right');
  await setHostSource(page, modified);
  await expect(code.locator('[data-demo-print-accent]')).toHaveCount(2);
  await expect(code.locator('[data-demo-code-line="6"]')).toHaveAttribute('data-demo-print-accent', 'true');
  await expect(code.locator('[data-demo-code-line="8"]')).toContainText('left ** right');
  await expect(code.locator('[data-demo-code-line="8"]')).toHaveCSS('background-color', 'rgb(254, 240, 138)');
  expect(await code.evaluate(element => ({ x: element.scrollWidth <= element.clientWidth, y: element.scrollHeight <= element.clientHeight }))).toEqual({ x: true, y: true });
  expect(await getEditorSource(page)).toBe(modified);
});

for (const authored of [true, false]) {
  test(`line emphasis can be edited in the inspector (${authored ? 'authored' : 'default'})`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    await getEditorSource(page);
    await setHostSource(page, authored ? source : source.replace('highlightedLines: []', ''));
    await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
    await page.locator('.sw-hierarchy-node[data-sw-component="CodeDisplay"]').click();
    const input = page.getByRole('textbox', { name: authored ? 'highlightedLines' : 'highlightedLines (default)', exact: true });
    await input.fill('[7, 9]');
    await input.press('Enter');
    const code = page.locator('.sw-canvas-stage [data-sw-code-display]');
    await expect(code.locator('[data-demo-print-accent]')).toHaveCount(2);
    await expect.poll(async () => /highlightedLines:\s*\[\s*7[\s,]+9\s*\]/.test(await getEditorSource(page))).toBe(true);
    const filled = page.getByRole('textbox', { name: 'highlightedLines', exact: true });
    const validSource = await getEditorSource(page);
    await filled.fill('["oops"]');
    await filled.press('Enter');
    await expect(filled).toHaveValue(/\[\s*7[\s,]+9\s*\]/);
    expect(await getEditorSource(page)).toBe(validSource);
    await filled.fill('[]');
    await filled.press('Enter');
    await expect(code.locator('[data-demo-print-accent]')).toHaveCount(0);
  });
}
