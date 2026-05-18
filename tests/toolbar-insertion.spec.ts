// End-to-end tests for the registry-driven toolbar and drag-from-
// toolbar insertion gestures (steps 3–7 of the toolbar/insertion
// work). Each case loads a fixture deck, performs a real pointer
// drag from a toolbar entry onto a slot in the canvas, and asserts
// on the resulting DSL source.
//
// Note that drag-mode entries use pointer events directly (rather
// than HTML5 drag-and-drop) — Playwright's `mouse.down/move/up`
// drives the same gesture path real users hit.

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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

// Same scale calc the canvas uses internally: presentation-canvas
// width / design width (1920). Reading from the freeform's own
// bounding box would also work for a deck whose freeform spans
// the full slide, but the canvas measurement is the canonical
// one and matches gestures.spec.ts.
const DESIGN_W = 1920;
async function getCanvasScale(page: Page): Promise<number> {
  const box = await page
    .locator('.sw-canvas-stage .presentation-canvas')
    .boundingBox();
  if (!box) throw new Error('canvas not visible');
  return box.width / DESIGN_W;
}

// Pointer-drag from the center of a toolbar entry to the center of
// a target locator. Mirrors the gesture App.tsx wires up: pointer
// down on the entry → moves past the threshold → release on target.
async function dragToolToTarget(
  page: Page,
  toolLabel: string,
  target: Locator,
): Promise<void> {
  const tool = page.locator('.sw-tool', { hasText: new RegExp(`^${toolLabel}$`) });
  const tb = await tool.boundingBox();
  if (!tb) throw new Error(`toolbar entry "${toolLabel}" not visible`);
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error('drop target not visible');
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await letReactCatchUp(page);
  // Move in a small step first to cross the 4px threshold; then to
  // the target. Two-step move ensures the gesture commits to drag
  // mode rather than being treated as a click.
  await page.mouse.move(tb.x + tb.width / 2 + 8, tb.y + tb.height / 2);
  await letReactCatchUp(page);
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 10 },
  );
  await letReactCatchUp(page);
  await page.mouse.up();
}

// Pointer-drag from a toolbar entry to a specific viewport point
// (not the center of a locator). Used by gap-insertion tests where
// we want to aim at a computed point between children.
async function dragToolToPoint(
  page: Page,
  toolLabel: string,
  x: number,
  y: number,
): Promise<void> {
  const tool = page.locator('.sw-tool', { hasText: new RegExp(`^${toolLabel}$`) });
  const tb = await tool.boundingBox();
  if (!tb) throw new Error(`toolbar entry "${toolLabel}" not visible`);
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await letReactCatchUp(page);
  await page.mouse.move(tb.x + tb.width / 2 + 8, tb.y + tb.height / 2);
  await letReactCatchUp(page);
  await page.mouse.move(x, y, { steps: 10 });
  await letReactCatchUp(page);
  await page.mouse.up();
}

// ─── Toolbar shape ────────────────────────────────────────────────

test('toolbar surfaces all registered components grouped by category', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  // Section headers appear when ≥2 categories are present. Each of
  // the three section headers must be visible.
  for (const cat of ['Shapes', 'Layouts', 'Slides']) {
    await expect(
      page.locator('.sw-tool-section-header', { hasText: cat }),
    ).toBeVisible();
  }
  // Every registry entry with `insertion` should be enumerated.
  for (const name of [
    'Box',
    'TextBox',
    'Arrow',
    'VStack',
    'HStack',
    'CardRow',
    'Freeform',
    'TitleSlide',
    'ContentSlide',
  ]) {
    await expect(
      page.locator('.sw-tool', { hasText: new RegExp(`^${name}$`) }),
    ).toBeVisible();
  }
});

test('filter input narrows the visible entries', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const filter = page.locator('.sw-tool-search');
  await filter.fill('stack');
  await expect(
    page.locator('.sw-tool', { hasText: /^VStack$/ }),
  ).toBeVisible();
  await expect(
    page.locator('.sw-tool', { hasText: /^HStack$/ }),
  ).toBeVisible();
  // Box / Arrow shouldn't match "stack".
  await expect(
    page.locator('.sw-tool', { hasText: /^Box$/ }),
  ).toHaveCount(0);
  await filter.fill('xyz-no-match');
  await expect(page.locator('.sw-tool-empty')).toBeVisible();
});

// ─── Drop on empty-slot placeholder ───────────────────────────────

test('drag VStack onto an empty block slot materializes the fill', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-block-slot');
  // The body slot's empty placeholder. `data-sw-slot-name="body"`
  // is the wrapper; the dashed box visual is its first child.
  const placeholder = page
    .locator('[data-sw-slot-name="body"][data-sw-slot-empty="true"] > *')
    .first();
  await expect(placeholder).toBeVisible();
  await dragToolToTarget(page, 'VStack', placeholder);
  const source = await getSource(page);
  expect(source).toMatch(/body:\s*VStack\s*\{/);
});

