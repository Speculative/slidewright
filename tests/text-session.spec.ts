import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource, selectRichText } from './editor-helpers';

test('continuous TextBox uses Enter for structure and commits once through Done/undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await expect(page.locator('.sw-selection-outline')).toBeVisible();
  await expect(page.locator('.sw-resize-handle-shape')).toHaveCount(0);
  await selectRichText(page, 'Hello', 2);
  await page.keyboard.press('Enter');
  await page.keyboard.type('new');
  await expect(editor.locator('p')).toHaveCount(2);
  await expect(page.locator('.sw-selection-outline')).toBeVisible();
  expect(await getEditorSource(page)).toBe(before);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => getEditorSource(page)).toContain('"newllo"');
  await page.keyboard.press('Escape');
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
  // The object toolbar now remains above the selected TextBox after Done.
  // Deselect through the bottom of the slide, clear of the floating controls.
  const canvas = page.locator('.sw-canvas-stage .presentation');
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: 5, y: bounds.height - 5 } });
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

test('paragraph toolbar applies hanging indentation to list content and preserves nested lists', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Structured item', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Structured item', 3);
  for (const [field, value] of [['indent', '36'], ['firstLineIndent', '-18'], ['spaceAfter', '12'], ['align', 'right']]) {
    await page.getByLabel('Paragraph style', { exact: true }).selectOption(field);
    await page.getByLabel('Paragraph value', { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Apply paragraph', exact: true }).click();
  }
  const paragraph = editor.locator('p').filter({ hasText: 'Structured item' });
  await expect(paragraph).toHaveCSS('margin-left', '36px');
  await expect(paragraph).toHaveCSS('text-indent', '-18px');
  await expect(paragraph).toHaveCSS('text-align', 'right');
  expect(await getEditorSource(page)).toBe(before);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('firstLineIndent: -18');
  const source = await getEditorSource(page);
  expect(source).toContain('firstLineIndent: -18');
  expect(source).toContain('indent: 36');
  const rendered = page.locator('.sw-canvas-stage p').filter({ hasText: 'Structured item' });
  await expect(rendered).toHaveCSS('text-indent', '-18px');
  await expect(rendered).toHaveCSS('margin-bottom', '12px');
  await page.locator('.sw-canvas-stage').getByText('Structured item', { exact: true }).dblclick();
  await expect(editor.locator('p').filter({ hasText: 'Structured item' })).toHaveCSS('margin-left', '36px');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('paragraph formatting spans multiple owners without changing unselected paragraphs', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 5);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third');
  await selectRichText(page, 'Hello', 2, 'Second', 3);
  await page.getByLabel('Paragraph style', { exact: true }).selectOption('spaceAfter');
  await page.getByLabel('Paragraph value', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Apply paragraph', exact: true }).click();
  await expect(editor.locator('p').nth(0)).toHaveCSS('margin-bottom', '20px');
  await expect(editor.locator('p').nth(1)).toHaveCSS('margin-bottom', '20px');
  await expect(editor.locator('p').nth(2)).toHaveCSS('margin-bottom', '0px');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect((await getEditorSource(page)).match(/spaceAfter: 20/g)).toHaveLength(2);
});

test('soft line breaks stay inside a paragraph while Enter creates a new source owner', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 5);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Soft');
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor.locator('br')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Paragraph');
  await expect(editor.locator('p')).toHaveCount(2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const source = await getEditorSource(page);
  expect(source).toContain('Hello\\nSoft');
  expect((source.match(/Paragraph \{/g) ?? []).length).toBe(2);
});

test('list toolbar creates, numbers, nests, and outdents authored paragraphs', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 5);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await selectRichText(page, 'Hello', 0, 'Second', 6);
  await page.getByLabel('List style', { exact: true }).selectOption('decimal');
  await page.getByLabel('List start', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Apply list', exact: true }).click();
  await expect(editor.locator('ol')).toHaveAttribute('start', '4');
  await expect(editor.locator('li')).toHaveCount(2);
  await selectRichText(page, 'Second', 3);
  await page.getByRole('button', { name: 'Indent item', exact: true }).click();
  await expect(editor.locator('ol ol')).toHaveCount(1);
  await page.getByLabel('List style', { exact: true }).selectOption('square');
  await page.getByRole('button', { name: 'Apply list', exact: true }).click();
  await expect(editor.locator('ol ul')).toHaveCSS('list-style-type', 'square');
  await expect(editor.locator('ol')).toHaveAttribute('start', '4');
  await page.getByRole('button', { name: 'Outdent item', exact: true }).click();
  await expect(editor.locator('ol ul')).toHaveCount(0);
  expect(await getEditorSource(page)).toBe(before);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const source = await getEditorSource(page);
  expect(source).toContain('start: 4');
  expect((source.match(/ListItem \{/g) ?? []).length).toBe(2);
  await page.locator('.sw-canvas-stage').getByText('Second', { exact: true }).dblclick();
  await expect(editor.locator('ol')).toHaveAttribute('start', '4');
  await selectRichText(page, 'Second', 2);
  await page.getByRole('button', { name: 'Outdent item', exact: true }).click();
  await expect(editor.locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await getEditorSource(page)).toContain('Paragraph {');
});

test('formatting feedback follows ranges, tokens, caret styles, and draft undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await selectRichText(page, 'Mixed ', 0, 'style', 5);
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'mixed');
  await page.getByLabel('Text style', { exact: true }).selectOption('weight');
  await expect(page.getByLabel('Current text style', { exact: true })).toHaveText('Mixed');
  await selectRichText(page, 'style', 0, 'style', 5);
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Current text style', { exact: true })).toHaveText('700');
  await page.getByRole('button', { name: 'Italic', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await selectRichText(page, 'style', 2);
  await page.getByLabel('Text style', { exact: true }).selectOption('color');
  await expect(page.getByLabel('Current text style', { exact: true })).toHaveText('accent');
  await expect(page.getByLabel('Formatting target', { exact: true })).toHaveText('Typing at caret');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('whole-box settings join a text draft, preview, cancel, and commit with one undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await page.getByLabel('TextBox setting', { exact: true }).selectOption('fontSize');
  await page.getByLabel('TextBox setting value', { exact: true }).fill('52');
  await page.getByRole('button', { name: 'Apply box setting', exact: true }).click();
  await expect(editor).toHaveCSS('font-size', '52px');
  expect(await getEditorSource(page)).toBe(before);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await getEditorSource(page)).toBe(before);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 5);
  await page.keyboard.type('!');
  await page.getByLabel('TextBox setting value', { exact: true }).fill('48');
  await page.getByRole('button', { name: 'Apply box setting', exact: true }).click();
  await page.getByLabel('TextBox setting', { exact: true }).selectOption('wrap');
  await page.getByLabel('TextBox setting value', { exact: true }).fill('false');
  await page.getByRole('button', { name: 'Apply box setting', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await getEditorSource(page)).toContain('fontSize: 48');
  expect(await getEditorSource(page)).toContain('wrap: false');
  expect(await getEditorSource(page)).toContain('Hello!');
  await page.keyboard.press('Escape');
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

test('selected TextBox defaults materialize through authoring controls without editing content', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).click();
  const before = await getEditorSource(page);
  await page.getByLabel('TextBox setting', { exact: true }).selectOption('font');
  await page.getByLabel('TextBox setting value', { exact: true }).fill('Georgia');
  await page.getByRole('button', { name: 'Apply box setting', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('font: "Georgia"');
  await expect(page.locator('.sw-canvas-stage').getByText('Hello', { exact: true })).toHaveCSS('font-family', 'Georgia');
  expect(await getEditorSource(page)).toContain('"Hello"');
  expect(await getEditorSource(page)).not.toBe(before);
});

test('repeated canvas clicks select the TextBox without drilling into document internals', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  const before = await getEditorSource(page);
  const text = page.locator('.sw-canvas-stage').getByText('style', { exact: true });
  for (let click = 0; click < 3; click++) {
    await text.click();
    await expect(page.locator('.sw-canvas-stage .sw-resize-ne')).toHaveCount(1);
    await expect(page.locator('.sw-canvas-stage .sw-selection-slot')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
  }
  await text.dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await getEditorSource(page)).toBe(before);
});

test('a selected custom element retains its outline while editing a literal slot', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-child-vstack');
  const stage = page.locator('.sw-canvas-stage');
  const before = await getEditorSource(page);
  const card = stage.locator('[data-sw-component="CardRow"]');
  const start = await card.getAttribute('data-sw-span-start');
  await stage.getByText('Single child.', { exact: true }).dblclick();
  await expect(stage.locator('[contenteditable="plaintext-only"]')).toBeFocused();
  const outline = page.locator(`.sw-selection-outline[data-sw-overlay-for-start="${start}"]`);
  await expect(outline).toBeVisible();
  await page.keyboard.type('Updated heading');
  await expect(page.getByRole('dialog', { name: 'Insert element' })).toHaveCount(0);
  await expect(outline).toBeVisible();
  expect(await getEditorSource(page)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(stage.getByText('Single child.', { exact: true })).toBeVisible();
});

test('floating toolbar follows selection and persists font, stroke, and paragraph styles', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting' });
  await expect(toolbar).toBeVisible();
  const bounds = await toolbar.boundingBox();
  const textBounds = await editor.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThan(textBounds!.y);
  await toolbar.getByLabel('Text preset').selectOption('body');
  for (const [label, value] of [['Font size', '42'], ['Foreground color', '#123456'], ['Stroke width', '1.5'], ['Stroke color', '#ff0000'], ['Line height', '1.8'], ['Letter spacing', '2']]) {
    await toolbar.getByLabel(label, { exact: true }).fill(value);
    await page.keyboard.press('Enter');
  }
  await expect(editor.getByText('Hello', { exact: true })).toHaveCSS('-webkit-text-stroke-width', '1.5px');
  await expect(editor.getByText('Hello', { exact: true })).toHaveCSS('line-height', '75.6px');
  expect(await getEditorSource(page)).toBe(before);
  await toolbar.getByRole('button', { name: 'Underline', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const source = await getEditorSource(page);
  expect(source).toContain('strokeWidth: 1.5');
  expect(source).toContain('strokeColor: "#ff0000"');
  expect(source).toContain('font: "body"');
  expect(source).toContain('lineHeight: 1.8');
  await expect(page.locator('.sw-canvas-stage').getByText('Hello', { exact: true })).toHaveCSS('-webkit-text-stroke-color', 'rgb(255, 0, 0)');
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  await expect(toolbar.getByLabel('Stroke width', { exact: true })).toHaveValue('1.5');
  await toolbar.getByRole('button', { name: 'Clear formatting', exact: true }).click();
  await expect(editor.getByText('Hello', { exact: true })).toHaveCSS('-webkit-text-stroke-width', '0px');
  await page.keyboard.press('Escape');
  expect(await getEditorSource(page)).toBe(source);
});

test('floating fields apply on Done and stay inside a resized viewport', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting' });
  await toolbar.getByLabel('Font size', { exact: true }).fill('48');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(await getEditorSource(page)).toContain('size: 48');
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  await page.setViewportSize({ width: 700, height: 650 });
  await expect.poll(async () => {
    const bounds = await toolbar.boundingBox();
    return !!bounds && bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= 692 && bounds.y + bounds.height <= 642;
  }).toBe(true);
  await toolbar.getByLabel('Font size', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

test('custom text color picker retains ranges, authors tokens and OKLCH, and closes independently', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Mixed ', 0, 'style', 5);
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting' });
  await expect(toolbar.locator('input[type="color"]')).toHaveCount(0);
  await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Foreground color picker', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'purple', exact: true }).click();
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue('purple');
  await picker.getByLabel('Lightness', { exact: true }).focus();
  await picker.getByLabel('Hue', { exact: true }).focus();
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue('purple');
  await picker.getByLabel('Lightness', { exact: true }).fill('0.42');
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue(/^oklch\(0.42 /);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(editor).toBeVisible();
  expect(await getEditorSource(page)).toBe(before);
  await toolbar.getByRole('button', { name: 'Stroke color picker', exact: true }).click();
  await page.getByRole('dialog', { name: 'Stroke color picker', exact: true }).getByRole('button', { name: 'purple', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const source = await getEditorSource(page);
  expect(source).toContain('color: oklch(0.42 ');
  expect(source).toContain('strokeColor: purple');
  expect(source).not.toContain('strokeColor: "purple"');
  expect(source).toContain('"First bullet"');
  await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
  await expect(editor).toBeVisible();
  await selectRichText(page, 'style', 0, 'style', 5);
  await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
  await expect(picker.getByLabel('Lightness', { exact: true })).toHaveValue('0.42');
  await page.setViewportSize({ width: 700, height: 650 });
  await expect.poll(async () => {
    const bounds = await picker.boundingBox();
    return !!bounds && bounds.x >= 4 && bounds.y >= 4 && bounds.x + bounds.width <= 696 && bounds.y + bounds.height <= 646;
  }).toBe(true);
  await picker.getByLabel('Lightness', { exact: true }).fill('0.8');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue(/^oklch\(0.42 /);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await getEditorSource(page)).toBe(source);
});

test('text color drags preview continuously, undo together, and restore on pointer cancellation', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting' });
  await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Foreground color picker', exact: true });
  const plane = picker.locator('.sw-color-picker-plane');
  await expect(plane).toBeVisible();
  const box = (await plane.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(editor).toBeVisible();
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue(/^oklch\(/);
  expect(await getEditorSource(page)).toBe(before);
  await page.keyboard.press('Escape');
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue('');
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  const finalColor = await toolbar.getByLabel('Foreground color', { exact: true }).inputValue();
  expect(finalColor).toMatch(/^oklch\(/);
  await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
  await plane.dispatchEvent('pointerdown', { button: 0, clientX: box.x + 200, clientY: box.y + 20 });
  await plane.dispatchEvent('pointercancel');
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue(finalColor);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await getEditorSource(page)).toBe(before);
});

test('floating toolbar dismisses on a caret, cleared DOM selection, and outside pointer presses', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting' });
  await selectRichText(page, 'Hello', 2);
  await expect(toolbar).toHaveCount(0);
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  await expect(toolbar).toBeVisible();
  await toolbar.getByLabel('Font size', { exact: true }).focus();
  await expect(toolbar).toBeVisible();
  await selectRichText(page, 'Hello', 2);
  await expect(toolbar).toHaveCount(0);
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  await expect(toolbar).toBeVisible();
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(toolbar).toHaveCount(0);
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Foreground color picker', exact: true });
  await expect(picker).toBeVisible();
  // A non-focusable outside target need not blur the editor to dismiss the toolbar.
  await page.locator('.sw-main-workspace').dispatchEvent('pointerdown', { button: 0 });
  await expect(toolbar).toHaveCount(0);
  await expect(picker).toHaveCount(0);
  await expect(editor).toBeVisible();
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  await expect(toolbar).toBeVisible();
  await page.locator('.sw-canvas-stage').click({ position: { x: 5, y: 5 } });
  await expect(toolbar).toHaveCount(0);
  expect(await getEditorSource(page)).toBe(before);
});

for (const changed of [false, true]) {
  test(`deselecting a TextBox clears its text selection${changed ? ' and commits its draft without reselecting it' : ''}`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=single-textbox');
    const before = await getEditorSource(page);
    await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
    const editor = page.getByRole('textbox', { name: 'Edit text' });
    await expect(editor).toBeVisible();
    if (changed) {
      await selectRichText(page, 'Hello', 0, 'Hello', 5);
      await page.keyboard.type('Updated');
    }
    const text = changed ? 'Updated' : 'Hello';
    await selectRichText(page, text, 0, text, text.length);
    await expect(page.getByRole('toolbar', { name: 'Selection formatting' })).toBeVisible();
    // Exercise canvas Escape without a preceding contenteditable blur.
    await page.locator('.sw-canvas-stage').dispatchEvent('keydown', { key: 'Escape' });
    await expect(page.locator('.sw-selection-outline')).toHaveCount(0);
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Selection formatting' })).toHaveCount(0);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    if (changed) {
      await expect.poll(() => getEditorSource(page)).toContain('"Updated"');
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(() => getEditorSource(page)).toBe(before);
    } else expect(await getEditorSource(page)).toBe(before);
  });
}

test('selecting another canvas component closes the old text session and retains the new selection', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Updated');
  await selectRichText(page, 'Updated', 0, 'Updated', 7);
  // Dispatch the hierarchy click without DOM focus moving: canvas ownership
  // changes must finish the session independently of contenteditable blur.
  await page.locator('.sw-hierarchy-node').filter({ hasText: 'TextBox' }).nth(1).dispatchEvent('click');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  await expect(page.locator('.sw-hierarchy-node.selected')).toContainText('TextBox');
  await expect(page.locator('.sw-hierarchy-node').filter({ hasText: 'TextBox' }).nth(1)).toHaveClass(/selected/);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await expect.poll(() => getEditorSource(page)).toContain('"Updated"');
});

for (const backwards of [false, true]) {
  test(`recoloring part of an existing Span preserves the ${backwards ? 'backward' : 'forward'} native selection`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=slide-grade-text');
    await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
    const editor = page.getByRole('textbox', { name: 'Edit text' });
    await expect(editor).toBeVisible();
    await selectRichText(page, 'style', 1, 'style', 4);
    if (backwards) await page.evaluate(() => {
      const selection = window.getSelection()!;
      selection.setBaseAndExtent(selection.focusNode!, selection.focusOffset, selection.anchorNode!, selection.anchorOffset);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const selection = () => page.evaluate(() => {
      const selection = window.getSelection()!;
      const root = document.querySelector('.ProseMirror')!;
      const offset = (node: Node | null, end: number) => {
        const range = document.createRange(); range.setStart(root, 0); range.setEnd(node!, end);
        return range.toString().length;
      };
      return { text: selection.toString(), anchor: offset(selection.anchorNode, selection.anchorOffset), focus: offset(selection.focusNode, selection.focusOffset) };
    });
    const original = await selection();
    expect(original.text).toBe('tyl');
    const toolbar = page.getByRole('toolbar', { name: 'Selection formatting' });
    await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Foreground color picker', exact: true });
    await picker.getByRole('button', { name: 'purple', exact: true }).click();
    expect(await selection()).toEqual(original);
    const lightness = picker.getByLabel('Lightness', { exact: true });
    await lightness.fill('0.42');
    await expect(lightness).toBeFocused();
    await lightness.press('Enter');
    await expect(editor.getByText('tyl', { exact: true })).toHaveCSS('color', /^oklch\(0.42 /);
    await expect(editor.getByText('s', { exact: true })).toHaveCSS('color', 'rgb(0, 0, 255)');
    await expect(editor.getByText('e', { exact: true })).toHaveCSS('color', 'rgb(0, 0, 255)');
    await page.keyboard.press('Escape');
    await editor.focus();
    await expect.poll(selection).toEqual(original);
    const color = toolbar.getByLabel('Foreground color', { exact: true });
    await color.fill('#123456');
    await color.press('Enter');
    await expect(color).toBeFocused();
    await editor.focus();
    await expect.poll(selection).toEqual(original);
    await page.keyboard.press('ControlOrMeta+Z');
    expect(await selection()).toEqual(original);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    expect(await getEditorSource(page)).toContain('color: oklch(0.42 ');
  });
}
