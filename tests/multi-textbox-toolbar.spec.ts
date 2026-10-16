import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const rows = (page: Page) => page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]');
async function selectPair(page: Page) {
  await rows(page).nth(0).click();
  await rows(page).nth(1).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('toolbar', { name: 'TextBox formatting', exact: true }).getByLabel('Formatting target')).toHaveText('2 text boxes');
}
const toolbarFor = (page: Page) => page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });

const simpleSource = `Deck { slides: [Slide { content: Freeform { children: [
  TextBox { x: 200 y: 300 width: 400 height: 200 fontSize: 30 color: purple content: "First" }
  TextBox { x: 800 y: 300 width: 400 height: 200 fontSize: 40 color: amber content: "Second" }
  TextBox { x: 1300 y: 300 width: 400 height: 200 fontSize: 50 content: "Untouched" }
  Box { x: 200 y: 700 width: 200 height: 100 }
] } }] }`;

test('multi-textbox formatting reports differences across boxes and edits only the selection in one undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  await setHostSource(page, simpleSource);
  await selectPair(page);
  const toolbar = toolbarFor(page);
  const size = toolbar.getByLabel('Font size', { exact: true });
  await expect(size).toHaveValue('');
  await expect(size).toHaveAttribute('placeholder', 'Mixed');
  await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveAttribute('placeholder', 'Mixed');
  const stage = page.locator('.sw-canvas-stage');
  const first = stage.getByText('First', { exact: true });
  const second = stage.getByText('Second', { exact: true });
  const rects = await stage.locator('[data-sw-component="TextBox"] > div').evaluateAll(nodes => nodes.slice(0, 2).map(node => {
    const { left, right, top } = node.getBoundingClientRect(); return { left, right, top };
  }));
  const floating = (await toolbar.boundingBox())!;
  expect(floating.y + floating.height).toBeLessThan(Math.min(...rects.map(rect => rect.top)));
  expect(floating.x + floating.width / 2).toBeCloseTo((rects[0]!.left + rects[1]!.right) / 2, 0);
  const before = await getEditorSource(page);
  await size.focus();
  await size.blur();
  expect(await getEditorSource(page)).toBe(before);
  await size.fill('36');
  await page.keyboard.press('Enter');
  for (const text of [first, second]) await expect(text).toHaveCSS('font-size', '36px');
  await expect(stage.getByText('Untouched', { exact: true })).toHaveCSS('font-size', '50px');
  await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 text boxes');
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
  const changed = await getEditorSource(page);
  await size.blur();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => getEditorSource(page)).toBe(changed);
});

test('multi-textbox presets and toggles preserve each structured document and its links and lists', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
  await selectPair(page);
  const toolbar = toolbarFor(page);
  const before = await getEditorSource(page);
  await expect(toolbar.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'mixed');
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click();
  const stage = page.locator('.sw-canvas-stage');
  for (const text of ['style', 'First bullet', 'Structured item', 'list']) {
    await expect(stage.getByText(text, { exact: true })).toHaveCSS('font-weight', '700');
  }
  await expect(toolbar.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click();
  for (const text of ['style', 'First bullet', 'Structured item', 'list']) {
    await expect(stage.getByText(text, { exact: true })).toHaveCSS('font-weight', '400');
  }
  await toolbar.getByLabel('Text preset').selectOption('header');
  for (const text of ['style', 'First bullet', 'Structured item']) {
    await expect(stage.getByText(text, { exact: true })).toHaveCSS('font-size', '76px');
    await expect(stage.getByText(text, { exact: true })).toHaveCSS('font-weight', '700');
  }
  await expect(toolbar.getByLabel('Text preset')).toHaveValue('header');
  const after = await getEditorSource(page);
  expect(after.match(/fontSize: 76/g)).toHaveLength(2);
  expect(after).toContain('href: "https://example.com/rich-text"');
  expect(after).toContain('start: 3');
  expect(after).toContain('start: 2');
  expect(after).toContain('style: "square"');
  expect(after).not.toContain('size: 48');
  expect(after).not.toBe(before);
  // Undo only the preset, leaving the earlier weight edit on both boxes.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(stage.getByText('Structured item', { exact: true })).toHaveCSS('font-size', '34px');
  await expect(stage.getByText('First bullet', { exact: true })).toHaveCSS('font-weight', '400');
});