test('drag with mismatched type rejects (no source change)', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-block-slot');
  // `title` is a text slot — but `title` is filled. Pick a known-
  // typed text placeholder. Actually the body placeholder is the
  // only empty one in this fixture; instead, try dropping a
  // ContentSlide (produces 'slide') onto a `block` placeholder.
  // No commit should happen.
  const placeholder = page
    .locator('[data-sw-slot-name="body"][data-sw-slot-empty="true"] > *')
    .first();
  const beforeSrc = await getSource(page);
  await dragToolToTarget(page, 'ContentSlide', placeholder);
  const afterSrc = await getSource(page);
  expect(afterSrc).toBe(beforeSrc);
});

// ─── Gap insertion in a filled array slot ─────────────────────────

// The `[data-sw-component="CardRow"]` wrapper is `display:
// contents` so its own bounding box is 0×0. Drill into its first
// element child to find the visible card div.
function cardBoxLocator(page: Page): Locator {
  return page.locator(
    '[data-sw-slot-name="children"][data-sw-slot-type^="array<"] [data-sw-component="CardRow"] > *',
  );
}

test('drag VStack to before-first gap inserts at index 0', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-level-vstack');
  const cards = cardBoxLocator(page);
  const firstBox = await cards.first().boundingBox();
  if (!firstBox) throw new Error('first card not visible');
  // Aim a few pixels above the first card's top edge — that's the
  // before-first gap.
  await dragToolToPoint(page, 'VStack', firstBox.x + firstBox.width / 2, firstBox.y - 2);
  const source = await getSource(page);
  // VStack should appear *before* the first CardRow. Match the
  // children list order — first item after the `[` should be the
  // new VStack.
  expect(source).toMatch(/children:\s*\[\s*VStack\s*\{[^}]*\}\s*CardRow/s);
});

test('drag VStack between two children inserts at the middle index', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-level-vstack');
  const cards = cardBoxLocator(page);
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  if (!first || !second) throw new Error('cards not visible');
  // Midpoint of the gap between them.
  const midY = (first.y + first.height + second.y) / 2;
  await dragToolToPoint(page, 'VStack', first.x + first.width / 2, midY);
  const source = await getSource(page);
  // After insertion the children list reads: CardRow, VStack, CardRow.
  expect(source).toMatch(
    /CardRow\s*\{[^}]*First[^}]*\}\s*VStack\s*\{[^}]*\}\s*CardRow\s*\{[^}]*Second/s,
  );
});

test('drag VStack to after-last gap appends to the array', async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-level-vstack');
  const cards = cardBoxLocator(page);
  const last = await cards.last().boundingBox();
  if (!last) throw new Error('last card not visible');
  // Just below the last card's bottom edge.
  await dragToolToPoint(
    page,
    'VStack',
    last.x + last.width / 2,
    last.y + last.height + 2,
  );
  const source = await getSource(page);
  // After insertion: CardRow, CardRow, VStack — the new VStack
  // closes the list.
  expect(source).toMatch(
    /CardRow\s*\{[^}]*Second[^}]*\}\s*VStack\s*\{[^}]*\}\s*\]/s,
  );
});

// ─── Click on drag-only entry is a no-op ──────────────────────────

test('click on a drag-only entry without movement makes no edit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-block-slot');
  const beforeSrc = await getSource(page);
  // Plain click on VStack — pointerdown then pointerup at the same
  // coords. Below the 4px threshold, so the gesture should never
  // commit to drag mode and no AST splice should occur.
  await page.locator('.sw-tool', { hasText: /^VStack$/ }).click();
  await letReactCatchUp(page);
  const afterSrc = await getSource(page);
  expect(afterSrc).toBe(beforeSrc);
});

// ─── Modal entries still work post-refactor ───────────────────────

test('Esc during tool-drag cancels without inserting', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-block-slot');
  const before = await getSource(page);
  const placeholder = page
    .locator('[data-sw-slot-name="body"][data-sw-slot-empty="true"] > *')
    .first();
  const pb = await placeholder.boundingBox();
  if (!pb) throw new Error('placeholder not visible');
  // Start a drag from the VStack tool, move to the placeholder,
  // press Escape, then release.
  const tool = page.locator('.sw-tool', { hasText: /^VStack$/ });
  const tb = await tool.boundingBox();
  if (!tb) throw new Error('VStack tool not visible');
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await letReactCatchUp(page);
  await page.mouse.move(tb.x + tb.width / 2 + 8, tb.y + tb.height / 2);
  await letReactCatchUp(page);
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 10 });
  await letReactCatchUp(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const after = await getSource(page);
  expect(after).toBe(before);
});

test('modal Box tool still draws a rect on Freeform after refactor', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await page.locator('.sw-tool', { hasText: /^Box$/ }).click();
  // Use the freeform area — copy from gestures.spec.ts's
  // dragDesignPoints helper (canvas scale, not freeform scale).
  const freeform = page
    .locator('.sw-canvas-stage [data-sw-component="Freeform"] > div')
    .first();
  const fb = await freeform.boundingBox();
  if (!fb) throw new Error('freeform not visible');
  const scale = await getCanvasScale(page);
  const sx = fb.x + 300 * scale;
  const sy = fb.y + 200 * scale;
  const ex = fb.x + 700 * scale;
  const ey = fb.y + 500 * scale;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await letReactCatchUp(page);
  await page.mouse.move(ex, ey, { steps: 10 });
  await page.mouse.up();
  const source = await getSource(page);
  expect(source).toMatch(/Box\s*\{[^}]*x:\s*300/s);
});
