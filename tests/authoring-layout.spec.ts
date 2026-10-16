import { test, expect } from '@playwright/test';
import { openInsertionPicker, getEditorSource, setHostSource } from './editor-helpers';

test('insertion search ranks names above description matches and confirms the best result', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const search = page.getByRole('combobox', { name: 'Insert element' });
  const results = page.getByRole('listbox', { name: 'Elements' }).getByRole('option');
  await openInsertionPicker(page);
  await search.fill('text');
  await expect(results.first()).toHaveText('TextBox');
  await expect(page.getByRole('option', { name: 'CardRow', exact: true })).toBeVisible();
  await expect(results.first()).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(page.locator('.sw-tool-status')).toContainText('Draw TextBox');
  await openInsertionPicker(page);
  await search.fill(' BOX ');
  await expect(results.first()).toHaveText('Box');
  await expect(page.getByRole('option', { name: 'TextBox', exact: true })).toBeVisible();
});

test('insertion search supports hotkey, keyboard choice, empty results and Escape', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const search = page.getByRole('combobox', { name: 'Insert element' });
  await expect(page.getByRole('listbox', { name: 'Elements' })).toHaveCount(0);
  await expect(page.locator('.sw-canvas-stage')).toBeVisible();
  await page.keyboard.press('i');
  await expect(search).toBeFocused();
  await search.fill('stack');
  await expect(page.getByRole('listbox', { name: 'Elements' }).getByRole('option')).toHaveText(['VStack', 'HStack']);
  await search.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'HStack', exact: true })).toHaveAttribute('aria-selected', 'true');
  await openInsertionPicker(page);
  await search.fill('nothing-matches');
  await search.press('Enter');
  await expect(page.getByText('No matching elements')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveCount(0);
  await expect.poll(() => getEditorSource(page)).not.toContain('Box {');
  await openInsertionPicker(page);
  await search.fill('Box');
  await search.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Draw Box' })).toBeVisible();
  await expect(search).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: 'Draw Box' })).toHaveCount(0);
});

test('palette confirmation fills a selected compatible empty slot', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-block-slot');
  const slot = page.locator('.sw-canvas-stage [data-sw-slot-name="body"][data-sw-slot-empty="true"] > *').first();
  await slot.click();
  await slot.click(); // Drill through the slide to its empty slot.
  const search = page.getByRole('combobox', { name: 'Insert element' });
  await openInsertionPicker(page);
  await search.fill('VStack');
  await search.press('Enter');
  await expect.poll(() => getEditorSource(page)).toMatch(/body:\s*VStack\s*\{/);
  await expect(page.locator('.sw-hierarchy-node.selected[data-sw-component="VStack"]')).toHaveCount(1);
});

test('palette confirmation arms click placement when no slot is selected', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-block-slot');
  const search = page.getByRole('combobox', { name: 'Insert element' });
  await openInsertionPicker(page);
  await search.fill('VStack');
  await search.press('Enter');
  await expect(page.getByText('Click a compatible slot or gap', { exact: false })).toBeVisible();
  await page.locator('.sw-canvas-stage [data-sw-slot-name="body"][data-sw-slot-empty="true"] > *').first().click();
  await expect.poll(() => getEditorSource(page)).toMatch(/body:\s*VStack\s*\{/);
  await expect(page.locator('.sw-hierarchy-node.selected[data-sw-component="VStack"]')).toHaveCount(1);
});

for (const [component, selectFirst] of [
  ['Freeform', false], ['Freeform', true],
  ['ContentSlide', false], ['ContentSlide', true],
] as const) {
test(`${component} fills a new slide content slot (${selectFirst ? 'slot first' : 'picker first'})`, async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  await page.locator('.sw-add-slide').click();
  const content = page.locator('.sw-canvas-stage [data-sw-slot-name="content"][data-sw-slot-empty="true"] > *').first();
  if (selectFirst) {
    await content.click();
    await content.click(); // Drill through the slide to its empty slot.
  }
  const before = await getEditorSource(page);
  await openInsertionPicker(page);
  await page.getByRole('option', { name: component, exact: true }).click();
  if (!selectFirst) {
    await expect(page.getByText('Click a compatible slot or gap', { exact: false })).toBeVisible();
    await content.click();
  }
  await expect.poll(() => getEditorSource(page)).toMatch(new RegExp(`Slide\\s*\\{\\s*content:\\s*${component}\\s*\\{`));
  await expect(content).toHaveCount(0);
  // Slide components share the Slide hierarchy row; plain blocks keep theirs.
  const selectedRow = component === 'ContentSlide'
    ? '.sw-hierarchy-slide-row.selected'
    : `.sw-hierarchy-node.selected[data-sw-component="${component}"]`;
  await expect(page.locator(selectedRow)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});
}

