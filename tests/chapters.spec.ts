import { test, expect } from '@playwright/test';
import { getEditorSource } from './editor-helpers';

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
  const crumb = page.locator('.sw-canvas-stage .crumb');
  await expect(crumb).toHaveText('UIST 2026 // Chapter 1');
  await expect(crumb).toBeVisible();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(crumb).toBeVisible();
  await page.screenshot({ path: 'test-results/uist-chapter-footer.png' });
});
