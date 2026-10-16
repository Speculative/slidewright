import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource, selectRichText } from './editor-helpers';

test('selected TextBox toolbar formats every run and list item without entering editing', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  const stage = page.locator('.sw-canvas-stage');
  await stage.getByText('style', { exact: true }).click();
  const toolbar = page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByLabel('Formatting target')).toHaveText('Whole text box');
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
  await expect(toolbar.getByLabel('Font size', { exact: true })).toHaveAttribute('placeholder', 'Mixed');
  const box = stage.locator('[data-sw-component="TextBox"]').first();
  const bounds = await box.locator('[data-sw-textbox-content]').boundingBox();
  const floating = await toolbar.boundingBox();
  expect(floating!.y + floating!.height).toBeLessThan(bounds!.y);
  await toolbar.getByLabel('Font size', { exact: true }).fill('36');
  await page.keyboard.press('Enter');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByLabel('Font size', { exact: true })).toHaveValue('36');
  await expect(box.getByText('style', { exact: true })).toHaveCSS('font-size', '36px');
  await expect(box.getByText('First bullet', { exact: true })).toHaveCSS('font-size', '36px');
  await expect(stage.getByText('Structured item', { exact: true })).toHaveCSS('font-size', '34px');
  const source = await getEditorSource(page);
  expect(source).toContain('href: "https://example.com/rich-text"');
  expect(source).toContain('start: 3');
  expect(source).not.toContain('size: 48');
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(box.getByText('First bullet', { exact: true })).toHaveCSS('font-weight', '700');
  await toolbar.getByRole('button', { name: 'Italic', exact: true }).click();
  await expect(box.getByText('style', { exact: true })).toHaveCSS('font-style', 'italic');
  await expect(box.getByText('First bullet', { exact: true })).toHaveCSS('font-style', 'italic');
  await toolbar.getByLabel('Line height', { exact: true }).fill('1.7');
  await page.keyboard.press('Enter');
  await expect(box.getByText('style', { exact: true })).toHaveCSS('line-height', '61.2px');
});

