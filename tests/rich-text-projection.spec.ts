import { test, expect, type Page } from '@playwright/test';

async function select(page: Page, text: string, offset: number, length = 0) {
  await page.evaluate(({ text, offset, length }) => {
    const probe = (window as unknown as { richTextProbe: { find(text: string, offset: number): number; select(from: number, to?: number): void } }).richTextProbe;
    const position = probe.find(text, offset);
    if (position < 0) throw new Error('Text not found');
    probe.select(position, position + length);
  }, { text, offset, length });
}
test.beforeEach(async ({ page }) => { await page.goto('/tests/fixtures/rich-text.html'); await expect(page.getByRole('textbox', { name: 'Rich text' })).toBeVisible(); });

test('native caret and Shift-selection cross authored and styled run boundaries', async ({ page }) => {
  await select(page, 'abc', 2);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (window as unknown as { richTextProbe: { caret(): number } }).richTextProbe.caret())).toBe(5);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.type('!');
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('abcD!ghi');
  await expect(page.locator('#source')).toContainText('weight: "700"');
  await expect(page.locator('#source')).toContainText('color: accent');
  await expect(page.locator('#source')).toContainText('expression: "x + y"');
});

test('browser list split, indent, outdent, and draft undo lower to the DSL', async ({ page }) => {
  await select(page, 'second', 3);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror > ol > li')).toHaveCount(3);
  await page.keyboard.press('Tab');
  await expect(page.locator('.ProseMirror ol ol')).toHaveCount(1);
  await expect(page.locator('#source')).toContainText('children: List {');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.ProseMirror ol ol')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.locator('.ProseMirror ol ol')).toHaveCount(1);
});

test('transparent inline children edit while owned elements and references stay atomic; clipboard retains source constructs', async ({ page }) => {
  await select(page, 'pill', 2);
  await page.keyboard.type('!');
  await expect(page.locator('#source')).toContainText('"pi!ll"');
  await expect(page.locator('.ProseMirror [data-sw-inline-type="Formula"]')).toHaveAttribute('contenteditable', 'false');
  await expect(page.locator('.ProseMirror [data-sw-reference]')).toHaveText('shared term');
  const source = await page.evaluate(() => (window as unknown as { richTextProbe: { clipboardRoundTrip(): string } }).richTextProbe.clipboardRoundTrip());
  expect(source).toContain('Pill {');
  expect(source).toContain('"pi!ll"');
  expect(source).toContain('expression: "x + y"');
  expect(source).toMatch(/\bterm\b/);
});
