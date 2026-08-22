import { expect, test } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/canvas.html?fixture=slide-grade-text');
});

test('TextBox renders slide typography, wrapping, mixed runs, and numbered bullets', async ({ page }) => {
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content="true"]').first();
  await expect(content).toHaveCSS('font-family', /Arvo|Georgia/);
  await expect(content).toHaveCSS('font-size', '42px');
  await expect(content).toHaveCSS('font-weight', '500');
  await expect(content).toHaveCSS('line-height', '58.8px');
  await expect(content).toHaveCSS('letter-spacing', '1.5px');
  await expect(content).toHaveCSS('text-align', 'center');
  await expect(content.locator('ol')).toHaveAttribute('start', '3');
  await expect(content.locator('ol')).toHaveCSS('list-style-type', 'decimal');
  await expect(content.locator('li')).toHaveCount(2);

  const styled = content.locator('[data-sw-component="Span"]', { hasText: 'style' });
  await expect(styled).toHaveCSS('font-size', '48px');
  await expect(styled).toHaveCSS('font-weight', '700');
  await expect(styled).toHaveCSS('letter-spacing', '2px');
});

test('Span supports underline, strikethrough, and source-backed links', async ({ page }) => {
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content="true"]').first();
  const underline = content.locator('[data-sw-component="Span"]', { hasText: 'underline' });
  const strike = content.locator('[data-sw-component="Span"]', { hasText: 'strike' });
  const link = content.locator('a[data-sw-component="Span"]', { hasText: 'link' });

  await expect(underline).toHaveCSS('text-decoration-line', 'underline');
  await expect(strike).toHaveCSS('text-decoration-line', 'line-through');
  await expect(link).toHaveAttribute('href', 'https://example.com/rich-text');
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
});

test('structured lists support ordered markers, starts, and nesting', async ({ page }) => {
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content="true"]').nth(1);
  const outer = content.locator('ol[data-sw-component="List"]').first();
  const nested = outer.locator('ul[data-sw-component="List"]');

  await expect(outer).toHaveAttribute('start', '2');
  await expect(outer).toHaveCSS('list-style-type', 'upper-alpha');
  await expect(outer.locator(':scope > li')).toHaveCount(2);
  await expect(nested).toHaveCSS('list-style-type', 'square');
  await expect(nested.locator(':scope > li')).toHaveCount(2);
});

test('text inside a nested list remains directly editable on canvas', async ({ page }) => {
  const child = page.locator('.sw-canvas-stage').getByText('Editable child', { exact: true });
  await child.dblclick();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Edited nested child');
  await page.keyboard.press('Enter');
  await expect.poll(() => getEditorSource(page)).toContain('"Edited nested child"');
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
  const content = page.locator('.sw-canvas-stage [data-sw-textbox-content="true"]').first();
  await expect.poll(async () => parseFloat(await content.evaluate((el) => getComputedStyle(el).fontSize))).toBeLessThan(42);
  await expect.poll(() => getEditorSource(page)).toContain('fontSize: 42');
});

test('an omitted optional bullets slot does not render placeholder bullets', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await expect(page.locator('.sw-canvas-stage [data-sw-textbox-content="true"] ul')).toHaveCount(0);
  await expect(page.locator('.sw-canvas-stage')).not.toContainText('bullets…');
});