test('whole-box formatting retains selection, supports undo, and hands off to range formatting', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  const text = page.locator('.sw-canvas-stage').getByText('Hello', { exact: true });
  await text.click();
  const whole = page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });
  await expect(whole).toBeVisible();
  await whole.getByLabel('Text preset', { exact: true }).selectOption('header');
  await expect(text).toHaveCSS('font-size', '76px');
  await expect(text).toHaveCSS('font-weight', '700');
  await expect(whole).toBeVisible();
  await text.dblclick();
  await expect(whole).toHaveCount(0);
  await selectRichText(page, 'Hello', 0, 'Hello', 5);
  await expect(page.getByRole('toolbar', { name: 'Selection formatting', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(whole).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await expect(whole).toHaveCount(0);
});

test('whole-box controls style empty text and dismiss for other object selections', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
    TextBox { x: 300 y: 300 width: 600 height: 180 content: "" }
    Box { x: 1100 y: 300 width: 200 height: 200 }
  ] } }] }`);
  const stage = page.locator('.sw-canvas-stage');
  const box = stage.locator('[data-sw-component="TextBox"] > div');
  await box.click({ position: { x: 20, y: 20 } });
  const toolbar = page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });
  await expect(toolbar).toBeVisible();
  await toolbar.getByLabel('Text preset').selectOption('body');
  await expect(toolbar.getByLabel('Text preset')).toHaveValue('body');
  await expect.poll(() => getEditorSource(page)).toContain('fontSize: 38');
  await toolbar.getByLabel('Font size', { exact: true }).fill('52');
  await page.keyboard.press('Enter');
  await expect.poll(() => getEditorSource(page)).toContain('fontSize: 52');
  await expect(toolbar).toBeVisible();
  await stage.locator('[data-sw-component="Box"]').click();
  await expect(toolbar).toHaveCount(0);
});

test('whole-box color picker preserves tokens and groups drag previews into one undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  const text = page.locator('.sw-canvas-stage').getByText('style', { exact: true });
  await text.click();
  const toolbar = page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });
  await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Foreground color picker', exact: true });
  await picker.getByRole('button', { name: 'purple', exact: true }).click();
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue('purple');
  const before = await getEditorSource(page);
  expect(before).toContain('color: purple');
  expect(before).not.toContain('color: accent');
  const plane = picker.locator('.sw-color-picker-plane');
  const bounds = (await plane.boundingBox())!;
  await page.mouse.move(bounds.x + 20, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 140, bounds.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue(/^oklch\(/);
  const final = await getEditorSource(page);
  expect(final).not.toBe(before);
  await plane.dispatchEvent('pointerdown', { button: 0, clientX: bounds.x + 200, clientY: bounds.y + 20 });
  await plane.dispatchEvent('pointercancel');
  await expect.poll(() => getEditorSource(page)).toBe(final);
  await page.keyboard.press('Escape');
  await text.click();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

for (const navigation of ['thumbnail', 'keyboard', 'source cursor'] as const) {
  test(`switching slides via ${navigation} clears the TextBox toolbar and object selection`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=single-textbox');
    const source = `Deck { slides: [
      Slide { label: "First" content: Freeform { children: [TextBox { x: 300 y: 300 width: 600 height: 180 content: "First text" }] } }
      Slide { label: "Second" content: Freeform { children: [TextBox { x: 300 y: 300 width: 600 height: 180 content: "Second text" }] } }
    ] }`;
    await setHostSource(page, source);
    const stage = page.locator('.sw-canvas-stage');
    const toolbar = page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });
    await stage.getByText('First text', { exact: true }).click();
    await expect(toolbar).toBeVisible();
    // Clicking the current slide should keep its object selected.
    await page.locator('.sw-thumb').first().click();
    await expect(toolbar).toBeVisible();
    if (navigation === 'thumbnail') await page.locator('.sw-thumb').nth(1).click();
    else if (navigation === 'keyboard') await page.keyboard.press('ArrowRight');
    else await page.evaluate(offset => (window as unknown as { __slidewrightHost: { setCursor(offset: number): void } }).__slidewrightHost.setCursor(offset), source.indexOf('label: "Second"'));
    await expect(stage.getByText('Second text', { exact: true })).toBeVisible();
    await expect(toolbar).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'TextBox defaults', exact: true })).toHaveCount(0);
    await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(0);
    await expect(page.locator('.sw-selection-outline')).toHaveCount(0);
    await page.locator('.sw-thumb').first().click();
    await expect(stage.getByText('First text', { exact: true })).toBeVisible();
    await expect(toolbar).toHaveCount(0);
    await stage.getByText('First text', { exact: true }).click();
    await expect(toolbar).toBeVisible();
    expect(await getEditorSource(page)).toBe(source);
  });
}

for (const [preset, size, weight] of [['title', 100, '700'], ['header', 76, '700'], ['body', 38, '400']] as const) {
  test(`${preset} preset styles mixed TextBox content in one undo step`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=slide-grade-text');
    const before = await getEditorSource(page);
    const stage = page.locator('.sw-canvas-stage');
    await stage.getByText('style', { exact: true }).click();
    const toolbar = page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });
    const presets = toolbar.getByRole('combobox', { name: 'Text preset' });
    await expect(presets).toHaveValue('');
    await presets.selectOption(preset);
    await expect(presets).toHaveValue(preset);
    for (const text of ['style', 'First bullet']) {
      await expect(stage.getByText(text, { exact: true })).toHaveCSS('font-size', `${size}px`);
      await expect(stage.getByText(text, { exact: true })).toHaveCSS('font-weight', weight);
    }
    const source = await getEditorSource(page);
    expect(source).toContain(`fontSize: ${size}`);
    expect(source).toContain('href: "https://example.com/rich-text"');
    expect(source).toContain('start: 3');
    expect(source).not.toContain('size: 48');
    await expect(stage.getByText('Structured item', { exact: true })).toHaveCSS('font-size', '34px');
    await toolbar.getByLabel('Font size', { exact: true }).fill('43');
    await page.keyboard.press('Enter');
    await expect(presets).toHaveValue('');
    await toolbar.getByLabel('Font size', { exact: true }).blur();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => getEditorSource(page)).toBe(source);
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => getEditorSource(page)).toBe(before);
  });
}

test('range presets preserve surrounding text, undo atomically, cancel and commit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  const text = page.locator('.sw-canvas-stage').getByText('Hello', { exact: true });
  await text.dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await selectRichText(page, 'Hello', 1, 'Hello', 4);
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting', exact: true });
  await toolbar.getByLabel('Text preset').selectOption('title');
  await expect(editor.getByText('ell', { exact: true })).toHaveCSS('font-size', '100px');
  await expect(toolbar.getByLabel('Text preset')).toHaveValue('title');
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor.getByText('Hello', { exact: true })).toBeVisible();
  await selectRichText(page, 'Hello', 1, 'Hello', 4);
  await toolbar.getByLabel('Text preset').selectOption('body');
  await page.keyboard.press('Escape');
  expect(await getEditorSource(page)).toBe(before);
  await text.dblclick();
  await selectRichText(page, 'Hello', 1, 'Hello', 4);
  await toolbar.getByLabel('Text preset').selectOption('header');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const source = await getEditorSource(page);
  expect(source).toContain('size: 76');
  expect(source).toContain('"H"');
  expect(source).toContain('"o"');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});
