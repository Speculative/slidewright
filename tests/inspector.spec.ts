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

test('double-clicking a tree row moves the editor caret to the source span', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  // Pull the expected span from the tree row's data attrs (matches
  // the wrapper attrs used by the canvas double-click test).
  const span = await page.evaluate(() => {
    const row = document.querySelector('.sw-hierarchy-node');
    if (!row) throw new Error('hierarchy node not found');
    return {
      start: parseInt(row.getAttribute('data-sw-span-start') ?? '', 10),
      end: parseInt(row.getAttribute('data-sw-span-end') ?? '', 10),
    };
  });
  await page.locator('.sw-hierarchy-node').first().dblclick();
  const sel = await page.evaluate(() => {
    const ta = document.querySelector('.sw-editor-pane') as HTMLTextAreaElement | null;
    if (!ta) throw new Error('editor pane not found');
    return { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
  });
  expect(sel.start).toBe(span.start);
  expect(sel.end).toBe(span.end);
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
