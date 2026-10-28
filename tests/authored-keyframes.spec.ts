import { test, expect } from '@playwright/test';
import { getEditorSource } from './editor-helpers';

test('indented build previews, direction control, and equal-valued pins are source backed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await expect(page.getByRole('option', { name: 'Slide 1 build 1: Focus', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Slide 1 build 1: Focus', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Build controls' })).toContainText('Frame 2 of 3');
  await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').click();
  await expect(page.getByRole('button', { name: 'Keyframe x', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keyframe x', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inherit x', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await getEditorSource(page)).toMatch(/Change\s*\{\s*target:\s*"node"\s*x:\s*100/);
  await page.getByRole('button', { name: 'Inherit x', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keyframe x', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Propagation direction' }).click();
  await expect(page.getByRole('button', { name: 'Propagation direction' })).toContainText('Backward');
  await page.keyboard.press('Alt+Shift+b');
  await expect(page.getByRole('button', { name: 'Propagation direction' })).toContainText('Everywhere');
  await page.keyboard.press('Alt+Shift+b');
  await expect(page.getByRole('button', { name: 'Propagation direction' })).toContainText('Forward');
  expect(errors).toEqual([]);
});

test('add, duplicate, reorder, delete and undo preserve the build sequence', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await page.getByRole('button', { name: 'Add build', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Build controls' })).toContainText('Frame 2 of 4');
  await page.getByRole('button', { name: 'Duplicate frame', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Build controls' })).toContainText('Frame 3 of 5');
  await page.getByRole('button', { name: 'Move build down', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Build controls' })).toContainText('Frame 4 of 5');
  await page.getByRole('button', { name: 'Move build up', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Build controls' })).toContainText('Frame 3 of 5');
  const beforeDelete = await getEditorSource(page);
  await page.getByRole('button', { name: 'Delete build', exact: true }).click();
  await expect(page.locator('.sw-build-thumb')).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.sw-build-thumb')).toHaveCount(4);
  expect(await getEditorSource(page)).toBe(beforeDelete);
  await expect(page.getByRole('toolbar', { name: 'Build controls' })).toContainText('Frame 3 of 5');
});

test('property changes and exiting objects are highlighted and hidden objects can return', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  const source = (await getEditorSource(page)).replace('id: "focus" label: "Focus" changes: []',
    'id: "focus" label: "Focus" changes: [Change { target: "node" x: 240 opacity: 0.3 }]');
  await page.evaluate(source => (window as unknown as { __slidewrightHost: { setSource(source: string): void } }).__slidewrightHost.setSource(source), source);
  await page.getByRole('option', { name: 'Slide 1 build 1: Focus', exact: true }).click();
  await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').click();
  await expect(page.locator('[data-build-property="x"] input')).toHaveValue('240');
  await expect(page.locator('[data-build-property="x"] .sw-build-value-change')).toContainText('100 → 240');
  await expect(page.getByRole('button', { name: 'Select changed Box' })).toBeVisible();
  const hidden = source.replace('x: 240 opacity: 0.3', 'x: 240 visible: false');
  await page.evaluate(source => (window as unknown as { __slidewrightHost: { setSource(source: string): void } }).__slidewrightHost.setSource(source), hidden);
  await expect(page.getByRole('button', { name: 'Select exiting Box' })).toBeVisible();
  await page.getByRole('button', { name: 'Select exiting Box' }).click();
  await expect(page.locator('.sw-hierarchy-node[data-sw-component="Box"]')).toContainText('hidden');
  await page.locator('.sw-hidden-objects summary').click();
  await page.getByRole('button', { name: 'Restore Box · node', exact: true }).click();
  await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Select exiting Box' })).toHaveCount(0);
});

test('audience navigation visits authored frames before advancing slides', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await page.getByRole('option', { name: 'Slide 1 build 2: Return', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.sw-build-controls')).toContainText('Frame 1 of 3');
  const canvas = page.locator('.sw-canvas-stage .presentation-canvas');
  await canvas.click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.sw-build-controls')).toContainText('Frame 2 of 3');
  await canvas.click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.sw-build-controls')).toContainText('Frame 3 of 3');
  await canvas.click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.sw-canvas-stage')).toContainText('After the diagram');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.sw-build-controls')).toContainText('Frame 3 of 3');
});

test('typography defaults can be pinned without reporting a visual change', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await page.getByRole('option', { name: 'Slide 1 build 1: Focus', exact: true }).click();
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').click();
  await page.locator('.sw-additional-keyframes summary').click();
  await page.getByRole('button', { name: 'Keyframe fontSize', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inherit fontSize', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-build-property="fontSize"] .sw-build-value-change')).toHaveCount(0);
  await expect(page.locator('.sw-build-change-indicator')).toHaveCount(0);
  expect(await getEditorSource(page)).toMatch(/target:\s*"caption"\s*fontSize:\s*32/);
});

test('keyboard duplicate and delete target the selected subordinate frame', async ({ page }) => {
  await page.goto('/canvas.html?fixture=keyframe-builds');
  await page.getByRole('option', { name: 'Slide 1 build 1: Focus', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('.sw-build-thumb')).toHaveCount(3);
  await page.keyboard.press('Delete');
  await expect(page.locator('.sw-build-thumb')).toHaveCount(2);
  await expect(page.locator('.sw-thumb-slot')).toHaveCount(2);
});
