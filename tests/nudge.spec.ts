import { test, expect, type Page } from '@playwright/test';
import { focusEditor, getEditorSource, setHostSource } from './editor-helpers';

const rows = (page: Page, name: string) => page.locator(`.sw-hierarchy-node[data-sw-component="${name}"]`);

test('arrows nudge selected siblings, preserve selection and undo each step', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await setHostSource(page, `Deck { slides: [
    Slide { content: Freeform { children: [
      Box { x: 200.5 y: 200 width: 200 height: 150 }
      Box { x: 800 y: 500 width: 200 height: 150 }
    ] } }
    Slide { content: Freeform {} }
  ] }`);
  await rows(page, 'Box').first().click();
  await rows(page, 'Box').nth(1).click({ modifiers: ['Shift'] });
  const original = await getEditorSource(page);
  for (const [key, first, second] of [
    ['ArrowRight', /x: 201.5[,\s]+y: 200/, /x: 801[,\s]+y: 500/],
    ['ArrowDown', /x: 201.5[,\s]+y: 201/, /x: 801[,\s]+y: 501/],
    ['Shift+ArrowLeft', /x: 191.5[,\s]+y: 201/, /x: 791[,\s]+y: 501/],
    ['Shift+ArrowUp', /x: 191.5[,\s]+y: 191/, /x: 791[,\s]+y: 491/],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => getEditorSource(page)).toMatch(first);
    expect(await getEditorSource(page)).toMatch(second);
    await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(2);
    await expect(rows(page, 'Box')).toHaveCount(2);
  }
  const moved = await getEditorSource(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toBe(original);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => getEditorSource(page)).toBe(moved);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  await expect(rows(page, 'Box')).toHaveCount(0);
});

test('nudging supports arrow endpoints, default positions and nested groups', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-arrow');
  await rows(page, 'Arrow').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => getEditorSource(page)).toMatch(/x1: 410[,\s]+y1: 299[,\s]+x2: 810[,\s]+y2: 599/);
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform {
    Group { x: 300 y: 200 children: [ Box { width: 200 height: 150 } ] }
  } }] }`);
  await rows(page, 'Box').click();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => getEditorSource(page)).toMatch(/Box \{[^}]*x: -1/);
  await rows(page, 'Group').click();
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => getEditorSource(page)).toMatch(/Group \{\s+x: 300[,\s]+y: 210/);
  expect(await getEditorSource(page)).toMatch(/Box \{[^}]*x: -1/);
});

test('arrows leave editing, composition and presentation alone', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const box = page.locator('.sw-canvas-stage [data-sw-component="TextBox"]');
  await box.click();
  const original = await getEditorSource(page);
  await focusEditor(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await getEditorSource(page)).toBe(original);
  await rows(page, 'TextBox').click();
  await page.locator('.sw-canvas-stage').dispatchEvent('keydown', { key: 'ArrowRight', isComposing: true });
  await page.keyboard.press('Alt+ArrowRight');
  expect(await getEditorSource(page)).toBe(original);
  await box.dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(editor).toBeFocused();
  expect(await getEditorSource(page)).toBe(original);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
  expect(await getEditorSource(page)).toBe(original);
});

test('held arrows repeat and flow-layout children remain positioned by their layout', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await rows(page, 'Box').first().click();
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  await expect.poll(() => getEditorSource(page)).toMatch(/x: 203[,\s]+y: 200/);
  const source = `Deck { slides: [Slide { content: Freeform {
    Group { children: [VStack { children: [Box { width: 200 height: 150 }] }] }
  } }] }`;
  await setHostSource(page, source);
  await rows(page, 'Box').click();
  await page.keyboard.press('Shift+ArrowDown');
  expect(await getEditorSource(page)).toBe(source);
});
