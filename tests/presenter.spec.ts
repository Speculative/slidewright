import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

test('presenter console syncs notes and slide navigation without changing source', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau');
  const before = await getEditorSource(page);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Presenter view', exact: true }).click();
  const presenter = await popupPromise;
  await expect(presenter.getByRole('heading', { name: 'Presenter view', exact: true })).toBeVisible();
  await expect(presenter.getByLabel('Presenter slide')).toContainText('Slide 1 of 20');
  await expect(presenter.getByLabel('Speaker notes')).toContainText("Hello! I'm Jeff");
  await expect(presenter.getByRole('heading', { name: 'Next slide overview' })).toBeVisible();
  const previews = await presenter.locator('.sw-presenter-previews > div').all();
  for (const preview of previews) { const bounds = (await preview.boundingBox())!; expect(bounds.width).toBeLessThan(650); }
  await expect(presenter.getByLabel('Speaker notes')).toBeInViewport();
  await expect(page.locator('.sw-editor-pane')).toBeHidden();
  await presenter.getByRole('button', { name: 'Next slide', exact: true }).click();
  await expect(presenter.getByLabel('Presenter slide')).toContainText('Slide 2 of 20');
  await expect(page.locator('.sw-canvas-stage')).toContainText('Why I Care About Debugging');
  await expect(presenter.getByLabel('Speaker notes')).toContainText('Just to introduce');
  await presenter.locator('h1').click();
  await presenter.keyboard.press('ArrowLeft');
  await expect(presenter.getByLabel('Presenter slide')).toContainText('Slide 1 of 20');
  await page.locator('.sw-standalone-controls').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowRight');
  await expect(presenter.getByLabel('Presenter slide')).toContainText('Slide 2 of 20');
  await expect.poll(() => presenter.getByLabel('Elapsed time').textContent()).not.toBe('00:00');
  await presenter.getByRole('button', { name: 'Reset timer', exact: true }).click();
  await expect(presenter.getByLabel('Elapsed time')).toHaveText('00:00');
  await presenter.screenshot({ path: test.info().outputPath('presenter.png') });
  expect(await getEditorSource(page)).toBe(before);
  await presenter.close();
  const reopened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Presenter view', exact: true }).click();
  const next = await reopened;
  await expect(next.getByLabel('Presenter slide')).toContainText('Slide 2 of 20');
});

test('presenter notes follow live source and popup failure has actionable feedback', async ({ page }) => {
  await page.goto('/canvas.html?deck=plateau');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Presenter view', exact: true }).click();
  const presenter = await popupPromise;
  const source = await getEditorSource(page);
  await setHostSource(page, source.replace("Hello! I'm Jeff", 'Updated speaker notes'));
  await expect(presenter.getByLabel('Speaker notes')).toContainText('Updated speaker notes');
  await presenter.close();
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: 'Presenter view', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Allow this site to open');
});
