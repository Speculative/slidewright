// End-to-end tests for slide-strip operations:
//   - Add-slide button / Ctrl+M insert a Freeform slide below the active one
//   - Multi-select via shift+click (range) and cmd/ctrl+click (toggle)
//   - Delete with multi-selection removes all selected in one undo
//   - Drag-reorder moves slides (singletons + groups, preserving
//     relative order in groups)

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { focusEditor, getEditorSource } from './editor-helpers';

async function letReactCatchUp(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function getSource(page: Page): Promise<string> {
  return getEditorSource(page);
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

for (const action of ['button', 'Control+m', 'Meta+m']) {
  test(`${action} inserts a Freeform slide below the active slide in one undo`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=three-slides');
    await expect(page.locator('.sw-thumb')).toHaveCount(3);
    await page.locator('.sw-thumb').nth(1).click();
    const before = await getSource(page);
    if (action === 'button') await page.locator('.sw-add-slide').click();
    else await page.keyboard.press(action);
    await letReactCatchUp(page);
    await expect(page.locator('.sw-thumb')).toHaveCount(4);
    await expect.poll(() => activeIdx(page)).toBe(2);
    expect(await selectedIndices(page)).toEqual([2]);
    await expect(page.locator('.sw-thumb').nth(2)).not.toBeFocused();
    await expect(page.locator('.sw-canvas-stage [data-sw-component="Freeform"]')).toHaveCount(1);
    await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(0);
    const source = await getSource(page);
    expect(source).toMatch(/Beta[\s\S]*Slide\s*\{\s*content:\s*Freeform\s*\{\s*\}\s*\}\s*Slide\s*\{\s*label:\s*"Gamma"/);
    const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    await page.keyboard.press(undo);
    await expect(page.locator('.sw-thumb')).toHaveCount(3);
    expect(await activeIdx(page)).toBe(1);
    expect(await getSource(page)).toBe(before);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
    await expect(page.locator('.sw-thumb')).toHaveCount(4);
    expect(await activeIdx(page)).toBe(2);
    expect(await getSource(page)).toBe(source);
  });
}

test('Ctrl+M appends after the last slide and can create consecutive slides', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  await page.locator('.sw-thumb').nth(2).click();
  await page.keyboard.press('Control+m');
  await expect(page.locator('.sw-thumb')).toHaveCount(4);
  await expect.poll(() => activeIdx(page)).toBe(3);
  expect(await selectedIndices(page)).toEqual([3]);
  await expect(page.locator('.sw-thumb').nth(3)).not.toBeFocused();
  await page.keyboard.press('Control+m');
  await expect(page.locator('.sw-thumb')).toHaveCount(5);
  await expect.poll(() => activeIdx(page)).toBe(4);
  expect(await selectedIndices(page)).toEqual([4]);
  await expect(page.locator('.sw-thumb').nth(4)).not.toBeFocused();
});

test('Ctrl+M defers to the source editor while typing', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  await expect(page.locator('.sw-thumb')).toHaveCount(3);
  await focusEditor(page);
  await page.keyboard.press('Control+m');
  await expect(page.locator('.sw-thumb')).toHaveCount(3);
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

for (const key of ['Delete', 'Backspace']) {
  test(`${key} removes the selected element despite thumbnail focus`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=three-slides');
    await page.locator('.sw-thumb').nth(0).click();
    await page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').click();
    await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
    // Canvas pointer handling can leave the thumbnail focused.
    await page.locator('.sw-thumb').nth(0).focus();
    await page.keyboard.press(key);
    await expect(page.locator('.sw-thumb')).toHaveCount(3);
    await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(0);
    const source = await getSource(page);
    expect(source).toMatch(/Alpha/);
    expect(source.match(/Box\s*\{/g)).toHaveLength(2);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.locator('.sw-canvas-stage [data-sw-component="Box"]')).toHaveCount(1);
    await expect(page.locator('.sw-thumb')).toHaveCount(3);
  });

  test(`${key} without an element selection deletes the active slide from the canvas`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=three-slides');
    await page.locator('.sw-thumb').nth(1).click();
    await page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').click();
    await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sw-selection-outline')).toHaveCount(0);
    // Remove thumbnail focus to exercise the canvas fallback.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press(key);
    await expect(page.locator('.sw-thumb')).toHaveCount(2);
    const source = await getSource(page);
    expect(source).not.toMatch(/Beta/);
    expect(source).toMatch(/Alpha/);
    expect(source).toMatch(/Gamma/);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.locator('.sw-thumb')).toHaveCount(3);
    expect(await activeIdx(page)).toBe(1);
  });
}

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

// The insertion-line indicator must have a visible width at every
// gap position, including the after-last gap (a regression caught
// by visual inspection — the after-last line was rendered as a
// direct flex child of .sw-strip, which uses align-items: center,
// and collapsed to zero width without an explicit stretch).
test('drag shows a visible insertion line at the after-last gap', async ({ page }) => {
  await page.goto('/canvas.html?fixture=three-slides');
  const thumbs = page.locator('.sw-thumb');
  const last = await thumbs.nth(2).boundingBox();
  if (!last) throw new Error('last thumb not visible');
  const firstBox = await thumbs.nth(0).boundingBox();
  if (!firstBox) throw new Error('first thumb not visible');
  // Press down on the first thumb and drag below the last thumb's
  // bottom — without releasing — so the indicator is on screen.
  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2,
  );
  await page.mouse.down();
  await letReactCatchUp(page);
  await page.mouse.move(
    last.x + last.width / 2,
    last.y + last.height + 6,
    { steps: 10 },
  );
  await letReactCatchUp(page);
  const insertionWidth = await page.evaluate(() => {
    const el = document.querySelector('.sw-strip-insertion');
    if (!el) return -1;
    return el.getBoundingClientRect().width;
  });
  await page.mouse.up();
  expect(insertionWidth).toBeGreaterThan(20);
});

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
