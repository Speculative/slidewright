import { test, expect } from '@playwright/test';
import { getEditorSource } from './editor-helpers';

for (const modifier of ['', 'Shift', 'Control']) {
  test(`slide navigation clears selected build text before rendering (${modifier || 'plain'} click)`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/canvas.html?fixture=keyframe-builds');
    const source = await getEditorSource(page);
    await page.getByRole('option', { name: 'Slide 1 build 1: Focus', exact: true }).click();
    await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').click();
    await expect(page.getByRole('toolbar', { name: 'TextBox formatting', exact: true })).toBeVisible();

    await page.getByRole('option', { name: 'Slide 2', exact: true }).click({
      modifiers: modifier ? [modifier as 'Shift' | 'Control'] : [],
    });
    await expect(page.locator('.sw-canvas-stage')).toContainText('After the diagram');
    await expect(page.getByRole('toolbar', { name: 'TextBox formatting', exact: true })).toHaveCount(0);
    expect(await getEditorSource(page)).toBe(source);

    await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
    await expect(page.getByRole('toolbar', { name: 'TextBox formatting', exact: true })).toHaveCount(0);
    await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').click();
    await expect(page.getByRole('toolbar', { name: 'TextBox formatting', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
