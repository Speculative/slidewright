import { expect, test, type Page } from '@playwright/test';
import { getEditorSource, openInsertionPicker, setHostSource } from './editor-helpers';

async function placeText(page: Page) {
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  await openInsertionPicker(page);
  await page.locator('.sw-tool', { hasText: /^TextBox$/ }).click();
  const canvas = (await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width * .1, canvas.y + canvas.height * .15);
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('');
  return editor;
}

for (const dismissal of ['Done', 'Escape', 'blur'] as const) {
  test(`empty click-placed text is deleted on ${dismissal}`, async ({ page }) => {
    await placeText(page);
    await expect(page.locator('.sw-canvas-stage [data-sw-component="TextBox"]')).toHaveCount(2);
    if (dismissal === 'Done') await page.getByRole('button', { name: 'Done', exact: true }).click();
    else if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await page.locator('.sw-editor-view .cm-content').click();
    await expect(page.locator('.sw-canvas-stage [data-sw-component="TextBox"]')).toHaveCount(1);
    expect(await getEditorSource(page)).not.toContain('sizing: "auto-width"');
  });
}

test('placement accepts typing immediately and retains authored content on dismissal', async ({ page }) => {
  await placeText(page);
  await page.keyboard.type('Immediate text');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => getEditorSource(page)).toContain('"Immediate text"');
  expect(await getEditorSource(page)).not.toMatch(/"Immediate text"\s*,?\s*""/);
  await expect(page.locator('.sw-canvas-stage [data-sw-component="TextBox"]')).toHaveCount(2);
});

for (const implicit of [false, true]) {
  test(`clearing an existing direct Freeform child deletes it (${implicit ? 'implicit' : 'explicit'}) and preserves sibling selection`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=single-textbox');
    await getEditorSource(page);
    const children = 'TextBox { x: 300 y: 200 content: "Delete me" } Box { x: 800 y: 200 width: 150 height: 150 }';
    await setHostSource(page, `Deck { slides: [Slide { content: Freeform { ${implicit ? children : `children: [${children}]`} } }] }`);
    await page.locator('.sw-canvas-stage [data-sw-textbox-content]').dblclick();
    await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.locator('.sw-hierarchy-node').filter({ hasText: /^Box$/ }).dispatchEvent('click');
    await expect(page.locator('.sw-canvas-stage [data-sw-component="TextBox"]')).toHaveCount(0);
    await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
    await expect.poll(() => getEditorSource(page)).not.toContain('TextBox');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => getEditorSource(page)).toContain('"Delete me"');
  });
}

for (const wrapper of ['Group', 'VStack']) {
  test(`empty TextBoxes inside ${wrapper} survive dismissal`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=single-textbox');
    await getEditorSource(page);
    await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [${wrapper} { children: [TextBox { x: 300 y: 200 width: 320 height: 120 content: "" }] }] } }] }`);
    await page.locator('.sw-canvas-stage [data-sw-textbox-content]').dblclick({ position: { x: 12, y: 12 } });
    await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeFocused();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
    await expect(page.locator('.sw-canvas-stage [data-sw-component="TextBox"]')).toHaveCount(1);
  });
}

test('external replacement cancels an empty session without writing over the new source', async ({ page }) => {
  await placeText(page);
  const replacement = 'Deck { slides: [Slide { content: Freeform { children: [] } }] }';
  await setHostSource(page, replacement);
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toHaveCount(0);
  await expect.poll(() => getEditorSource(page)).toBe(replacement);
});

test('cancelling a cleared draft retains the existing authored text', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await page.locator('.sw-canvas-stage [data-sw-textbox-content]').dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sw-canvas-stage [data-sw-textbox-content]')).toHaveText('Hello');
});

test('setting unchanged source leaves the empty session intact', async ({ page }) => {
  await placeText(page);
  const source = await getEditorSource(page);
  await setHostSource(page, source);
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeFocused();
  await expect(page.locator('.sw-canvas-stage [data-sw-component="TextBox"]')).toHaveCount(2);
  expect(await getEditorSource(page)).toBe(source);
});
