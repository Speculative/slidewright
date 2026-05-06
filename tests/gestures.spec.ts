// End-to-end gesture tests. Each case loads a fixture deck via the
// standalone canvas (?fixture=name → tests/fixtures/name.sw),
// performs a real mouse / keyboard gesture, and asserts on the DSL
// source visible in the editor pane after the round-trip.
//
// These run against a live browser (Chromium via Playwright) — they
// catch the bug classes that pure-function tests miss: pointer-event
// wiring, React effect ordering, ResizeObserver / getBoundingClient
// behavior, contentEditable focus / blur, and so on.
//
// Helpers (top of file) translate between *design coordinates* (the
// 1920x1080 untransformed slide space, where the AST stores
// numbers) and *client coordinates* (what page.mouse.move expects).
// Reading the canvas's `.presentation-canvas` boundingBox gives us
// the current scale; any drag expressed in design pixels can then
// be issued as the right number of screen pixels.

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const DESIGN_W = 1920;

async function getCanvasScale(page: Page): Promise<number> {
  const box = await page
    .locator('.sw-canvas-stage .presentation-canvas')
    .boundingBox();
  if (!box) throw new Error('canvas not visible');
  return box.width / DESIGN_W;
}

// React effects attach the document-level pointermove/pointerup
// listeners *after* the pointerdown handler's setState commits.
// Playwright's mouse.move(..., {steps}) fires synchronously and
// can race ahead of the effect, dropping the gesture entirely.
// Yielding for two animation frames after the down event gives
// React time to render and run the effect.
async function letReactCatchUp(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// Drags `locator` from its center by (designDx, designDy) design-
// space pixels.
async function dragByDesign(
  page: Page,
  locator: Locator,
  designDx: number,
  designDy: number,
): Promise<void> {
  const eb = await locator.boundingBox();
  if (!eb) throw new Error('drag target not visible');
  const scale = await getCanvasScale(page);
  const startX = eb.x + eb.width / 2;
  const startY = eb.y + eb.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await letReactCatchUp(page);
  await page.mouse.move(startX + designDx * scale, startY + designDy * scale, {
    steps: 10,
  });
  await page.mouse.up();
}

// Drags from one absolute design-space point to another, both
// relative to the *Freeform's* origin (not the canvas's — the
// Slide has padding, so canvas (0, 0) ≠ Freeform (0, 0)). Used by
// the create-shape tests, which don't have an existing element to
// grab onto and need to hit specific design coordinates inside
// the Freeform.
async function dragDesignPoints(
  page: Page,
  designStartX: number,
  designStartY: number,
  designEndX: number,
  designEndY: number,
): Promise<void> {
  const freeform = page
    .locator('.sw-canvas-stage [data-sw-component="Freeform"] > div')
    .first();
  const fb = await freeform.boundingBox();
  if (!fb) throw new Error('freeform not visible');
  const scale = await getCanvasScale(page);
  const sx = fb.x + designStartX * scale;
  const sy = fb.y + designStartY * scale;
  const ex = fb.x + designEndX * scale;
  const ey = fb.y + designEndY * scale;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await letReactCatchUp(page);
  await page.mouse.move(ex, ey, { steps: 10 });
  await page.mouse.up();
}

async function getSource(page: Page): Promise<string> {
  return page.locator('.sw-editor-pane').inputValue();
}

// ─── Drag-to-move ────────────────────────────────────────────────

test('drag Box body translates x/y slot fills', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const box = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first();
  await expect(box).toBeVisible();
  await dragByDesign(page, box, 50, 30);
  const source = await getSource(page);
  // x: 400 + 50 = 450, y: 300 + 30 = 330.
  expect(source).toMatch(/x:\s*450\b/);
  expect(source).toMatch(/y:\s*330\b/);
});

test('drag TextBox body translates x/y slot fills', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const tb = page.locator('.sw-canvas-stage [data-sw-component="TextBox"] > div').first();
  await expect(tb).toBeVisible();
  await dragByDesign(page, tb, -75, 40);
  const source = await getSource(page);
  // x: 400 - 75 = 325, y: 300 + 40 = 340.
  expect(source).toMatch(/x:\s*325\b/);
  expect(source).toMatch(/y:\s*340\b/);
});