test('multi-textbox typography includes empty boxes and supports paragraph and inline controls', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
    TextBox { x: 200 y: 300 width: 400 height: 200 content: "" }
    TextBox { x: 800 y: 300 width: 400 height: 200 content: "Second" }
  ] } }] }`);
  await selectPair(page);
  const toolbar = toolbarFor(page);
  await toolbar.getByLabel('Text preset').selectOption('body');
  await expect(toolbar.getByLabel('Font size', { exact: true })).toHaveValue('38');
  expect((await getEditorSource(page)).match(/fontSize: 38/g)).toHaveLength(2);
  await toolbar.getByLabel('Line height', { exact: true }).fill('1.7');
  await page.keyboard.press('Enter');
  await toolbar.getByLabel('Letter spacing', { exact: true }).fill('2');
  await page.keyboard.press('Enter');
  const text = page.locator('.sw-canvas-stage').getByText('Second', { exact: true });
  await expect(text).toHaveCSS('line-height', '64.6px');
  await expect(text).toHaveCSS('letter-spacing', '2px');
  const source = await getEditorSource(page);
  expect(source.match(/lineHeight: 1.7/g)).toHaveLength(2);
  expect(source.match(/letterSpacing: 2/g)).toHaveLength(2);
  expect(source.match(/"Second"/g)).toHaveLength(1);
  await expect(page.locator('.sw-canvas-stage [data-sw-component="TextBox"]').first()).toHaveText('');
  await toolbar.getByRole('button', { name: 'Italic', exact: true }).click();
  await expect(text).toHaveCSS('font-style', 'italic');
  await toolbar.getByLabel('Stroke width', { exact: true }).fill('2');
  await page.keyboard.press('Enter');
  await expect(text).toHaveCSS('-webkit-text-stroke-width', '2px');
  await toolbar.getByRole('button', { name: 'Clear formatting', exact: true }).click();
  await expect(text).toHaveCSS('font-style', 'normal');
  await expect(text).toHaveCSS('-webkit-text-stroke-width', '0px');
});

for (const nested of [false, true]) {
  test(`multi-textbox colors preserve tokens and cancel and undo one drag (${nested ? 'nested' : 'top level'})`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=single-textbox');
    await getEditorSource(page);
    const children = `TextBox { x: 200 y: 300 width: 400 height: 200 color: purple content: "First" }
      TextBox { x: 800 y: 300 width: 400 height: 200 color: amber content: "Second" }`;
    await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
      ${nested ? `Group { x: 100 y: 100 children: [${children}] }` : children}
    ] } }] }`);
    await selectPair(page);
    const toolbar = toolbarFor(page);
    await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Foreground color picker', exact: true });
    const plane = picker.locator('.sw-color-picker-plane');
    const original = await getEditorSource(page);
    let rect = (await plane.boundingBox())!;
    await plane.dispatchEvent('pointerdown', { button: 0, clientX: rect.x + 20, clientY: rect.y + 40 });
    await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 text boxes');
    await plane.dispatchEvent('pointercancel');
    await expect.poll(() => getEditorSource(page)).toBe(original);
    await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveAttribute('placeholder', 'Mixed');
    await picker.getByRole('button', { name: 'purple', exact: true }).click();
    await expect(toolbar.getByLabel('Foreground color', { exact: true })).toHaveValue('purple');
    const before = await getEditorSource(page);
    expect(before.match(/color: purple/g)).toHaveLength(2);
    rect = (await plane.boundingBox())!;
    await page.mouse.move(rect.x + 20, rect.y + 40);
    await page.mouse.down();
    await page.mouse.move(rect.x + 140, rect.y + 90, { steps: 8 });
    await page.mouse.up();
    await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 text boxes');
    const colors = (await getEditorSource(page)).match(/color: oklch\([^)]+\)/g)!;
    expect(colors).toHaveLength(2);
    expect(colors[0]).toBe(colors[1]);
    const channels = colors[0]!.match(/oklch\(([^ ]+) ([^ ]+) /)!;
    expect(Number(channels[1])).toBeCloseTo(1 - 90 / rect.height, 3);
    expect(Number(channels[2])).toBeCloseTo(140 / rect.width * 0.4, 3);
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => getEditorSource(page)).toBe(before);
  });
}

test('text-only multi-selection controls hand back to a single box and dismiss for mixed shape selections', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  await setHostSource(page, simpleSource);
  await selectPair(page);
  const toolbar = toolbarFor(page);
  await toolbar.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
  await rows(page).nth(1).click({ modifiers: ['Shift'] });
  await expect(toolbar.getByLabel('Formatting target')).toHaveText('Whole text box');
  await expect(toolbar.getByLabel('Font size', { exact: true })).toHaveValue('30');
  await expect(page.getByRole('dialog', { name: 'Foreground color picker', exact: true })).toHaveCount(0);
  await rows(page).nth(1).click({ modifiers: ['Shift'] });
  await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').click({ modifiers: ['Shift'] });
  await expect(toolbar).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Shape formatting', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await rows(page).first().click();
  await expect(toolbar).toBeVisible();
  await page.locator('.sw-canvas-stage').getByText('First', { exact: true }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await expect(toolbar).toHaveCount(0);
});
