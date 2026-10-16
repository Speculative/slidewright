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

for (const { marker, tag, start } of [
  { marker: '*', tag: 'ul', start: null },
  { marker: '1.', tag: 'ol', start: '1' },
  { marker: '3.', tag: 'ol', start: '3' },
  { marker: '12.', tag: 'ol', start: '12' },
]) {
  test(`inserting ${marker} before existing text converts immediately`, async ({ page }) => {
    await select(page, 'abc', 0);
    await page.keyboard.type(marker);
    const list = page.locator(`.ProseMirror > ${tag}`).first();
    await expect(list.locator(':scope > li')).toHaveText(['abcDEFghi']);
    if (start) await expect(list).toHaveAttribute('start', start);
    await expect(list.locator('[style*="font-weight"]')).toHaveText('DEF');
    if (start && start !== '1') await expect(page.locator('#source')).toContainText(`start: ${start}`);
    // Conversion leaves the caret before the existing text. A conventional
    // trailing space is consumed without adding whitespace to that text.
    await page.keyboard.type(' X');
    await expect(list.locator(':scope > li')).toHaveText(['XabcDEFghi']);
  });
}

test('invalid numbered starts remain literal', async ({ page }) => {
  await select(page, 'abc', 0);
  await page.keyboard.type('0. ');
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('0. abcDEFghi');
});

test('list shortcuts preserve following styled runs and undo as one conversion', async ({ page }) => {
  await select(page, 'abc', 0);
  await page.keyboard.type('* ');
  const first = page.locator('.ProseMirror > ul > li');
  await expect(first).toHaveText('abcDEFghi');
  await expect(first.locator('[style*="font-weight"]')).toHaveText('DEF');
  await expect(page.locator('#source')).toContainText('color: accent');
  await expect(page.locator('#source')).toContainText('expression: "x + y"');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.locator('.ProseMirror > ul')).toHaveCount(0);
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('abcDEFghi');
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(first).toHaveText('abcDEFghi');
});

test('markers within text or transparent inline components remain literal', async ({ page }) => {
  await select(page, 'abc', 1);
  await page.keyboard.type('* ');
  await expect(page.locator('.ProseMirror > p').first()).toHaveText('a* bcDEFghi');
  await select(page, 'pill', 0);
  await page.keyboard.type('1. ');
  await expect(page.locator('.ProseMirror [data-sw-inline-type="Pill"]')).toHaveText('1. pill');
  await expect(page.locator('.ProseMirror > ul')).toHaveCount(0);
  await expect(page.locator('.ProseMirror > ol')).toHaveCount(1);
});

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