test('drag Arrow body translates both endpoints', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-arrow');
  // Grab the arrow on the line itself — the SVG's bounding box
  // covers the whole freeform, so dragByDesign(centroid) would land
  // off the line. Use the polygon (arrowhead) which has a tighter
  // hit area at a known location.
  const polygon = page.locator('.sw-canvas-stage [data-sw-component="Arrow"] polygon');
  await expect(polygon).toBeVisible();
  await dragByDesign(page, polygon, 100, 50);
  const source = await getSource(page);
  // All four endpoints shift by the same delta: x1 400→500, y1
  // 300→350, x2 800→900, y2 600→650.
  expect(source).toMatch(/x1:\s*500\b/);
  expect(source).toMatch(/y1:\s*350\b/);
  expect(source).toMatch(/x2:\s*900\b/);
  expect(source).toMatch(/y2:\s*650\b/);
});

// ─── Resize ──────────────────────────────────────────────────────

test('Box SE-corner resize grows width and height', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const box = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first();
  await expect(box).toBeVisible();
  // Click to select; this both selects and (since Box is also
  // draggable) starts a drag — but with zero movement, the gesture
  // ends as a click and just sets selection.
  await box.click();
  // SE handle is 7px past the bottom-right of the selection
  // outline, which itself is 4px outside the shape. So the handle's
  // approximate center is at (boxRight + 4, boxBottom + 4) in
  // design space. Drag the handle by (60, 40) design pixels →
  // width 200→260, height 150→190.
  const seHandle = page.locator('.sw-resize-se');
  await expect(seHandle).toBeVisible();
  await dragByDesign(page, seHandle, 60, 40);
  const source = await getSource(page);
  expect(source).toMatch(/width:\s*260\b/);
  expect(source).toMatch(/height:\s*190\b/);
});

test('Box NW-corner resize shrinks dimensions and shifts origin', async ({
  page,
}) => {
  await page.goto('/canvas.html?fixture=single-box');
  const box = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first();
  await box.click();
  // Drag NW handle by (+30, +20) design — top-left moves inward,
  // shrinking the box and pushing x / y forward.
  const nwHandle = page.locator('.sw-resize-nw');
  await dragByDesign(page, nwHandle, 30, 20);
  const source = await getSource(page);
  // x: 400 + 30, y: 300 + 20, width: 200 - 30, height: 150 - 20.
  expect(source).toMatch(/x:\s*430\b/);
  expect(source).toMatch(/y:\s*320\b/);
  expect(source).toMatch(/width:\s*170\b/);
  expect(source).toMatch(/height:\s*130\b/);
});

test('Arrow endpoint-2 handle moves only the tip', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-arrow');
  // Click the polygon (tip) to select the arrow.
  await page.locator('.sw-canvas-stage [data-sw-component="Arrow"] polygon').click();
  // Two endpoint handles render — first at (x1, y1), second at
  // (x2, y2). Use .nth(1) for the tip handle.
  const tipHandle = page.locator('.sw-arrow-endpoint').nth(1);
  await expect(tipHandle).toBeVisible();
  await dragByDesign(page, tipHandle, 80, -60);
  const source = await getSource(page);
  // x1, y1 unchanged. x2: 800 + 80 = 880, y2: 600 - 60 = 540.
  expect(source).toMatch(/x1:\s*400\b/);
  expect(source).toMatch(/y1:\s*300\b/);
  expect(source).toMatch(/x2:\s*880\b/);
  expect(source).toMatch(/y2:\s*540\b/);
});

// ─── Create ──────────────────────────────────────────────────────

test('Box tool draws a new Box from drag rectangle', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await page.locator('.sw-tool', { hasText: 'Box' }).click();
  // Drag from (300, 200) to (700, 500) in design space — should
  // append `Box { x: 300 y: 200 width: 400 height: 300 ... }`.
  await dragDesignPoints(page, 300, 200, 700, 500);
  const source = await getSource(page);
  expect(source).toMatch(/Box\s*\{[^}]*x:\s*300/s);
  expect(source).toMatch(/Box\s*\{[^}]*y:\s*200/s);
  expect(source).toMatch(/Box\s*\{[^}]*width:\s*400/s);
  expect(source).toMatch(/Box\s*\{[^}]*height:\s*300/s);
});

