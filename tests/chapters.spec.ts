import { test, expect } from '@playwright/test';
import { getEditorSource } from './editor-helpers';
import { parse } from '../slidewright/runtime/parser.js';

test('chapter rename propagates, boundaries survive hidden footers, and slides can opt out', async ({ page }) => {
  await page.goto('/canvas.html?fixture=chapters');
  const crumb = page.locator('.sw-canvas-stage .crumb');
  await expect(crumb).toHaveText('UIST 2026 // Introduction');
  await expect(crumb.locator('.sep')).toHaveCount(1);
  await page.locator('.sw-hierarchy-slide-row').click();
  const chapter = page.locator('.sw-property-row').filter({ has: page.locator('.sw-property-key', { hasText: /^chapter$/ }) }).locator('input');
  await chapter.fill('"Motivation"');
  await chapter.press('Enter');
  await expect(crumb).toContainText('Motivation');
  expect((await getEditorSource(page)).match(/Motivation/g)).toHaveLength(1);
  await page.getByRole('option', { name: 'Slide 2', exact: true }).click();
  await expect(crumb).toContainText('Motivation');
  await page.locator('.sw-hierarchy-slide-row').click();
  await page.getByLabel('chapter (default)', { exact: true }).fill('"Details"');
  await page.getByLabel('chapter (default)', { exact: true }).press('Enter');
  await expect(crumb).toContainText('Details');
  await page.getByRole('option', { name: 'Slide 3', exact: true }).click();
  await expect(crumb).toHaveCount(0);
  await page.getByRole('option', { name: 'Slide 4', exact: true }).click();
  await expect(crumb).toContainText('Demo');
  await page.locator('.sw-hierarchy-slide-row').click();
  await page.getByLabel('chromeless (default)', { exact: true }).fill('true');
  await page.getByLabel('chromeless (default)', { exact: true }).press('Enter');
  await expect(crumb).toHaveCount(0);
});


test('working UIST deck displays its footer in editing and presentation', async ({ page }) => {
  await page.goto('/canvas.html?deck=uist-2026');
  // The working talk is actively edited, including its chapter names and
  // chromeless title slide. Check the first authored footer against source.
  const { ast } = parse(await getEditorSource(page), 'deck.sw');
  const deck = ast.items[0]!;
  const name = deck.fills.find(fill => fill.name === 'name')!.value;
  const slides = deck.fills.find(fill => fill.name === 'slides')!.value;
  if (name.kind !== 'string' || slides.kind !== 'list') throw new Error('Expected a deck with slides');
  let chapter = 'Chapter 1';
  let visible = -1;
  for (const [index, slide] of slides.items.entries()) {
    if (slide.kind !== 'component') continue;
    const boundary = slide.fills.find(fill => fill.name === 'chapter')?.value;
    if (boundary?.kind === 'string') chapter = boundary.value;
    const hidden = slide.fills.find(fill => fill.name === 'chromeless')?.value;
    if (hidden?.kind !== 'boolean' || !hidden.value) { visible = index; break; }
  }
  expect(visible).toBeGreaterThanOrEqual(0);
  await page.getByRole('option', { name: `Slide ${visible + 1}`, exact: true }).click();
  const crumb = page.locator('.sw-canvas-stage .crumb');
  await expect(crumb).toHaveText(`${name.value} // ${chapter}`);
  await expect(crumb).toBeVisible();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(crumb).toBeVisible();
  await page.screenshot({ path: 'test-results/uist-chapter-footer.png' });
});
