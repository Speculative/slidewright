import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const source = `Deck { slides: [Slide { content: Freeform { children: [
  Box { x: 300 y: 300 width: 300 height: 200 }
  Ellipse { x: 800 y: 300 width: 300 height: 200 }
  Line { x1: 300 y1: 700 x2: 650 y2: 600 }
  Arrow { x1: 850 y1: 600 x2: 1200 y2: 700 }
  TextBox { x: 1300 y: 300 width: 300 height: 200 content: "Text" }
] } }] }`;

for (const kind of ['Box', 'Ellipse']) {
  test(`${kind} floating controls edit fill and stroke, preserve selection and undo`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    await getEditorSource(page);
    await setHostSource(page, source);
    const shape = page.locator(`.sw-canvas-stage [data-sw-component="${kind}"] > div`);
    await shape.click();
    const toolbar = page.getByRole('toolbar', { name: 'Shape formatting' });
    await expect(toolbar).toBeVisible();
    const rect = (await shape.boundingBox())!;
    const floating = (await toolbar.boundingBox())!;
    expect(floating.y + floating.height).toBeLessThan(rect.y);
    await toolbar.getByLabel('Fill color', { exact: true }).fill('#ff0000');
    await page.keyboard.press('Enter');
    await expect(shape).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    await expect(toolbar).toBeVisible();
    await toolbar.getByLabel('Stroke color', { exact: true }).fill('purple');
    await page.keyboard.press('Enter');
    await expect.poll(() => getEditorSource(page)).toContain('borderColor: purple');
    await toolbar.getByLabel('Stroke width', { exact: true }).fill('12');
    await page.keyboard.press('Enter');
    await expect(shape).toHaveCSS('border-width', '12px');
    const after = await getEditorSource(page);
    await toolbar.getByLabel('Stroke width', { exact: true }).fill('-3');
    await page.keyboard.press('Enter');
    await expect(toolbar.getByLabel('Stroke width', { exact: true })).toHaveValue('12');
    expect(await getEditorSource(page)).toBe(after);
    await toolbar.getByLabel('Stroke width', { exact: true }).blur();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(shape).toHaveCSS('border-width', '4px');
    await shape.click();
    await page.locator('.sw-canvas-stage').getByText('Text', { exact: true }).click();
    await expect(toolbar).toHaveCount(0);
  });
}

for (const kind of ['Line', 'Arrow']) {
  test(`${kind} floating controls edit either head and anchor to endpoints`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    await getEditorSource(page);
    await setHostSource(page, source);
    const shape = page.locator(`.sw-canvas-stage [data-sw-component="${kind}"]`);
    const hit = shape.locator('line').last();
    const rect = (await hit.boundingBox())!;
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const toolbar = page.getByRole('toolbar', { name: 'Shape formatting' });
    await expect(toolbar).toBeVisible();
    const floating = (await toolbar.boundingBox())!;
    expect(floating.y + floating.height).toBeLessThan(rect.y);
    await expect(toolbar.getByLabel('Fill color', { exact: true })).toHaveCount(0);
    await expect(toolbar.getByLabel('End head')).toHaveValue(kind === 'Arrow' ? 'arrow' : 'none');
    await toolbar.getByLabel('Start head').selectOption('arrow');
    await toolbar.getByLabel('End head').selectOption('circle');
    await expect(shape.locator('polygon[data-line-head="start"]')).toHaveCount(1);
    await expect(shape.locator('circle[data-line-head="end"]')).toHaveCount(1);
    await toolbar.getByLabel('Stroke color', { exact: true }).fill('#ff0000');
    await page.keyboard.press('Enter');
    await expect(shape.locator('line').first()).toHaveAttribute('stroke', '#ff0000');
    await toolbar.getByLabel('Stroke width').fill('9');
    await page.keyboard.press('Enter');
    await expect(shape.locator('line').first()).toHaveAttribute('stroke-width', '9');
    await toolbar.getByLabel('Start head').selectOption('none');
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await expect(shape.locator('polygon')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(shape.locator('polygon[data-line-head="start"]')).toHaveCount(1);
  });
}

