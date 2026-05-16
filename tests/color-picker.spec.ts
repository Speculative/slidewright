// End-to-end tests for the inspector color picker — palette swatch
// commits, OKLCH plane / hue-slider commits, popover lifecycle.
//
// Loads `two-boxes` (which has `fill: amber` and `fill: cyan` on
// the two Boxes) and drives interactions on the `fill` property
// row, asserting source-text changes via the standalone's
// EditorPane.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function getSource(page: Page): Promise<string> {
  return page.locator('.sw-editor-pane').inputValue();
}

async function selectFirstBox(page: Page): Promise<void> {
  await page.locator('.sw-hierarchy-node').first().click();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
}

// Focus the `fill` property row's text input to open the picker
// popover. The cell wraps the input + preview swatch and opens
// the popover on focus.
async function openFillPicker(page: Page): Promise<void> {
  await page.locator('.sw-color-cell input.sw-property-value').first().focus();
  await expect(page.locator('.sw-color-popover')).toBeVisible();
}

test('focusing a color row opens the popover; clicking outside closes it', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectFirstBox(page);
  await openFillPicker(page);
  // Mousedown on the canvas-stage (outside cell + popover) closes.
  await page.locator('.sw-canvas-stage').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.sw-color-popover')).toHaveCount(0);
});

test('Escape closes the popover', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectFirstBox(page);
  await openFillPicker(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sw-color-popover')).toHaveCount(0);
});

test('clicking a global-token swatch commits a name_ref to source', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectFirstBox(page);
  // Initial source: `fill: amber`.
  expect(await getSource(page)).toContain('fill: amber');
  await openFillPicker(page);
  // Pick the `purple` swatch from the global token row.
  await page
    .locator('.sw-color-palette-row [aria-label="purple"]')
    .first()
    .click();
  // Splice happens through commitColorValue → host.setSource. The
  // canonical emitter formats the fill identically; the bare token
  // name appears in the new source.
  await expect.poll(() => getSource(page)).toContain('fill: purple');
});

test('clicking the picker plane commits an oklch literal to source', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectFirstBox(page);
  await openFillPicker(page);
  // Click somewhere inside the plane. Position doesn't matter for
  // the assertion — we only verify the source now carries an oklch
  // literal in place of the prior token. The plane wrapper is the
  // pointerdown target.
  const plane = page.locator('.sw-color-picker-plane');
  await plane.click({ position: { x: 60, y: 40 } });
  await expect.poll(() => getSource(page)).toMatch(/fill: oklch\(/);
});

test('clicking the hue slider with an oklch value rotates the hue', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectFirstBox(page);
  await openFillPicker(page);
  // First convert to an oklch literal via the plane.
  await page.locator('.sw-color-picker-plane').click({ position: { x: 60, y: 40 } });
  await expect.poll(() => getSource(page)).toMatch(/fill: oklch\(/);
  const beforeSrc = await getSource(page);
  const beforeMatch = beforeSrc.match(/fill: oklch\((\S+)\s+(\S+)\s+(\S+)\)/);
  expect(beforeMatch).not.toBeNull();
  const beforeHue = parseFloat(beforeMatch![3]!);
  // Click the far right of the hue slider — should move hue toward 360°.
  const slider = page.locator('.sw-color-picker-hue');
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  await slider.click({
    position: { x: box!.width - 5, y: box!.height / 2 },
  });
  await expect
    .poll(async () => {
      const m = (await getSource(page)).match(/fill: oklch\(\S+\s+\S+\s+(\S+)\)/);
      return m ? parseFloat(m[1]!) : NaN;
    })
    .toBeGreaterThan(beforeHue);
});

test('entering a value in the L field commits a new oklch literal', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectFirstBox(page);
  await openFillPicker(page);
  // First produce an oklch literal so the L field has something to
  // edit relative to (otherwise the default L=0.7 already matches
  // a no-op commit when typed back in).
  await page.locator('.sw-color-picker-plane').click({ position: { x: 60, y: 40 } });
  await expect.poll(() => getSource(page)).toMatch(/fill: oklch\(/);
  // Type a new L value. The field is the first input inside the
  // picker's fields row.
  const lInput = page.locator('.sw-color-picker-fields input').first();
  await lInput.click();
  await lInput.fill('0.42');
  await lInput.press('Enter');
  await expect
    .poll(async () => {
      const m = (await getSource(page)).match(/fill: oklch\((\S+)\s/);
      return m ? m[1]! : '';
    })
    .toBe('0.42');
});

test('picker initializes to the resolved current color, not the default', async ({ page }) => {
  // The first Box in two-boxes uses `fill: amber`. Opening the
  // picker should resolve `var(--amber)` to its actual RGB and
  // map that to an OKLCH H near amber (orange) — not the default
  // blue at 240°.
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectFirstBox(page);
  await openFillPicker(page);
  // H input is the third L/C/H field.
  const hInput = page.locator('.sw-color-picker-fields input').nth(2);
  const hVal = parseFloat(await hInput.inputValue());
  // Amber resolves around 65° in OKLCH (orange band). Anywhere in
  // a permissive [30, 100] window is acceptable; the point of the
  // assertion is that it's nowhere near 240° (the old default).
  expect(hVal).toBeGreaterThan(30);
  expect(hVal).toBeLessThan(100);
});

test('per-slide colors row surfaces oklch literals already in the slide', async ({ page }) => {
  // The reference deck has `fill: oklch(0.62 0.22 25)` on slide 2's
  // third Box. Loading that source should populate a per-slide
  // swatch the user can click to re-apply.
  await page.goto('/canvas.html');
  // Navigate to slide 2 (the Freeform demo with three Boxes — the
  // third uses an `oklch(...)` literal).
  await page.locator('.sw-thumb').nth(1).click();
  // Select the first Box on that slide.
  await page.locator('.sw-hierarchy-node').first().click();
  await openFillPicker(page);
  // The per-slide palette row should be present (oklch literal is
  // not in the global tokens).
  await expect(page.locator('.sw-color-palette-slide')).toBeVisible();
});