test('properties and bottom panes stay visible without selection or panel-hiding buttons', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await page.locator('.sw-hierarchy-node[data-sw-adapter-kind="shape"]').first().click();
  await expect(page.locator('.sw-authoring-bar')).toHaveCount(0);
  const sidebar = page.getByRole('complementary', { name: 'Element properties' });
  await expect(sidebar.locator('.sw-properties-panel')).toBeVisible();
  const sidebarBounds = await sidebar.boundingBox();
  const canvasBounds = await page.locator('.sw-canvas-stage').boundingBox();
  expect(sidebarBounds!.x).toBeGreaterThanOrEqual(canvasBounds!.x + canvasBounds!.width);
  await page.getByRole('tab', { name: 'Slide 1', exact: true }).click();
  await expect(page.locator('.sw-hierarchy-panel')).toBeVisible();
  await expect(page.locator('.sw-editor-pane')).toBeVisible();
  await expect(page.locator('.sw-canvas-bottom-strip')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Slide 1', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^(Select|Cancel insertion|Bottom dock|Properties|Hierarchy|Source \/ Notes)$/ })).toHaveCount(0);
});

test('alignment uses selection or container and preserves selection in one undo step', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  const rows = page.locator('.sw-hierarchy-node[data-sw-adapter-kind="shape"]');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  const before = await getEditorSource(page);
  await page.getByRole('button', { name: 'Align left', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 200[^}]+\}\s*Box\s*\{\s*x: 200/s);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Distribute horizontal space' })).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await rows.nth(0).click();
  await page.getByRole('button', { name: 'Align left', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 0/);
});

test('distribution equalizes gaps for different sizes while retaining outer objects', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await setHostSource(page, `Deck { name: "Arrange" slides: [ Slide { content: Freeform { children: [
    Box { x: 100, y: 100, width: 100, height: 100 }
    Box { x: 300, y: 250, width: 200, height: 200 }
    Box { x: 1000, y: 800, width: 300, height: 100 }
  ] } } ] }`);
  const rows = page.locator('.sw-hierarchy-node[data-sw-adapter-kind="shape"]');
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await rows.nth(2).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Distribute horizontal space' }).click();
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 500\s+y: 250/);
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 1000\s+y: 800/);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(3);
  await page.getByRole('button', { name: 'Distribute vertical space' }).click();
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 500\s+y: 400/);
});

test('flow layout selections explain why free positioning is disabled', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-level-vstack');
  await page.locator('.sw-hierarchy-node').filter({ hasText: 'CardRow' }).first().click();
  await expect(page.getByRole('button', { name: 'Align left', exact: true })).toBeDisabled();
  await expect(page.getByText('Use layout properties for stack children.', { exact: false })).toBeVisible();
});

for (const [label, axis, expected] of [
  ['Align horizontal center', 'x', 860],
  ['Align right', 'x', 1720],
  ['Align top', 'y', 0],
  ['Align vertical center', 'y', 465],
  ['Align bottom', 'y', 930],
] as const) {
  test(`${label} uses the container's design coordinates`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=single-box');
    await page.locator('.sw-hierarchy-node[data-sw-adapter-kind="shape"]').first().click();
    // Freeform covers the full 1920 × 1080 slide.
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => getEditorSource(page)).toMatch(new RegExp(`${axis}:\\s*${expected}\\b`));
    await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(1);
  });
}