test('Arrow tool draws a new Arrow from drag', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await page.locator('.sw-tool', { hasText: 'Arrow' }).click();
  await dragDesignPoints(page, 200, 200, 600, 500);
  const source = await getSource(page);
  expect(source).toMatch(/Arrow\s*\{[^}]*x1:\s*200/s);
  expect(source).toMatch(/Arrow\s*\{[^}]*y1:\s*200/s);
  expect(source).toMatch(/Arrow\s*\{[^}]*x2:\s*600/s);
  expect(source).toMatch(/Arrow\s*\{[^}]*y2:\s*500/s);
});

// ─── Delete ──────────────────────────────────────────────────────

test('Delete key removes the selected shape', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const box = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first();
  await box.click();
  // Selection should be visible — outline ensures the keypath has
  // arrived at the active shape before the keypress.
  await expect(page.locator('.sw-selection-outline')).toBeVisible();
  await page.keyboard.press('Delete');
  const source = await getSource(page);
  // Children list now empty; no Box anywhere in the source.
  expect(source).not.toMatch(/Box\s*\{/);
});

// ─── Multi-select ────────────────────────────────────────────────

test('shift-click adds a second shape to the selection', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  const boxes = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div');
  await boxes.nth(0).click();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  // Shift-click extends. Two outlines should render — one per
  // selected shape — so the user can disambiguate the group.
  await boxes.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sw-selection-outline')).toHaveCount(2);
});

test('shift-click again removes a shape from the selection', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  const boxes = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div');
  await boxes.nth(0).click();
  await boxes.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sw-selection-outline')).toHaveCount(2);
  // Shift-click an already-selected shape toggles it off.
  await boxes.nth(0).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
});

test('group drag moves all selected shapes by the same delta', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  const boxes = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div');
  await boxes.nth(0).click();
  await boxes.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sw-selection-outline')).toHaveCount(2);
  // Drag from the first box's body — the whole group should move.
  await dragByDesign(page, boxes.nth(0), 50, 30);
  const source = await getSource(page);
  // Box 1: x 200→250, y 200→230. Box 2: x 800→850, y 500→530.
  expect(source).toMatch(/x:\s*250\b/);
  expect(source).toMatch(/y:\s*230\b/);
  expect(source).toMatch(/x:\s*850\b/);
  expect(source).toMatch(/y:\s*530\b/);
});

test('Delete key removes every selected shape', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  const boxes = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div');
  await boxes.nth(0).click();
  await boxes.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sw-selection-outline')).toHaveCount(2);
  await page.keyboard.press('Delete');
  const source = await getSource(page);
  expect(source).not.toMatch(/Box\s*\{/);
});

test('marquee drag selects every intersecting shape', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  // Both Boxes are at known positions: amber at (200, 200) with
  // size 200x150, cyan at (800, 500) with size 200x150. Dragging
  // a marquee from (100, 100) to (1100, 700) covers the full
  // freeform extent both boxes occupy. Start in empty space (so
  // we don't grab a shape) and release past both.
  await dragDesignPoints(page, 100, 100, 1100, 700);
  await expect(page.locator('.sw-selection-outline')).toHaveCount(2);
});

test('marquee drag missing all shapes leaves selection empty', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  // Drag a small marquee in an empty corner of the freeform.
  // Neither shape's bounds reach into (1500, 50)–(1700, 150).
  await dragDesignPoints(page, 1500, 50, 1700, 150);
  await expect(page.locator('.sw-selection-outline')).toHaveCount(0);
});

test('group bounding box renders only when 2+ shapes are selected', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  const boxes = page.locator('.sw-canvas-stage [data-sw-component="Box"] > div');
  // Single-select: per-shape outline but no group box.
  await boxes.nth(0).click();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  await expect(page.locator('.sw-selection-group')).toHaveCount(0);
  // Multi-select: per-shape outlines + a single group bbox.
  await boxes.nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sw-selection-outline')).toHaveCount(2);
  await expect(page.locator('.sw-selection-group')).toHaveCount(1);
});
