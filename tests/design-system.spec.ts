import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource, selectRichText } from './editor-helpers';

test('active thumbnail keeps its outer selection border through mouse focus and blur', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, `Deck { slides: [
    Slide { label: "One" content: Freeform { children: [] } }
    Slide { label: "Two" content: Freeform { children: [] } }
  ] }`);
  const first = page.getByRole('option', { name: 'Slide 1', exact: true });
  const second = page.getByRole('option', { name: 'Slide 2', exact: true });
  for (const slide of [second, first]) {
    await slide.click();
    await expect(slide).toBeFocused();
    await expect(slide).toHaveCSS('border-color', 'rgb(0, 0, 255)');
    await expect(slide).toHaveCSS('outline-style', 'solid');
    await expect(slide).toHaveCSS('outline-width', '2px');
    await expect(slide).toHaveCSS('outline-color', 'rgb(0, 0, 255)');
    await page.getByRole('button', { name: 'Save draft', exact: true }).focus();
    await expect(slide).toHaveCSS('outline-width', '2px');
    await expect(slide).toHaveCSS('outline-color', 'rgb(0, 0, 255)');
  }
  await expect(second).not.toHaveClass(/active/);
  await expect(second).toHaveCSS('outline-style', 'none');
});

test('boolean switches commit source, preserve comments and undo from the keyboard', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
    Video { x: 300 y: 300 width: 640 height: 360 src: "" loop: true /* keep this */ }
  ] } }] }`);
  await page.locator('.sw-hierarchy-node').filter({ hasText: 'Video' }).click();
  const sidebar = page.getByRole('complementary', { name: 'Element properties' });
  const loop = sidebar.getByRole('switch', { name: 'loop', exact: true });
  await expect(loop).toBeChecked();
  await loop.focus();
  await page.keyboard.press('Space');
  await expect(loop).not.toBeChecked();
  await expect.poll(() => getEditorSource(page)).toContain('loop: false /* keep this */');
  await loop.blur();
  await page.keyboard.press('ControlOrMeta+z');
  await page.locator('.sw-hierarchy-node').filter({ hasText: 'Video' }).click();
  await expect(loop).toBeChecked();
  await expect.poll(() => getEditorSource(page)).toContain('loop: true /* keep this */');

  // Materializing a default changes the native switch to an authored row.
  const muted = sidebar.getByRole('switch', { name: 'muted (default)', exact: true });
  const wasMuted = await muted.isChecked();
  await muted.focus();
  await page.keyboard.press('Space');
  await expect(sidebar.getByRole('switch', { name: 'muted', exact: true })).toBeChecked({ checked: !wasMuted });
  await expect.poll(() => getEditorSource(page)).toContain(`muted: ${!wasMuted}`);
  await expect.poll(() => getEditorSource(page)).toContain('/* keep this */');
});

test('editor tokens and controls leave authored slide styles intact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/canvas.html?fixture=two-boxes');
  const box = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first();
  await expect(box).toBeVisible();
  await expect(box).toHaveCSS('background-color', 'rgb(255, 165, 0)');
  await expect(page.locator('.sw-canvas-stage > .presentation')).toHaveCSS('background-color', 'rgb(232, 232, 232)');
  await expect(page.getByRole('button', { name: 'Present', exact: true })).toHaveCSS('background-color', 'rgb(0, 0, 255)');
  await page.getByRole('combobox', { name: 'PDF pages', exact: true }).selectOption('builds');
  await expect(page.getByRole('combobox', { name: 'PDF pages', exact: true })).toHaveValue('builds');
  await expect(page.locator('.sw-inspector-panel-header').first()).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('.sw-inspector-panel-header').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('custom select supports pointer choice, keyboard navigation and dismissal without accidental changes', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  const select = page.getByRole('combobox', { name: 'PDF pages', exact: true });
  const menu = page.getByRole('listbox', { name: 'PDF pages', exact: true });
  await select.click();
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('box-shadow', 'rgb(0, 0, 0) 4px 4px 0px 0px');
  const builds = menu.getByRole('option', { name: 'Every authored build (including initial)', exact: true });
  await builds.hover();
  await expect(builds).toHaveCSS('background-color', 'rgb(0, 0, 255)');
  await builds.click();
  await expect(select).toHaveValue('builds');
  await expect(select).toBeFocused();
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await expect(select).toHaveValue('builds');
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('final');
  await page.keyboard.type('Every');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('builds');
  await select.click();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await select.click();
  await page.locator('.sw-canvas-status').click();
  await expect(menu).toHaveCount(0);
  await expect(select).toHaveValue('builds');
});

test('custom inspector select commits one source edit and keeps selection for undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
    Line { x1: 300 y1: 300 x2: 800 y2: 600 endHead: "none" }
  ] } }] }`);
  await page.locator('.sw-hierarchy-node').filter({ hasText: 'Line' }).click();
  const select = page.getByRole('complementary', { name: 'Element properties' }).getByRole('combobox', { name: 'endHead', exact: true });
  await select.click();
  await page.getByRole('listbox', { name: 'endHead', exact: true }).getByRole('option', { name: 'circle', exact: true }).click();
  await expect(select).toHaveValue('circle');
  await expect.poll(() => getEditorSource(page)).toContain('endHead: "circle"');
  await expect(page.locator('.sw-hierarchy-node.selected')).toContainText('Line');
  await select.blur();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toContain('endHead: "none"');
});


test('custom preset menu preserves a rich-text range and Escape only dismisses the menu', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = await getEditorSource(page);
  await page.locator('.sw-canvas-stage').getByText('Hello', { exact: true }).dblclick();
  await selectRichText(page, 'Hello', 1, 'Hello', 4);
  const toolbar = page.getByRole('toolbar', { name: 'Selection formatting', exact: true });
  const select = toolbar.getByRole('combobox', { name: 'Text preset', exact: true });
  const menu = page.getByRole('listbox', { name: 'Text preset', exact: true });
  await select.click();
  const custom = menu.getByRole('option', { name: 'Custom', exact: true });
  await expect(custom).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Home');
  await expect(custom).not.toHaveClass(/is-active/);
  await expect(menu.getByRole('option', { name: 'Title', exact: true })).toHaveClass(/is-active/);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await select.click();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1000);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
  await menu.getByRole('option', { name: 'Title', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor.getByText('ell', { exact: true })).toHaveCSS('font-size', '100px');
  expect(await getEditorSource(page)).toBe(before);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('size: 100');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});