test('shape color palette preserves tokens and picker previews cancel and undo atomically', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const shape = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div');
  await shape.click();
  const toolbar = page.getByRole('toolbar', { name: 'Shape formatting' });
  await toolbar.getByRole('button', { name: 'Fill color picker', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Fill color picker', exact: true });
  await picker.getByRole('button', { name: 'purple', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('fill: purple');
  const before = await getEditorSource(page);
  const plane = picker.locator('.sw-color-picker-plane');
  const rect = (await plane.boundingBox())!;
  await page.mouse.move(rect.x + 20, rect.y + 40);
  await page.mouse.down();
  await page.mouse.move(rect.x + 140, rect.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(toolbar.getByLabel('Fill color', { exact: true })).toHaveValue(/^oklch\(/);
  const final = await getEditorSource(page);
  expect(final).not.toBe(before);
  const color = await toolbar.getByLabel('Fill color', { exact: true }).inputValue();
  const channels = color.match(/^oklch\(([^ ]+) ([^ ]+) /)!;
  expect(Number(channels[1])).toBeCloseTo(1 - 90 / rect.height, 3);
  expect(Number(channels[2])).toBeCloseTo(140 / rect.width * 0.4, 3);
  await plane.dispatchEvent('pointerdown', { button: 0, clientX: rect.x + 200, clientY: rect.y + 20 });
  await plane.dispatchEvent('pointercancel');
  await expect.poll(() => getEditorSource(page)).toBe(final);
  await page.keyboard.press('Escape');
  await shape.click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await shape.click();
  await toolbar.getByRole('button', { name: 'Fill color picker', exact: true }).click();
  await picker.getByRole('button', { name: 'No color', exact: true }).click();
  await expect(shape).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('shape controls follow single and multiple selections and dismiss for presentation', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const stage = page.locator('.sw-canvas-stage');
  const box = stage.locator('[data-sw-component="Box"] > div');
  const ellipse = stage.locator('[data-sw-component="Ellipse"] > div');
  const toolbar = page.getByRole('toolbar', { name: 'Shape formatting' });
  await box.click();
  await toolbar.getByLabel('Fill color', { exact: true }).fill('purple');
  await page.keyboard.press('Enter');
  await toolbar.getByRole('button', { name: 'Fill color picker', exact: true }).click();
  await ellipse.click();
  await expect(page.getByRole('dialog', { name: 'Fill color picker', exact: true })).toHaveCount(0);
  await expect(toolbar.getByLabel('Fill color', { exact: true })).toHaveValue('accent');
  await box.click({ modifiers: ['Shift'] });
  await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 shapes');
  await expect(toolbar.getByLabel('Fill color', { exact: true })).toHaveAttribute('placeholder', 'Mixed');
  await page.keyboard.press('Escape');
  await ellipse.click();
  await expect(toolbar).toBeVisible();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(toolbar).toHaveCount(0);
});

test('multiple area shapes share fill and stroke controls with mixed feedback and atomic undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source.replace('width: 300 height: 200 }', 'width: 300 height: 200 fill: purple borderWidth: 12 }'));
  const stage = page.locator('.sw-canvas-stage');
  const box = stage.locator('[data-sw-component="Box"] > div');
  const ellipse = stage.locator('[data-sw-component="Ellipse"] > div');
  await box.click();
  await ellipse.click({ modifiers: ['Shift'] });
  const toolbar = page.getByRole('toolbar', { name: 'Shape formatting' });
  await expect(toolbar.getByLabel('Fill color', { exact: true })).toHaveAttribute('placeholder', 'Mixed');
  const width = toolbar.getByLabel('Stroke width', { exact: true });
  await expect(width).toHaveValue('');
  await expect(width).toHaveAttribute('placeholder', 'Mixed');
  await expect(toolbar.getByLabel('Start head')).toHaveCount(0);
  const b = (await box.boundingBox())!, e = (await ellipse.boundingBox())!;
  const floating = (await toolbar.boundingBox())!;
  expect(floating.y + floating.height).toBeLessThan(Math.min(b.y, e.y));
  expect(floating.x + floating.width / 2).toBeCloseTo((b.x + e.x + e.width) / 2, 0);
  const before = await getEditorSource(page);
  // Tabbing through an untouched mixed field must not author a value.
  await width.focus();
  await width.blur();
  expect(await getEditorSource(page)).toBe(before);
  await width.fill('7');
  await page.keyboard.press('Enter');
  for (const shape of [box, ellipse]) await expect(shape).toHaveCSS('border-width', '7px');
  await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 shapes');
  await width.blur();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  for (const shape of [box, ellipse]) await expect(shape).toHaveCSS('border-width', '7px');
});

test('mixed rectangle and line selection exposes only common stroke controls', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const row = (name: string) => page.locator(`.sw-hierarchy-node[data-sw-component="${name}"]`);
  await row('Box').click();
  await row('Line').click({ modifiers: ['Shift'] });
  const toolbar = page.getByRole('toolbar', { name: 'Shape formatting' });
  await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 shapes');
  await expect(toolbar.getByLabel('Fill color', { exact: true })).toHaveCount(0);
  await expect(toolbar.getByLabel('Start head')).toHaveCount(0);
  await expect(toolbar.getByLabel('End head')).toHaveCount(0);
  const before = await getEditorSource(page);
  await toolbar.getByLabel('Stroke color', { exact: true }).fill('purple');
  await page.keyboard.press('Enter');
  const after = await getEditorSource(page);
  expect(after).toContain('borderColor: purple');
  expect(after).toContain('color: purple');
  expect(after).not.toContain('fill: purple');
  const stage = page.locator('.sw-canvas-stage');
  await expect(stage.locator('[data-sw-component="Line"] line').first()).toHaveAttribute('stroke', 'var(--purple)');
  await expect(stage.locator('[data-sw-component="Ellipse"] > div')).toHaveCSS('border-width', '4px');
  await toolbar.getByLabel('Stroke color', { exact: true }).blur();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await row('Box').click();
  await row('Line').click({ modifiers: ['Shift'] });
  await toolbar.getByLabel('Stroke width').fill('9');
  await page.keyboard.press('Enter');
  await expect(stage.locator('[data-sw-component="Box"] > div')).toHaveCSS('border-width', '9px');
  await expect(stage.locator('[data-sw-component="Line"] line').first()).toHaveAttribute('stroke-width', '9');
  // Adding an object without common shape styling dismisses these controls.
  await row('TextBox').click({ modifiers: ['Shift'] });
  await expect(toolbar).toHaveCount(0);
});

test('multiple lines show mixed heads and apply each head independently to all lines', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  await page.locator('.sw-hierarchy-node[data-sw-component="Line"]').click();
  await page.locator('.sw-hierarchy-node[data-sw-component="Arrow"]').click({ modifiers: ['Shift'] });
  const toolbar = page.getByRole('toolbar', { name: 'Shape formatting' });
  await expect(toolbar.getByLabel('Start head')).toHaveValue('none');
  await expect(toolbar.getByLabel('End head')).toHaveValue('');
  await expect(toolbar.getByLabel('End head').locator('option:checked')).toHaveText('Mixed');
  const before = await getEditorSource(page);
  await toolbar.getByLabel('End head').selectOption('circle');
  const circles = page.locator('.sw-canvas-stage circle[data-line-head="end"]');
  await expect(circles).toHaveCount(2);
  await toolbar.getByLabel('Start head').selectOption('arrow');
  await expect(page.locator('.sw-canvas-stage polygon[data-line-head="start"]')).toHaveCount(2);
  await expect(circles).toHaveCount(2);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.sw-canvas-stage polygon[data-line-head="start"]')).toHaveCount(0);
  await expect(circles).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

for (const nested of [false, true]) {
  test(`multi-shape color drag preserves selection, cancels and undoes atomically (${nested ? 'nested' : 'top level'})`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=empty-freeform');
    await getEditorSource(page);
    const children = `Box { x: 200 y: 300 width: 300 height: 200 fill: purple }
      Ellipse { x: 700 y: 300 width: 300 height: 200 fill: amber }`;
    await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
      ${nested ? `Group { x: 100 y: 100 children: [${children}] }` : children}
    ] } }] }`);
    const boxRow = page.locator('.sw-hierarchy-node[data-sw-component="Box"]');
    const ellipseRow = page.locator('.sw-hierarchy-node[data-sw-component="Ellipse"]');
    await boxRow.click();
    await ellipseRow.click({ modifiers: ['Shift'] });
    const toolbar = page.getByRole('toolbar', { name: 'Shape formatting' });
    await expect(toolbar.getByLabel('Fill color', { exact: true })).toHaveAttribute('placeholder', 'Mixed');
    await toolbar.getByRole('button', { name: 'Fill color picker', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Fill color picker', exact: true });
    const plane = picker.locator('.sw-color-picker-plane');
    const before = await getEditorSource(page);
    let rect = (await plane.boundingBox())!;
    await plane.dispatchEvent('pointerdown', { button: 0, clientX: rect.x + 20, clientY: rect.y + 40 });
    await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 shapes');
    await plane.dispatchEvent('pointercancel');
    await expect.poll(() => getEditorSource(page)).toBe(before);
    await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 shapes');
    await expect(toolbar.getByLabel('Fill color', { exact: true })).toHaveAttribute('placeholder', 'Mixed');
    rect = (await plane.boundingBox())!;
    await page.mouse.move(rect.x + 20, rect.y + 40);
    await page.mouse.down();
    await page.mouse.move(rect.x + 140, rect.y + 90, { steps: 8 });
    await page.mouse.up();
    await expect(toolbar.getByLabel('Formatting target')).toHaveText('2 shapes');
    const fills = (await getEditorSource(page)).match(/fill: oklch\([^)]+\)/g)!;
    expect(fills).toHaveLength(2);
    expect(fills[0]).toBe(fills[1]);
    const channels = fills[0]!.match(/oklch\(([^ ]+) ([^ ]+) /)!;
    expect(Number(channels[1])).toBeCloseTo(1 - 90 / rect.height, 3);
    expect(Number(channels[2])).toBeCloseTo(140 / rect.width * 0.4, 3);
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => getEditorSource(page)).toBe(before);
  });
}
