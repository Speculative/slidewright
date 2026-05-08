// End-to-end tests for the inspector — hierarchy tree + selection
// sync. The property panel is a placeholder until v0.3 stage 3.
//
// The inspector lives in App's bottom strip (next to the standalone's
// EditorPane), so it's only visible when bottomExtra is provided —
// that's the case under /canvas.html which renders the standalone
// wrapper.

import { test, expect } from '@playwright/test';

test('hierarchy panel renders the active slide shapes', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]').first(),
  ).toBeVisible();
  // Two Box shapes on slide 1 → two tree rows.
  const rows = page.locator('.sw-hierarchy-node');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Box');
  await expect(rows.nth(1)).toContainText('Box');
});

test('hierarchy panel shows placeholder copy on an empty slide', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await expect(page.locator('.sw-hierarchy-panel')).toBeVisible();
  await expect(page.locator('.sw-hierarchy-node')).toHaveCount(0);
  await expect(
    page.locator('.sw-hierarchy-panel .sw-inspector-panel-empty'),
  ).toBeVisible();
});

test('clicking a tree row selects the shape on the canvas', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]').first(),
  ).toBeVisible();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(0);
  await page.locator('.sw-hierarchy-node').first().click();
  // Selection outline appears for the selected shape.
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
});

test('shift-clicking a tree row toggles selection', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await expect(page.locator('.sw-hierarchy-node')).toHaveCount(2);
  await page.locator('.sw-hierarchy-node').nth(0).click();
  await page.locator('.sw-hierarchy-node').nth(1).click({ modifiers: ['Shift'] });
  // Two shapes selected → two outlines + a group bbox.
  await expect(page.locator('.sw-selection-outline')).toHaveCount(2);
  // Shift-click the second again removes it.
  await page.locator('.sw-hierarchy-node').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
});

test('canvas selection highlights the corresponding tree row', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]').first(),
  ).toBeVisible();
  // Click the first Box on the canvas. The matching tree row should
  // pick up the selected class.
  await page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .nth(0)
    .click();
  const firstRow = page.locator('.sw-hierarchy-node').nth(0);
  await expect(firstRow).toHaveClass(/selected/);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(1);
});

test('Ctrl-clicking a tree row moves the editor caret to the source span', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  // Pull the expected span from the tree row's data attrs (matches
  // the wrapper attrs used by the canvas Ctrl-click test).
  const span = await page.evaluate(() => {
    const row = document.querySelector('.sw-hierarchy-node');
    if (!row) throw new Error('hierarchy node not found');
    return {
      start: parseInt(row.getAttribute('data-sw-span-start') ?? '', 10),
      end: parseInt(row.getAttribute('data-sw-span-end') ?? '', 10),
    };
  });
  await page
    .locator('.sw-hierarchy-node')
    .first()
    .click({ modifiers: ['ControlOrMeta'] });
  const sel = await page.evaluate(() => {
    const ta = document.querySelector('.sw-editor-pane') as HTMLTextAreaElement | null;
    if (!ta) throw new Error('editor pane not found');
    return { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
  });
  expect(sel.start).toBe(span.start);
  expect(sel.end).toBe(span.end);
});

// ─── Property panel ──────────────────────────────────────────────

test('property panel shows placeholder when nothing is selected', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  await expect(
    page.locator('.sw-properties-panel .sw-inspector-panel-empty'),
  ).toContainText('no selection');
});

test('property panel renders rows for the selected shape', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  await page.locator('.sw-hierarchy-node').first().click();
  // single-box has x, y, width, height, fill — five rows.
  await expect(page.locator('.sw-property-row')).toHaveCount(5);
  await expect(page.locator('.sw-property-row').nth(0)).toContainText('x');
});

test('editing a numeric param and pressing Enter commits to source', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  await page.locator('.sw-hierarchy-node').first().click();
  const xRow = page.locator('.sw-property-row', { hasText: /^x/ }).first();
  const xInput = xRow.locator('input.sw-property-value');
  await xInput.fill('500');
  await xInput.press('Enter');
  const src = await page.locator('.sw-editor-pane').inputValue();
  expect(src).toMatch(/x:\s*500/);
});

test('Escape cancels the edit without committing', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  const before = await page.locator('.sw-editor-pane').inputValue();
  await page.locator('.sw-hierarchy-node').first().click();
  const xRow = page.locator('.sw-property-row', { hasText: /^x/ }).first();
  const xInput = xRow.locator('input.sw-property-value');
  await xInput.fill('999');
  await xInput.press('Escape');
  const after = await page.locator('.sw-editor-pane').inputValue();
  expect(after).toBe(before);
});

test('editing a name_ref param commits the new name', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  await page.locator('.sw-hierarchy-node').first().click();
  const fillRow = page.locator('.sw-property-row', { hasText: /^fill/ }).first();
  const fillInput = fillRow.locator('input.sw-property-value');
  await fillInput.fill('cyan');
  await fillInput.press('Enter');
  const src = await page.locator('.sw-editor-pane').inputValue();
  expect(src).toMatch(/fill:\s*cyan/);
});

test('property edits preserve selection on the same shape', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  await page.locator('.sw-hierarchy-node').first().click();
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(1);
  const xRow = page.locator('.sw-property-row', { hasText: /^x/ }).first();
  const xInput = xRow.locator('input.sw-property-value');
  await xInput.fill('500');
  await xInput.press('Enter');
  // Selection should still highlight the same Box (the property
  // panel passes the post-edit shape range as newSelections so the
  // subscribe handler doesn't fall through to the empty path).
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(1);
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
});

