import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

test('insertion search ranks names above description matches and confirms the best result', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const search = page.getByRole('combobox', { name: 'Insert element' });
  const results = page.getByRole('listbox', { name: 'Elements' }).getByRole('option');
  await search.fill('text');
  await expect(results.first()).toHaveText('TextBox');
  await expect(page.getByRole('option', { name: 'CardRow', exact: true })).toBeVisible();
  await expect(results.first()).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(page.locator('.sw-tool-status')).toContainText('Draw TextBox');
  await search.fill(' BOX ');
  await expect(results.first()).toHaveText('Box');
  await expect(page.getByRole('option', { name: 'TextBox', exact: true })).toBeVisible();
});

test('insertion search supports hotkey, keyboard choice, empty results and Escape', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const search = page.getByRole('combobox', { name: 'Insert element' });
  await expect(page.getByRole('listbox', { name: 'Elements' })).toHaveCount(0);
  await page.keyboard.press('i');
  await expect(search).toBeFocused();
  await search.fill('stack');
  await expect(page.getByRole('listbox', { name: 'Elements' }).getByRole('option')).toHaveText(['VStack', 'HStack']);
  await search.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'HStack', exact: true })).toHaveAttribute('aria-selected', 'true');
  await search.fill('nothing-matches');
  await search.press('Enter');
  await expect(page.getByText('No matching elements')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => getEditorSource(page)).not.toContain('Box {');
  await search.fill('Box');
  await search.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Draw Box' })).toBeVisible();
  await expect(search).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: 'Draw Box' })).toHaveCount(0);
});

test('palette confirmation fills a selected compatible empty slot', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-block-slot');
  const slot = page.locator('.sw-canvas-stage [data-sw-slot-name="body"][data-sw-slot-empty="true"] > *').first();
  await slot.click();
  await slot.click(); // Drill through the slide to its empty slot.
  const search = page.getByRole('combobox', { name: 'Insert element' });
  await search.fill('VStack');
  await search.press('Enter');
  await expect.poll(() => getEditorSource(page)).toMatch(/body:\s*VStack\s*\{/);
});

test('palette confirmation arms click placement when no slot is selected', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-block-slot');
  const search = page.getByRole('combobox', { name: 'Insert element' });
  await search.fill('VStack');
  await search.press('Enter');
  await expect(page.getByText('Click a compatible slot or gap', { exact: false })).toBeVisible();
  await page.locator('.sw-canvas-stage [data-sw-slot-name="body"][data-sw-slot-empty="true"] > *').first().click();
  await expect.poll(() => getEditorSource(page)).toMatch(/body:\s*VStack\s*\{/);
});

test('properties dock beside the canvas and bottom panes hide independently', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await page.locator('.sw-hierarchy-node[data-sw-adapter-kind="shape"]').first().click();
  const sidebar = page.getByRole('complementary', { name: 'Element properties' });
  await expect(sidebar.locator('.sw-properties-panel')).toBeVisible();
  const sidebarBounds = await sidebar.boundingBox();
  const canvasBounds = await page.locator('.sw-canvas-stage').boundingBox();
  expect(sidebarBounds!.x).toBeGreaterThanOrEqual(canvasBounds!.x + canvasBounds!.width);
  await page.getByRole('tab', { name: 'Slide 1', exact: true }).click();
  await page.getByRole('button', { name: 'Source / Notes', exact: true }).click();
  await expect(page.locator('.sw-editor-pane')).toBeHidden();
  await expect(page.locator('.sw-hierarchy-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Source / Notes', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Slide 1', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Hierarchy', exact: true }).click();
  await expect(page.locator('.sw-hierarchy-panel')).toBeHidden();
  await expect(page.locator('.sw-editor-pane')).toBeVisible();
  await page.getByRole('button', { name: 'Bottom dock', exact: true }).click();
  await expect(page.locator('.sw-canvas-bottom-strip')).toBeHidden();
  await expect(sidebar).toBeVisible();
  await page.getByRole('button', { name: 'Bottom dock', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Slide 1', exact: true })).toHaveAttribute('aria-selected', 'true');
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
  ['Align horizontal center', 'x', 740],
  ['Align right', 'x', 1480],
  ['Align top', 'y', 0],
  ['Align vertical center', 'y', 367],
  ['Align bottom', 'y', 734],
] as const) {
  test(`${label} uses the container's design coordinates`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=single-box');
    await page.locator('.sw-hierarchy-node[data-sw-adapter-kind="shape"]').first().click();
    // The fixture's Freeform is 1680 × 884, inside the slide's safe area.
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
  await expect.poll(() => getEditorSource(page)).toMatch(/x:\s*180\b/);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(1);
});

test('confirming insertion leaves source focus so Escape cancels placement', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const editor = page.locator('.sw-editor-view .cm-content');
  await editor.focus();
  const search = page.getByRole('combobox', { name: 'Insert element' });
  await search.fill('Box');
  await search.press('Enter');
  await expect(editor).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sw-tool-status')).not.toContainText('Draw Box');
  await editor.focus();
  await page.keyboard.press('i');
  await expect(search).not.toBeFocused();
  await expect(search).toHaveAttribute('aria-expanded', 'false');
});
