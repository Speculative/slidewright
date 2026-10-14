import { expect, test } from '@playwright/test';
import { getEditorSource, setHostSource, selectRichText } from './editor-helpers';

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
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await selectRichText(page, 'Editable child', 0, 'Editable child', 14);
  await page.keyboard.type('Edited nested child');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => getEditorSource(page)).toContain('"Edited nested child"');
});

test('a bullet is directly editable on canvas and round-trips to source', async ({ page }) => {
  const bullet = page.locator('.sw-canvas-stage').getByText('First bullet', { exact: true });
  await bullet.dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await selectRichText(page, 'First bullet', 0, 'First bullet', 12);
  await page.keyboard.type('Edited bullet');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => getEditorSource(page)).toContain('"Edited bullet"');
});

test('Span fields stay out of the inspector and ranges use dedicated controls', async ({ page }) => {
  await page.locator('.sw-hierarchy-node[data-sw-component="Span"]', { hasText: 'Span' }).first().click();
  await expect(page.locator('.sw-inspector-panel-header', { hasText: /^Span/ })).toBeVisible();
  await expect(page.locator('.sw-property-row')).toHaveCount(0);
  await page.locator('.sw-canvas-stage').getByText('style', { exact: true }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await selectRichText(page, 'style', 0, 'style', 5);
  await page.getByLabel('Style value', { exact: true }).fill('52');
  await page.getByRole('button', { name: 'Apply style', exact: true }).click();
  await page.getByRole('button', { name: 'Strikethrough', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('size: 52');
  await expect(page.locator('.sw-canvas-stage [data-sw-component="Span"]', { hasText: 'style' })).toHaveCSS('text-decoration-line', 'line-through');
});

test('missing box policies materialize through dedicated controls', async ({ page }) => {
  await page.locator('.sw-canvas-stage [data-sw-component="TextBox"] > div').first().click();
  await page.getByLabel('TextBox setting', { exact: true }).selectOption('shrinkToFit');
  await page.getByLabel('TextBox setting value', { exact: true }).fill('true');
  await page.getByRole('button', { name: 'Apply box setting', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toContain('shrinkToFit: true');
});

test('TextBox inspector exposes only geometry for filled and missing fields', async ({ page }) => {
  await page.locator('.sw-canvas-stage [data-sw-component="TextBox"] > div').first().click();
  await expect(page.locator('.sw-property-row')).toHaveCount(4);
  for (const name of ['x', 'y', 'width', 'height']) {
    await expect(page.locator('.sw-property-row', { hasText: new RegExp(`^${name}`) })).toHaveCount(1);
  }
  for (const name of ['content', 'font', 'color', 'wrap', 'shrinkToFit']) {
    await expect(page.locator('.sw-property-row', { hasText: new RegExp(`^${name}`) })).toHaveCount(0);
  }
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

test('a paragraph-only document does not render a list or legacy placeholders', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await expect(page.locator('.sw-canvas-stage [data-sw-textbox-content="true"] ul')).toHaveCount(0);
  await expect(page.locator('.sw-canvas-stage')).not.toContainText('bullets…');
});

test('paragraphs preserve spacing, alignment, and independent source edits', async ({ page }) => {
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
    TextBox { x: 240 y: 180 width: 900 height: 600 fontSize: 32 content: [
      Paragraph { spaceBefore: 12 spaceAfter: 24 align: "right" lineHeight: 1.6 content: ["First paragraph"] }
      Paragraph { content: ["Second paragraph"] }
    ] }
  ] } }] }`);
  const paragraphs = page.locator('.sw-canvas-stage p[data-sw-component="Paragraph"]');
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.first()).toHaveCSS('margin-top', '12px');
  await expect(paragraphs.first()).toHaveCSS('margin-bottom', '24px');
  await expect(paragraphs.first()).toHaveCSS('text-align', 'right');
  await expect(paragraphs.first()).toHaveCSS('line-height', '51.2px');
  await paragraphs.last().getByText('Second paragraph', { exact: true }).dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await selectRichText(page, 'Second paragraph', 0, 'Second paragraph', 16);
  await page.keyboard.type('Edited second paragraph');
  await page.keyboard.press('ControlOrMeta+Enter');
  const source = await getEditorSource(page);
  expect(source).toContain('"First paragraph"');
  expect(source).toContain('"Edited second paragraph"');
  expect(source).toContain('spaceAfter: 24');
  await expect(paragraphs.first()).toHaveCSS('line-height', '51.2px');
});

test('missing text document materializes a canonical paragraph when edited', async ({ page }) => {
  await setHostSource(page, 'Deck { slides: [Slide { content: Freeform { children: [TextBox { x: 240 y: 180 width: 900 height: 300 }] } }] }');
  await page.locator('.sw-canvas-stage').getByText('content…', { exact: true }).dblclick();
  await page.keyboard.type('New paragraph');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => getEditorSource(page)).toMatch(/content:\s*\[\s*Paragraph\s*\{\s*content:\s*\[\s*"New paragraph"/);
  await expect(page.locator('.sw-canvas-stage p[data-sw-component="Paragraph"]')).toHaveText('New paragraph');
});
