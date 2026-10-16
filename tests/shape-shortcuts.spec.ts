import { test, expect, type Page } from '@playwright/test';
import { focusEditor, getEditorSource, openInsertionPicker } from './editor-helpers';

async function draw(page: Page, reverse = false, beforeUp?: () => Promise<void>) {
  const surface = await page.locator('.sw-canvas-stage [data-sw-component="Freeform"] > div').first().boundingBox();
  const canvas = await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox();
  if (!surface || !canvas) throw new Error('Canvas not visible');
  const scale = canvas.width / 1920;
  const start = reverse ? [700, 500] : [300, 200];
  const end = reverse ? [300, 200] : [700, 500];
  await page.mouse.move(surface.x + start[0]! * scale, surface.y + start[1]! * scale);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(surface.x + end[0]! * scale, surface.y + end[1]! * scale, { steps: 10 });
  await beforeUp?.();
  await page.mouse.up();
}

for (const [key, component] of [['t', 'TextBox'], ['r', 'Box'], ['e', 'Line'], ['Shift+e', 'Arrow'], ['o', 'Ellipse']]) {
  test(`${key} arms ${component} and creates source-backed content`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    const before = await getEditorSource(page);
    let undoSource = before;
    await page.keyboard.press(key!);
    await expect(page.locator('.sw-tool-status')).toContainText(component!);
    await draw(page, component === 'Line' || component === 'Arrow');
    const shape = page.locator(`.sw-canvas-stage [data-sw-component="${component}"]`);
    await expect(shape).toHaveCount(1);
    await expect(page.locator('.sw-tool-status')).toHaveCount(0);
    if (component === 'TextBox') {
      await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeFocused();
      undoSource = await getEditorSource(page);
      await page.keyboard.type('New text');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
    }
    const source = await getEditorSource(page);
    expect(source).toContain(`${component} {`);
    if (component === 'Line' || component === 'Arrow') {
      expect(source).toMatch(/x1: 700\s+y1: 500\s+x2: 300\s+y2: 200/);
      await expect(shape.locator('polygon')).toHaveCount(component === 'Arrow' ? 1 : 0);
    }
    if (component === 'Ellipse') {
      await expect(shape.locator(':scope > div')).toHaveCSS('border-radius', '50%');
      expect(source).toMatch(/width: 400\s+height: 300/);
    }
    // Release inspector / Done-button focus so the canvas owns undo.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => getEditorSource(page)).toBe(undoSource);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => getEditorSource(page)).toBe(source);
  });
}

test('shortcuts switch armed tools and Escape cancels without edits', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const before = await getEditorSource(page);
  await page.keyboard.press('r');
  await expect(page.locator('.sw-tool-status')).toContainText('Box');
  await page.keyboard.press('o');
  await expect(page.locator('.sw-tool-status')).toContainText('Ellipse');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sw-tool-status')).toHaveCount(0);
  expect(await getEditorSource(page)).toBe(before);
});

test('shortcuts leave source typing, picker typing, modifiers and composition alone', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await focusEditor(page);
  await page.keyboard.type('// t r e o');
  await expect(page.locator('.sw-tool-status')).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Alt+r');
  await page.locator('.sw-canvas-stage').dispatchEvent('keydown', { key: 'o', isComposing: true });
  await expect(page.locator('.sw-tool-status')).toHaveCount(0);
  await openInsertionPicker(page);
  await page.getByRole('combobox', { name: 'Insert element' }).fill('Ellipse');
  await expect(page.locator('.sw-tool-status')).toHaveCount(0);
  await page.getByRole('option', { name: 'Ellipse', exact: true }).click();
  await expect(page.locator('.sw-tool-status')).toContainText('Ellipse');
});

test('endpoint heads can be changed on either end and survive undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await page.keyboard.press('e');
  await draw(page);
  const line = page.locator('.sw-canvas-stage [data-sw-component="Line"]');
  await expect(line).toHaveCount(1);
  await page.getByRole('combobox', { name: 'startHead', exact: true }).selectOption('arrow');
  await expect(line.locator('polygon[data-line-head="start"]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'endHead', exact: true }).selectOption('circle');
  await expect(line.locator('circle[data-line-head="end"]')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'startHead', exact: true }).selectOption('none');
  await expect(line.locator('polygon')).toHaveCount(0);
  await expect.poll(() => getEditorSource(page)).toMatch(/startHead: "none"\s+endHead: "circle"/);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(line.locator('polygon[data-line-head="start"]')).toHaveCount(1);
});