test('property edits enter the undo stack', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  const before = await page.locator('.sw-editor-pane').inputValue();
  await page.locator('.sw-hierarchy-node').first().click();
  const xRow = page.locator('.sw-property-row', { hasText: /^x/ }).first();
  const xInput = xRow.locator('input.sw-property-value');
  await xInput.fill('500');
  await xInput.press('Enter');
  // Move focus to the canvas so Cmd-Z routes to the canvas handler.
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  const after = await page.locator('.sw-editor-pane').inputValue();
  expect(after).toBe(before);
});

test('multi-selection shows the multi-edit hint', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await expect(page.locator('.sw-hierarchy-node')).toHaveCount(2);
  await page.locator('.sw-hierarchy-node').nth(0).click();
  await page.locator('.sw-hierarchy-node').nth(1).click({ modifiers: ['Shift'] });
  await expect(
    page.locator('.sw-properties-panel .sw-inspector-panel-empty'),
  ).toContainText('multi-edit not supported');
});

test('slide-level VStack (no Freeform ancestor) is selectable + inspectable', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-level-vstack');
  // VStack rendered inside the slide content directly, no Freeform.
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="VStack"]'),
  ).toBeAttached();
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Freeform"]'),
  ).toHaveCount(0);
  // Click the VStack via the hierarchy tree (avoids any
  // child-drag-intercept that a direct canvas click would trigger).
  // Filter by component name since the hierarchy now also includes
  // CardRow (became selectable in the click-into-named-slots cut).
  await page.locator('.sw-hierarchy-node', { hasText: 'VStack' }).click();
  // Selection outline must render — verifies the slide-stage portal
  // fallback in useSelectionPortal is wired through.
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  // Properties panel shows the VStack's spacing param.
  await expect(
    page.locator('.sw-property-row').filter({ hasText: 'spacing' }),
  ).toHaveCount(1);
});

test('clicking inside a CardRow drills through the selectable chain', async ({ page }) => {
  // Multi-click drilling: each click on the same chain drills one
  // level inward through the alternating component / slot chain.
  // First click selects outermost (VStack), then VStack.children
  // slot, then CardRow, then CardRow.body slot.
  await page.goto('/canvas.html?fixture=slide-level-vstack');
  const bodyText = page.locator('.sw-canvas-stage').getByText('Top card content.');

  // 1st click: outermost — VStack.
  await bodyText.click();
  await expect(
    page.locator('.sw-properties-panel .sw-inspector-panel-header'),
  ).toContainText('VStack');
  // Component outline (not slot).
  await expect(page.locator('.sw-selection-outline.sw-selection-slot')).toHaveCount(0);

  // 2nd click: drill to VStack.children slot.
  await bodyText.click();
  await expect(page.locator('.sw-selection-slot-label')).toContainText('children');
  await expect(
    page.locator('.sw-properties-panel .sw-inspector-panel-header'),
  ).toContainText('Slot: children');

  // 3rd click: drill to CardRow.
  await bodyText.click();
  await expect(
    page.locator('.sw-properties-panel .sw-inspector-panel-header'),
  ).toContainText('CardRow');
  // Outline returns to component (not slot).
  await expect(page.locator('.sw-selection-slot-label')).toHaveCount(0);

  // 4th click: drill to CardRow.body slot.
  await bodyText.click();
  await expect(page.locator('.sw-selection-slot-label')).toContainText('body');
  await expect(
    page.locator('.sw-properties-panel .sw-inspector-panel-header'),
  ).toContainText('Slot: body');
});

test('selection outline survives slide nav away and back', async ({ page }) => {
  // Bug fix verification: SelectionLayer + GestureOverlayLayer key
  // on activeIdx so their hook state (ResizeObserver subscriptions,
  // cached portal targets, cached bounds) resets on slide nav. The
  // standalone canvas only mounts the active slide; without the
  // remount, observers stayed subscribed to detached DOM after
  // nav-back and bounds never re-measured.
  await page.goto('/canvas.html?fixture=two-slides');
  // Select the shape on slide 1 via the hierarchy panel.
  await page.locator('.sw-hierarchy-node').first().click();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  // Navigate to slide 2 — selection state persists, but the
  // outline shouldn't render here because the selected element
  // belongs to slide 1.
  await page.locator('.sw-thumb').nth(1).click();
  await expect(page.locator('.sw-thumb').nth(1)).toHaveClass(/active/);
  // Navigate back to slide 1. The outline must render again — the
  // remount-on-activeIdx forces fresh DOM lookups + measurement.
  await page.locator('.sw-thumb').nth(0).click();
  await expect(page.locator('.sw-thumb').nth(0)).toHaveClass(/active/);
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
});

test('switching slides updates the hierarchy tree', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await expect(page.locator('.sw-hierarchy-node')).toHaveCount(1);
  // Switch to slide 2 — it has its own Box, so the tree should still
  // have one row but for a different span.
  const span1 = await page
    .locator('.sw-hierarchy-node')
    .first()
    .getAttribute('data-sw-span-start');
  await page.locator('.sw-thumb').nth(1).click();
  await expect(page.locator('.sw-thumb').nth(1)).toHaveClass(/active/);
  await expect(page.locator('.sw-hierarchy-node')).toHaveCount(1);
  const span2 = await page
    .locator('.sw-hierarchy-node')
    .first()
    .getAttribute('data-sw-span-start');
  expect(span2).not.toBe(span1);
});
