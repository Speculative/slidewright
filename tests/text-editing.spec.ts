import { expect, test } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
});

test('TextBox renders slide typography, wrapping, mixed runs, and bullets', async ({ page }) => {
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content="true"]');
  await expect(content).toHaveCSS('font-family', /Arvo|Georgia/);
  await expect(content).toHaveCSS('font-size', '42px');
  await expect(content).toHaveCSS('font-weight', '500');
  await expect(content).toHaveCSS('line-height', '58.8px');
  await expect(content).toHaveCSS('letter-spacing', '1.5px');
  await expect(content).toHaveCSS('text-align', 'center');
  await expect(content.locator('li')).toHaveCount(2);

  const styled = content.locator('[data-sw-component="Span"]', { hasText: 'style' });
  await expect(styled).toHaveCSS('font-size', '48px');
  await expect(styled).toHaveCSS('font-weight', '700');
  await expect(styled).toHaveCSS('letter-spacing', '2px');
});

test('a bullet is directly editable on canvas and round-trips to source', async ({ page }) => {
  const bullet = page.locator('.sw-canvas-stage').getByText('First bullet', { exact: true });
  await bullet.dblclick();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Edited bullet');
  await page.keyboard.press('Enter');
  await expect.poll(() => getEditorSource(page)).toContain('"Edited bullet"');
});

test('mixed Span runs are selectable and editable in the inspector', async ({ page }) => {
  await page.locator('.sw-hierarchy-node[data-sw-component="Span"]', { hasText: 'Span' }).first().click();
  await expect(page.locator('.sw-inspector-panel-header', { hasText: /^Span/ })).toBeVisible();
  const size = page.locator('.sw-property-row', { hasText: /^size/ }).locator('input');
  await size.fill('52');
  await size.press('Enter');
  await expect.poll(() => getEditorSource(page)).toContain('size: 52');
  await expect(page.locator('.sw-canvas-stage [data-sw-component="Span"]', { hasText: 'style' })).toHaveCSS('font-size', '52px');
});

test('missing text parameters can be materialized from the inspector', async ({ page }) => {
  await page.locator('.sw-canvas-stage [data-sw-component="TextBox"] > div').first().click();
  const shrink = page.locator('.sw-property-row', { hasText: /^shrinkToFit/ }).locator('input');
  await expect(shrink).toHaveValue('false');
  await shrink.fill('true');
  await shrink.press('Enter');
  await expect.poll(() => getEditorSource(page)).toContain('shrinkToFit: true');
});

test('primitive bullet list items are editable in the inspector', async ({ page }) => {
  await page.locator('.sw-canvas-stage [data-sw-component="TextBox"] > div').first().click();
  const bullets = page.locator('.sw-property-row', { hasText: /^bullets/ });
  const first = bullets.locator('.sw-property-list-item-input').first();
  await first.fill('"Inspector bullet"');
  await first.press('Enter');
  await expect.poll(() => getEditorSource(page)).toContain('"Inspector bullet"');
});

test('shrink-to-fit reduces rendered size without changing the requested source size', async ({ page }) => {
  const source = await getEditorSource(page);
  await setHostSource(
    page,
    source
      .replace('height: 440', 'height: 90')
      .replace('wrap: true', 'wrap: true\n            shrinkToFit: true'),
  );
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content="true"]');
  await expect.poll(async () => parseFloat(await content.evaluate((el) => getComputedStyle(el).fontSize))).toBeLessThan(42);
  await expect.poll(() => getEditorSource(page)).toContain('fontSize: 42');
});

test('an omitted optional bullets slot does not render placeholder bullets', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await expect(page.locator('.sw-canvas-stage [data-sw-textbox-content="true"] ul')).toHaveCount(0);
  await expect(page.locator('.sw-canvas-stage')).not.toContainText('bullets…');
});