test('shape keys remain text in a rich-text session', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await page.locator('.sw-canvas-stage [data-sw-component="TextBox"]').dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('t r e E o');
  await expect(editor).toContainText('t r e E o');
  await expect(page.locator('.sw-tool-status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('t r e E o');
});

test('shape keys stay inactive in presentation mode', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const source = await getEditorSource(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  for (const key of ['t', 'r', 'e', 'Shift+e', 'o']) await page.keyboard.press(key);
  await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
  await expect(page.locator('.sw-tool-status')).toHaveCount(0);
  expect(await getEditorSource(page)).toBe(source);
});

test('Ellipse supports body dragging and corner resizing', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await page.keyboard.press('o');
  await draw(page);
  const shape = page.locator('.sw-canvas-stage [data-sw-component="Ellipse"] > div');
  const box = await shape.boundingBox();
  const canvas = await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox();
  if (!box || !canvas) throw new Error('Ellipse not visible');
  const scale = canvas.width / 1920;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(box.x + box.width / 2 + 100 * scale, box.y + box.height / 2 + 50 * scale, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toMatch(/Ellipse \{\s+x: 400\s+y: 250/);
  const handle = await page.locator('.sw-canvas-stage .sw-resize-se').boundingBox();
  if (!handle) throw new Error('Resize handle not visible');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(handle.x + handle.width / 2 + 80 * scale, handle.y + handle.height / 2 + 60 * scale, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toMatch(/width: 480\s+height: 360/);
});

for (const [key, component] of [['r', 'Box'], ['o', 'Ellipse']]) {
  for (const reverse of [false, true]) {
    test(`Shift draws a ${component} with equal sides (${reverse ? 'reverse' : 'forward'})`, async ({ page }) => {
      await page.goto('/canvas.html?fixture=empty-freeform');
      await getEditorSource(page);
      await page.keyboard.press(key!);
      await page.keyboard.down('Shift');
      await draw(page, reverse);
      await page.keyboard.up('Shift');
      const source = await getEditorSource(page);
      expect(source).toMatch(reverse
        ? /x: 300\s+y: 100\s+width: 400\s+height: 400/
        : /x: 300\s+y: 200\s+width: 400\s+height: 400/);
    });
  }
}

for (const [dx, dy, expectedDx, expectedDy] of [
  [300, 50, 300, 0], [300, 200, 250, 250],
  [50, 300, 0, 300], [-200, 300, -250, 250],
  [-300, -50, -300, 0], [-300, -200, -250, -250],
  [-50, -300, 0, -300], [200, -300, 250, -250],
]) {
  test(`Shift snaps a line toward (${dx}, ${dy}) to a compass angle`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    await getEditorSource(page);
    await page.keyboard.press('e');
    const surface = await page.locator('.sw-canvas-stage [data-sw-component="Freeform"] > div').first().boundingBox();
    const canvas = await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox();
    if (!surface || !canvas) throw new Error('Canvas not visible');
    const scale = canvas.width / 1920;
    await page.mouse.move(surface.x + 700 * scale, surface.y + 500 * scale);
    await page.mouse.down();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.move(surface.x + (700 + dx!) * scale, surface.y + (500 + dy!) * scale, { steps: 5 });
    // Shift can be pressed and released with the pointer stationary.
    const preview = page.locator('.sw-canvas-stage line[stroke-dasharray="6 4"]');
    await page.keyboard.down('Shift');
    await expect.poll(async () => Number(await preview.getAttribute('x2'))).toBeCloseTo(700 + expectedDx!, 2);
    await expect.poll(async () => Number(await preview.getAttribute('y2'))).toBeCloseTo(500 + expectedDy!, 2);
    await page.keyboard.up('Shift');
    await expect.poll(async () => Number(await preview.getAttribute('x2'))).toBeCloseTo(700 + dx!, 2);
    await expect.poll(async () => Number(await preview.getAttribute('y2'))).toBeCloseTo(500 + dy!, 2);
    await page.keyboard.down('Shift');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await getEditorSource(page)).toMatch(new RegExp(
      `x1: 700\\s+y1: 500\\s+x2: ${700 + expectedDx!}\\s+y2: ${500 + expectedDy!}`,
    ));
  });
}

test('releasing Shift before pointerup saves unconstrained geometry', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await page.keyboard.press('Shift+e');
  await page.keyboard.down('Shift');
  await draw(page, true, () => page.keyboard.up('Shift'));
  expect(await getEditorSource(page)).toMatch(/x1: 700\s+y1: 500\s+x2: 300\s+y2: 200/);
});

test('Shift also constrains arrow drawing', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await page.keyboard.press('Shift+e');
  await page.keyboard.down('Shift');
  await draw(page, true);
  await page.keyboard.up('Shift');
  expect(await getEditorSource(page)).toMatch(/x1: 700\s+y1: 500\s+x2: 350\s+y2: 150/);
});
