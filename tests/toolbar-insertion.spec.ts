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
import { getEditorSource } from './editor-helpers';

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

test('expanded toolbar scrolls within the stage and leaves the inspector usable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/canvas.html?fixture=single-box');
  const palette = page.locator('.sw-tool-palette');
  await expect(palette).toHaveCSS('overflow-y', 'auto');
  await page.locator('.sw-hierarchy-node[data-sw-adapter-kind="shape"]').first().click();
  const key = page.locator('.sw-property-row', { hasText: /^x/ }).first().locator('.sw-property-key');
  const bounds = await key.boundingBox();
  if (!bounds) throw new Error('Missing inspector key');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('sw-property-key'), { x, y })).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.locator('body.sw-scrubbing')).toHaveCount(1);
  await page.mouse.move(x + 50, y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => getSource(page)).toMatch(/x:\s*450/);
  await palette.getByRole('button', { name: 'Video', exact: true }).click();
  await expect(palette.getByRole('button', { name: 'Video', exact: true })).toHaveAttribute('aria-pressed', 'true');
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

// ─── Bug-fix regression coverage (2026-05-18) ─────────────────────
//
// Four bugs in the array-slot drop path, each blocking a different
// authoring shape. Each test loads a fixture that exercises one
// shape and asserts the drop commits.

// Bug #1: single-child stack. Without parent-name axis derivation,
// the two-child geometry heuristic falls back to the wrong axis at
// N=1 and the wrapper-bounds containment test excludes the natural
// drop region along the stack axis.
test('drag inserts before the single child of a VStack', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-child-vstack');
  const card = page
    .locator(
      '[data-sw-slot-name="children"][data-sw-slot-type^="array<"] [data-sw-component="CardRow"] > *',
    )
    .first();
  const box = await card.boundingBox();
  if (!box) throw new Error('single child not visible');
  // Aim a few pixels above the card — the before-first gap. With
  // the bug present, axis is 'h' and this point is outside the
  // wrapper's vertical extent, so no drop registers.
  await dragToolToPoint(page, 'VStack', box.x + box.width / 2, box.y - 2);
  const source = await getSource(page);
  // New VStack appears before the single CardRow.
  expect(source).toMatch(/children:\s*\[\s*VStack\s*\{[^}]*\}\s*CardRow/s);
});

test('drag inserts after the single child of a VStack', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-child-vstack');
  const card = page
    .locator(
      '[data-sw-slot-name="children"][data-sw-slot-type^="array<"] [data-sw-component="CardRow"] > *',
    )
    .first();
  const box = await card.boundingBox();
  if (!box) throw new Error('single child not visible');
  await dragToolToPoint(
    page,
    'VStack',
    box.x + box.width / 2,
    box.y + box.height + 2,
  );
  const source = await getSource(page);
  // New VStack appears after the existing CardRow.
  expect(source).toMatch(/CardRow\s*\{[^}]*\}\s*VStack\s*\{[^}]*\}\s*\]/s);
});

