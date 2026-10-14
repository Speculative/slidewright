import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource, selectRichText } from './editor-helpers';

test('continuous TextBox uses Enter for structure and commits once through Done/undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 2);
  await page.keyboard.press('Enter');
  await page.keyboard.type('new');
  await expect(editor.locator('p')).toHaveCount(2);
  expect(await getEditorSource(page)).toBe(before);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => getEditorSource(page)).toContain('"newllo"');
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

test('range edits cross Span boundaries without dropping unrelated list content or styles', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await selectRichText(page, 'Mixed ', 3, 'style', 2);
  await page.keyboard.type('X');
  await page.keyboard.press('ControlOrMeta+Enter');
  const source = await getEditorSource(page);
  expect(source).toContain('"MixX"');
  expect(source).toContain('"yle"');
  expect(source).toContain('weight: "700"');
  expect(source).toContain('href: "https://example.com/rich-text"');
  expect(source).toContain('"First bullet"');
});

test('list items split, indent/outdent, and merge continuously on canvas', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  await page.locator('.sw-canvas-stage').getByText('Structured item', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Structured item', 10);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(editor.locator('ol ol')).toHaveCount(1);
  await page.keyboard.press('Shift+Tab');
  await expect(editor.locator('ol ol')).toHaveCount(0);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => getEditorSource(page)).toContain('"Structured item"');
  await expect(page.locator('.sw-canvas-stage [data-sw-textbox-content]').nth(1).locator('ol > li').first()).toContainText('Structured item');
});

test('Escape and Cancel restore the source; draft undo emits no session commit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('discard');
  await page.keyboard.press('Escape');
  expect(await getEditorSource(page)).toBe(before);
  await expect(page.locator('.sw-canvas-stage')).toContainText('Hello');
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  await selectRichText(page, 'Hello', 2);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+Z');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await getEditorSource(page)).toBe(before);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  await page.keyboard.type('discard');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await getEditorSource(page)).toBe(before);
});

test('blur commits; external source replacements cancel a composing draft', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('blurred');
  await page.locator('.sw-editor-view .cm-content').click();
  await expect.poll(() => getEditorSource(page)).toContain('"blurred"');
  await page.locator('.sw-canvas-stage').getByText('blurred', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await editor.dispatchEvent('compositionstart', { data: '' });
  await setHostSource(page, before.replace('Hello', 'External'));
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.sw-canvas-stage')).toContainText('External');
  expect(await getEditorSource(page)).toContain('"External"');
});

for (const content of ['', 'content: []', 'content: omit']) {
  test(`an empty TextBox (${content || 'missing content'}) edits and commits a canonical document`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=single-textbox');
    await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [TextBox { x: 300 y: 200 width: 600 height: 300 ${content} }] } }] }`);
    await page.locator('.sw-canvas-stage [data-sw-textbox-content]').dblclick({ position: { x: 25, y: 25 } });
    await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
    await page.keyboard.type('new text');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => getEditorSource(page)).toMatch(/content:\s*\[\s*Paragraph\s*\{\s*content:\s*\[\s*"new text"/);
  });
}

test('transparent inline content and owned formula editor preserve their source and cursor handoff', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [TextBox { x: 300 y: 200 width: 1200 height: 400 content: [
    Paragraph { content: ["Before " InlineBadge { prefix: "Tag" content: ["badge"] } " after " InlineFormula { expression: "x + y" }] }
  ] }] } }] }`);
  await page.locator('.sw-canvas-stage').getByText('badge', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toContainText('Tag badge');
  await expect(editor).toContainText('x + y');
  await selectRichText(page, 'badge', 2);
  await page.keyboard.type('!');
  await editor.getByText('x + y', { exact: true }).dblclick();
  const formula = page.getByRole('textbox', { name: 'Formula expression' });
  await expect(formula).toBeVisible();
  await formula.fill('z + 1');
  await formula.press('Enter');
  await expect(formula).toHaveCount(0);
  await expect(editor).toContainText('z + 1');
  await editor.getByText('z + 1', { exact: true }).dblclick();
  await expect(formula).toBeVisible();
  await formula.evaluate((input: HTMLInputElement) => input.setSelectionRange(input.value.length, input.value.length));
  await formula.press('ArrowRight');
  await expect(formula).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Enter');
  const source = await getEditorSource(page);
  expect(source).toContain('InlineBadge {');
  expect(source).toContain('"ba!dge"');
  expect(source).toContain('prefix: "Tag"');
  expect(source).toContain('expression: "z + 1"');
  expect(errors).toEqual([]);
});