test('alignment materializes default coordinates and supports custom adapters', async ({ page }) => {
  await page.goto('/canvas.html?fixture=plateau-debugger');
  await setHostSource(page, 'Deck { name: "Defaults" slides: [ Slide { content: Freeform { children: [DebuggerDemo { width: 1500 height: 700 }] } } ] }');
  await page.locator('.sw-hierarchy-node[data-sw-adapter-kind="shape"]').first().click();
  await page.getByRole('button', { name: 'Align right', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toMatch(/x:\s*420\b/);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(1);
});

test('picker opens from canvas focus, leaves Escape available, and ignores source typing', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const editor = page.locator('.sw-editor-view .cm-content');
  const thumbnail = page.getByRole('option', { name: 'Slide 1', exact: true });
  await thumbnail.focus();
  const search = page.getByRole('combobox', { name: 'Insert element' });
  await openInsertionPicker(page);
  await search.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  await openInsertionPicker(page);
  await search.fill('Box');
  await search.press('Enter');
  await expect(editor).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sw-tool-status')).toHaveCount(0);
  await editor.focus();
  await page.keyboard.press('i');
  await expect(search).toHaveCount(0);
});

test('TextBox drawing inserts into the nested PLATEAU Freeform in one undo step', async ({ page }) => {
  await page.goto('/canvas.html?deck=uist-2026');
  const stage = page.locator('.sw-canvas-stage');
  const boxes = stage.locator('[data-sw-component="TextBox"]');
  await expect(boxes.first()).toBeVisible();
  const beforeCount = await boxes.count();
  const before = await getEditorSource(page);
  await openInsertionPicker(page);
  await page.getByRole('combobox', { name: 'Insert element' }).fill('text');
  await page.keyboard.press('Enter');
  const freeform = await stage.locator('[data-sw-component="Freeform"] > div').first().boundingBox();
  const canvas = await stage.locator('.presentation-canvas').boundingBox();
  if (!freeform || !canvas) throw new Error('Missing drawing surface');
  const scale = canvas.width / 1920;
  await page.mouse.move(freeform.x + 1400 * scale, freeform.y + 850 * scale);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(freeform.x + 1800 * scale, freeform.y + 1000 * scale, { steps: 10 });
  await page.mouse.up();
  await expect(boxes).toHaveCount(beforeCount + 1);
  await expect.poll(() => getEditorSource(page)).toMatch(/TextBox\s*\{\s*x: 1400\s+y: 850\s+width: 400\s+height: 150/);
  await expect(stage.getByText('Text', { exact: true })).toBeVisible();
  const insertedStart = await boxes.last().getAttribute('data-sw-span-start');
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveAttribute('data-sw-span-start', insertedStart!);
  await expect(page.locator('.sw-selection-outline')).toHaveAttribute('data-sw-overlay-for-start', insertedStart!);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await expect(boxes).toHaveCount(beforeCount);
});

test('drawing targets the inner Freeform and preserves its implicit children', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, `Deck { name: "Nested" slides: [ Slide { content: Freeform { children: [
    Freeform { Box { x: 100 y: 100 width: 200 height: 150 } }
  ] } } ] }`);
  const stage = page.locator('.sw-canvas-stage');
  await openInsertionPicker(page);
  await page.getByRole('combobox', { name: 'Insert element' }).fill('text');
  await page.keyboard.press('Enter');
  const freeform = await stage.locator('[data-sw-component="Freeform"] > div').last().boundingBox();
  const canvas = await stage.locator('.presentation-canvas').boundingBox();
  if (!freeform || !canvas) throw new Error('Missing inner drawing surface');
  const scale = canvas.width / 1920;
  await page.mouse.move(freeform.x + 300 * scale, freeform.y + 200 * scale);
  await page.mouse.down();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(freeform.x + 700 * scale, freeform.y + 400 * scale, { steps: 10 });
  await page.mouse.up();
  await expect(stage.getByText('Text', { exact: true })).toBeVisible();
  await expect.poll(() => getEditorSource(page)).toMatch(/Freeform\s*\{\s*Box\s*\{[^}]*\}\s*TextBox\s*\{\s*x: 300\s+y: 200\s+width: 400\s+height: 200/s);
  await expect(page.locator('.sw-canvas-diagnostics')).toHaveCount(0);
  await expect(page.locator('.sw-hierarchy-node.selected')).toContainText('TextBox');
});