// Bug #2: empty `children: []` array. No rendered children means
// no rects to anchor a gap to. Falls back to the parent stack's
// own bounding rect for a single index-0 gap.
test('drag into an empty children:[] array materializes the first child', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-vstack');
  // The empty VStack renders as a flex container with no children.
  // Aim at the VStack's rendered div directly (its first non-
  // display-contents descendant).
  const stack = page
    .locator('[data-sw-component="VStack"] > div')
    .first();
  const box = await stack.boundingBox();
  if (!box) throw new Error('empty VStack not visible');
  // Place the pointer inside the stack's area. The parent box may
  // be very thin (no children) — aim at its center.
  await dragToolToPoint(
    page,
    'VStack',
    box.x + box.width / 2,
    box.y + Math.max(box.height / 2, 4),
  );
  const source = await getSource(page);
  // After insertion, the children array contains exactly one
  // VStack. Match the outer VStack's children specifically.
  expect(source).toMatch(/children:\s*\[\s*VStack\s*\{/s);
});

// Bug #3: implicit-children syntax. `VStack { Box {...} }` (no
// `children:` fill) skips the slot wrapper in the loader unless
// the implicit-children branch also emits it.
test('drag into an implicit-children VStack inserts via the slot wrapper', async ({ page }) => {
  await page.goto('/canvas.html?fixture=implicit-children-vstack');
  // The implicit-children path should emit the same
  // data-sw-slot-name="children" wrapper as explicit fills.
  // Locate the first CardRow inside that wrapper.
  const card = page
    .locator(
      '[data-sw-slot-name="children"][data-sw-slot-type^="array<"] [data-sw-component="CardRow"] > *',
    )
    .first();
  const box = await card.boundingBox();
  if (!box) throw new Error('first card not visible');
  // Aim above the first card to hit the before-first gap.
  await dragToolToPoint(page, 'VStack', box.x + box.width / 2, box.y - 2);
  const source = await getSource(page);
  // The implicit-children body now has a VStack ahead of the
  // first CardRow. Match the new VStack appearing before the
  // first eyebrow text.
  expect(source).toMatch(/VStack\s*\{[^}]*\}\s*CardRow\s*\{[^}]*First/s);
});

// Bug #4: nested array wrappers. Outer VStack's children-wrapper
// appears earlier in DOM order; without innermost-wins, it always
// masks the inner HStack. This was the original user repro.
test('drag into nested HStack targets the inner stack, not the outer VStack', async ({ page }) => {
  await page.goto('/canvas.html?fixture=nested-stacks');
  // The inner CardRow lives inside the HStack. Hover the pointer
  // on its right edge — that's the after-last gap of the HStack,
  // but the outer VStack's bounds also contain this point.
  const innerCard = page
    .locator(
      '[data-sw-component="HStack"] [data-sw-component="CardRow"] > *',
    )
    .first();
  const box = await innerCard.boundingBox();
  if (!box) throw new Error('inner card not visible');
  await dragToolToPoint(
    page,
    'VStack',
    box.x + box.width + 4,
    box.y + box.height / 2,
  );
  const source = await getSource(page);
  // After insertion, the HStack's children list has two entries:
  // the original CardRow plus the new VStack. The outer VStack's
  // children list should still be [HStack { ... }, CardRow] — only
  // two top-level children, unchanged.
  expect(source).toMatch(
    /HStack\s*\{[^]*?CardRow\s*\{[^}]*Inner[^}]*\}\s*VStack\s*\{[^}]*\}[^]*?\]/,
  );
  // And the new VStack must NOT have landed at the outer VStack
  // level (would have appeared between the HStack and the Outer
  // CardRow).
  expect(source).not.toMatch(/\}\s*VStack\s*\{[^}]*\}\s*CardRow\s*\{[^}]*Outer/s);
});

// Bug #4 follow-up: when the user aims above the inner HStack (the
// outer VStack's before-first gap), the outer VStack must win
// even though both wrappers contain the pointer along the inner
// HStack's edge. Closest-gap-wins (not innermost-wins) gives the
// outer's full-width gap-0 strip a distance-0 match while the
// inner's gap-0 strip (at HStack.left) is far horizontally.
test('drag aiming above the inner HStack inserts at outer VStack position 0', async ({ page }) => {
  await page.goto('/canvas.html?fixture=nested-stacks');
  const hstack = page
    .locator('[data-sw-component="HStack"]')
    .first()
    .locator(':scope > div')
    .first();
  const box = await hstack.boundingBox();
  if (!box) throw new Error('inner HStack not visible');
  // Aim 2px above the HStack's top edge, horizontally centered.
  await dragToolToPoint(
    page,
    'VStack',
    box.x + box.width / 2,
    box.y - 2,
  );
  const source = await getSource(page);
  // After insertion the outer VStack's children list reads:
  // VStack, HStack, CardRow. The new VStack must come first.
  expect(source).toMatch(/children:\s*\[\s*VStack\s*\{[^}]*\}\s*HStack/s);
});