test('native editing preserves emoji and combining graphemes', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await setHostSource(page, before.replace('Hello', 'A😀éB'));
  await page.locator('.sw-canvas-stage').getByText('A😀éB', { exact: true }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await selectRichText(page, 'A😀éB', 5);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => getEditorSource(page)).toContain('"AéB"');
});

test('source-driven slide navigation cancels the active draft', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const source = `Deck { slides: [
    Slide { label: "One" content: Freeform { children: [TextBox { x: 300 y: 200 width: 600 height: 300 content: "Original" }] } }
    Slide { label: "Two" content: Freeform { children: [TextBox { x: 300 y: 200 width: 600 height: 300 content: "Other" }] } }
  ] }`;
  await setHostSource(page, source);
  await page.locator('.sw-canvas-stage').getByText('Original', { exact: true }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await page.keyboard.type('discard');
  await page.evaluate(offset => (window as unknown as { __slidewrightHost: { setCursor(offset: number): void } }).__slidewrightHost.setCursor(offset), source.indexOf('label: "Two"'));
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
  await expect(page.locator('.sw-canvas-stage')).toContainText('Other');
  expect(await getEditorSource(page)).toBe(source);
});

test('a composing draft defers blur commit until composition ends', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('composed');
  await editor.dispatchEvent('compositionstart', { data: '' });
  await page.locator('.sw-editor-view .cm-content').click();
  await expect(editor).toBeVisible();
  await editor.dispatchEvent('compositionend', { data: 'composed' });
  await expect(editor).toHaveCount(0);
  await expect.poll(() => getEditorSource(page)).toContain('"composed"');
});

test('links remain editable without navigation and formatting shortcuts preserve authored tokens', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  const url = page.url();
  await page.locator('.sw-canvas-stage a', { hasText: 'link' }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  expect(page.url()).toBe(url);
  await selectRichText(page, 'link', 0, 'link', 4);
  await page.keyboard.press('ControlOrMeta+B');
  await page.keyboard.press('ControlOrMeta+Enter');
  const source = await getEditorSource(page);
  expect(source).toContain('href: "https://example.com/rich-text"');
  expect(source).toContain('color: accent');
  await expect(page.locator('.sw-canvas-stage a', { hasText: 'link' })).toHaveCSS('font-weight', '700');
});

test('formatting toolbar retains a cross-run range and commits one source edit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Mixed ', 0, 'style', 5);
  await page.getByRole('button', { name: 'Italic', exact: true }).click();
  await page.getByLabel('Text style', { exact: true }).selectOption('size');
  await page.getByLabel('Style value', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Apply style', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(await getEditorSource(page)).toBe(before);
  await expect(editor.getByText('Mixed ', { exact: true })).toHaveCSS('font-size', '42px');
  await page.getByLabel('Text style', { exact: true }).selectOption('font');
  await page.getByLabel('Style value', { exact: true }).fill('Georgia');
  await page.getByRole('button', { name: 'Apply style', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const source = await getEditorSource(page);
  expect(source).toContain('size: 42');
  await expect(page.locator('.sw-canvas-stage').getByText('Mixed ', { exact: true })).toHaveCSS('font-family', 'Georgia');
  expect(source).toContain('italic: true');
  expect(source).toContain('"First bullet"');
  expect(source).toContain('href: "https://example.com/rich-text"');
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

test('caret formatting changes future typing and toolbar focus can commit on exit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 5);
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.keyboard.type('!');
  await page.getByLabel('Text style', { exact: true }).selectOption('color');
  await page.getByLabel('Style value', { exact: true }).fill('red');
  await page.getByRole('button', { name: 'Apply style', exact: true }).click();
  expect(await getEditorSource(page)).toBe(before);
  await page.locator('.sw-editor-view .cm-content').focus();
  await expect(editor).toHaveCount(0);
  expect(await getEditorSource(page)).toContain('weight: "700"');
  expect(await getEditorSource(page)).toContain('"!"');
});

test('clear formatting removes only the selected styles and supports draft undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'style', 0, 'style', 5);
  await expect(editor.getByText('style', { exact: true })).toHaveCSS('font-weight', '700');
  await page.getByRole('button', { name: 'Clear formatting', exact: true }).click();
  await expect(editor.getByText('style', { exact: true })).toHaveCSS('font-weight', '500');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor.getByText('style', { exact: true })).toHaveCSS('font-weight', '700');
  await page.getByRole('button', { name: 'Clear formatting', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.sw-canvas-stage').getByText('style', { exact: true })).toHaveCSS('font-weight', '500');
  expect(await getEditorSource(page)).toContain('href: "https://example.com/rich-text"');
  expect(await getEditorSource(page)).not.toBe(before);
});
