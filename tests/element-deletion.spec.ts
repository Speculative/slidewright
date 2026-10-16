import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

for (const key of ['Delete', 'Backspace']) {
  test(`${key} removes implicit children and undo restores their authored form`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    // Mix implicit and explicit children under a wrapper, as in authored decks.
    const source = `Deck { slides: [Slide { content: Freeform {
      TextBox { x: 100 y: 100 content: "Remove me" }
      Group { x: 500 y: 100 children: [
        Box { x: 0 y: 0 width: 100 height: 100 }
      ] }
      TextBox { x: 100 y: 400 content: "Keep me" }
    } }] }`;
    await setHostSource(page, source);
    const rows = (name: string) => page.locator(`.sw-hierarchy-node[data-sw-component="${name}"]`);
    await rows('TextBox').first().click();
    await rows('Box').click({ modifiers: ['Shift'] });
    await expect(page.locator('.sw-selection-outline')).toHaveCount(2);
    await page.keyboard.press(key);
    await expect(rows('TextBox')).toHaveCount(1);
    await expect(rows('Box')).toHaveCount(0);
    await expect(rows('Group')).toHaveCount(1);
    const after = await getEditorSource(page);
    expect(after).toContain('Keep me');
    expect(after).not.toContain('Remove me');
    await page.keyboard.press('Control+z');
    await expect.poll(() => getEditorSource(page)).toBe(source);
    await expect(rows('TextBox')).toHaveCount(2);
    await expect(rows('Box')).toHaveCount(1);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => getEditorSource(page)).toBe(after);
  });
}

test('canvas deletion removes the last implicit child', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform {
    TextBox { x: 100 y: 100 content: "Only child" }
  } }] }`);
  const text = page.locator('.sw-canvas-stage [data-sw-component="TextBox"]').first();
  await text.click();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(text).toHaveCount(0);
  expect(await getEditorSource(page)).not.toContain('TextBox');
  await expect(page.locator('.sw-thumb')).toHaveCount(1);
});
