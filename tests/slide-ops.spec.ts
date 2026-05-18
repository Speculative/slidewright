// End-to-end tests for slide-strip operations:
//   - Add-slide button appends an empty Slide and activates it
//   - Multi-select via shift+click (range) and cmd/ctrl+click (toggle)
//   - Delete with multi-selection removes all selected in one undo
//   - Drag-reorder moves slides (singletons + groups, preserving
//     relative order in groups)

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function letReactCatchUp(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function getSource(page: Page): Promise<string> {
  return page.locator('.sw-editor-pane').inputValue();
}

async function activeIdx(page: Page): Promise<number> {
  // The thumb with class "active" is the active slide; nth-of-type
  // gives the index. Read it via a JS evaluation against the strip.
  return page.evaluate(() => {
    const thumbs = Array.from(document.querySelectorAll('.sw-thumb'));
    return thumbs.findIndex((t) => t.classList.contains('active'));
  });
}

async function selectedIndices(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const thumbs = Array.from(document.querySelectorAll('.sw-thumb'));
    const out: number[] = [];
    thumbs.forEach((t, i) => {
      if (
        t.classList.contains('selected') ||
        t.classList.contains('active')
      ) {
        out.push(i);
      }
    });
    return out;
  });
}

// ─── Add-slide ───────────────────────────────────────────────────

test('add-slide button appends an empty slide and activates it', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  await expect(page.locator('.sw-thumb')).toHaveCount(3);
  await page.locator('.sw-add-slide').click();
  await letReactCatchUp(page);
  await expect(page.locator('.sw-thumb')).toHaveCount(4);
  // New slide is the last one and becomes active.
  expect(await activeIdx(page)).toBe(3);
  const source = await getSource(page);
  // Source ends in `Slide {}` followed by the closing slides
  // bracket. Match the appended empty body.
  expect(source).toMatch(/Slide\s*\{\s*\}\s*\]/s);
});

// ─── Shift-click range select ────────────────────────────────────

test('shift+click selects a range from the anchor to the clicked slide', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  await page.locator('.sw-thumb').nth(0).click();
  await letReactCatchUp(page);
  expect(await activeIdx(page)).toBe(0);
  // Shift-click slide 3 (index 2). Range [0..2] should be selected.
  await page.locator('.sw-thumb').nth(2).click({ modifiers: ['Shift'] });
  await letReactCatchUp(page);
  expect(await activeIdx(page)).toBe(2);
  expect(await selectedIndices(page)).toEqual([0, 1, 2]);
});

// ─── Cmd/Ctrl-click toggle ───────────────────────────────────────

test('cmd+click toggles individual slides in the selection', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  await page.locator('.sw-thumb').nth(0).click();
  await letReactCatchUp(page);
  // Cmd-click slide 3 — adds it to the selection. Active = 2.
  // Use 'Meta' (Mac cmd); the strip treats meta or ctrl as toggle.
  await page.locator('.sw-thumb').nth(2).click({ modifiers: ['Meta'] });
  await letReactCatchUp(page);
  expect(await activeIdx(page)).toBe(2);
  expect(await selectedIndices(page)).toEqual([0, 2]);
});

// ─── Delete multi-selection ──────────────────────────────────────

test('delete with multi-selection removes all selected slides in one undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  // Select slides 0 + 2 via cmd-click.
  await page.locator('.sw-thumb').nth(0).click();
  await letReactCatchUp(page);
  await page.locator('.sw-thumb').nth(2).click({ modifiers: ['Meta'] });
  await letReactCatchUp(page);
  // Press Delete with focus on the last-clicked thumb (the active
  // one — which already has focus from the click). The strip-focus
  // detection routes Delete to slide-delete.
  const before = await getSource(page);
  expect(before).toMatch(/Alpha/);
  expect(before).toMatch(/Gamma/);
  await page.keyboard.press('Delete');
  await letReactCatchUp(page);
  const after = await getSource(page);
  expect(after).not.toMatch(/Alpha/);
  expect(after).not.toMatch(/Gamma/);
  expect(after).toMatch(/Beta/);
  await expect(page.locator('.sw-thumb')).toHaveCount(1);
  // Single undo brings both back.
  await page.locator('.sw-thumb').nth(0).click();
  await letReactCatchUp(page);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await letReactCatchUp(page);
  const restored = await getSource(page);
  expect(restored).toMatch(/Alpha/);
  expect(restored).toMatch(/Beta/);
  expect(restored).toMatch(/Gamma/);
});

// ─── Drag-reorder ────────────────────────────────────────────────

async function dragThumbToGap(
  page: Page,
  fromIdx: number,
  toIdx: number,
): Promise<void> {
  // Locate the source thumb's center and the destination gap
  // (above the target thumb's top edge, or below the last thumb's
  // bottom if toIdx === thumb count).
  const thumbs = page.locator('.sw-thumb');
  const fromBox = await thumbs.nth(fromIdx).boundingBox();
  if (!fromBox) throw new Error(`thumb ${fromIdx} not visible`);
  const total = await thumbs.count();
  let targetY: number;
  let targetX = fromBox.x + fromBox.width / 2;
  if (toIdx >= total) {
    const lastBox = await thumbs.nth(total - 1).boundingBox();
    if (!lastBox) throw new Error('last thumb not visible');
    targetY = lastBox.y + lastBox.height + 4;
    targetX = lastBox.x + lastBox.width / 2;
  } else {
    const toBox = await thumbs.nth(toIdx).boundingBox();
    if (!toBox) throw new Error(`thumb ${toIdx} not visible`);
    targetY = toBox.y - 2;
    targetX = toBox.x + toBox.width / 2;
  }
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await letReactCatchUp(page);
  // Small step to cross threshold.
  await page.mouse.move(
    fromBox.x + fromBox.width / 2 + 6,
    fromBox.y + fromBox.height / 2 + 6,
  );
  await letReactCatchUp(page);
  await page.mouse.move(targetX, targetY, { steps: 10 });
  await letReactCatchUp(page);
  await page.mouse.up();
  await letReactCatchUp(page);
}

test('drag-reorder moves a single slide to a new position', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  // Drag slide 0 (Alpha) to after slide 2 (Gamma).
  await dragThumbToGap(page, 0, 3);
  const source = await getSource(page);
  // Resulting order: Beta, Gamma, Alpha.
  const order = (source.match(/label:\s*"([^"]+)"/g) ?? []).map((m) =>
    m.replace(/label:\s*"([^"]+)"/, '$1'),
  );
  expect(order).toEqual(['Beta', 'Gamma', 'Alpha']);
});

test('drag-reorder of a multi-selection moves the group preserving relative order', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  // Select slides 0 + 1 (Alpha + Beta) via shift-click range.
  await page.locator('.sw-thumb').nth(0).click();
  await letReactCatchUp(page);
  await page.locator('.sw-thumb').nth(1).click({ modifiers: ['Shift'] });
  await letReactCatchUp(page);
  expect(await selectedIndices(page)).toEqual([0, 1]);
  // Drag the group to after slide 2 (Gamma).
  await dragThumbToGap(page, 1, 3);
  const source = await getSource(page);
  // Resulting order: Gamma, Alpha, Beta (Alpha + Beta retain
  // their relative order in the moved group).
  const order = (source.match(/label:\s*"([^"]+)"/g) ?? []).map((m) =>
    m.replace(/label:\s*"([^"]+)"/, '$1'),
  );
  expect(order).toEqual(['Gamma', 'Alpha', 'Beta']);
});
