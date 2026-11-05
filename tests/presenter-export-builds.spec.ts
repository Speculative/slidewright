import { test, expect } from '@playwright/test';
import { getEditorSource } from './editor-helpers';

test('speaker console follows authored frames and shares audience navigation', async ({ page }) => {
  await page.goto('/canvas.html?fixture=presenter-export-builds');
  const source = await getEditorSource(page);
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Presenter view', exact: true }).click();
  const presenter = await popup;
  const current = presenter.locator('.sw-presenter-previews > div').first();
  const next = presenter.locator('.sw-presenter-previews > div').nth(1);
  const audience = page.locator('.sw-canvas-stage');
  await expect(presenter.getByLabel('Presenter build')).toHaveText('Build 1 of 3');
  await expect(current).toContainText('Initial caption');
  await expect(next).toContainText('Revealed caption');
  await expect(current.locator('section.slide')).toHaveCSS('width', '960px');
  await expect(presenter.getByLabel('Speaker notes')).toContainText('Explain the reveal.');
  await presenter.getByRole('button', { name: 'Next slide', exact: true }).click();
  await expect(audience).toContainText('Revealed caption');
  await expect(current).toContainText('Revealed caption');
  await expect(next).toContainText('Final caption');
  await presenter.keyboard.press('ArrowRight');
  await expect(presenter.getByLabel('Presenter build')).toHaveText('Build 3 of 3');
  await expect(next).toContainText('Closing caption');
  await page.locator('.sw-canvas-stage .presentation-canvas').click({ position: { x: 10, y: 10 } });
  await expect(presenter.getByLabel('Presenter slide')).toContainText('Slide 2 of 2');
  await expect(presenter.getByLabel('Speaker notes')).toContainText('Thank the audience.');
  await presenter.getByRole('button', { name: 'Previous slide', exact: true }).click();
  await expect(presenter.getByLabel('Presenter build')).toHaveText('Build 3 of 3');
  await presenter.keyboard.press('r');
  await expect(current).toContainText('Initial caption');
  await expect(presenter.getByLabel('Presenter build')).toHaveText('Build 1 of 3');
  expect(await getEditorSource(page)).toBe(source);
});

for (const mode of ['final', 'builds']) {
  test(`PDF ${mode} resolves independent pages and preserves the canvas`, async ({ page, context }) => {
    await context.addInitScript(() => { window.print = () => { document.documentElement.dataset.printCalled = 'true'; }; });
    await page.goto('/canvas.html?fixture=presenter-export-builds');
    const source = await getEditorSource(page);
    await page.getByRole('option', { name: 'Slide 1 build 1:', exact: false }).click();
    await expect(page.locator('.sw-canvas-stage')).toContainText('Revealed caption');
    await page.getByLabel('PDF pages').selectOption(mode);
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
    const print = await popup;
    await expect(print.locator('.sw-print-document')).toHaveAttribute('data-ready', 'true');
    await expect(print.locator('html')).toHaveAttribute('data-print-called', 'true');
    const pages = print.locator('.sw-print-page');
    await expect(pages).toHaveCount(mode === 'final' ? 2 : 4);
    await expect(pages.first()).toContainText(mode === 'final' ? 'Final caption' : 'Initial caption');
    await expect(pages.last()).toContainText('Closing caption');
    await expect(pages.last().locator('.crumb')).toContainText('Opening chapter');
    await expect(pages.first()).toHaveCSS('width', '960px');
    await expect(pages.first()).toHaveCSS('height', '540px');
    await expect(pages.first().locator('[data-sw-component="TextBox"] > div')).toHaveCSS('color', 'oklch(0.45 0.12 250)');
    expect(await pages.first().locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    if (mode === 'builds') {
      await expect(pages.nth(1)).toContainText('Revealed caption');
      await expect(pages.nth(2)).toContainText('Final caption');
      await expect(pages.first().locator('[data-sw-component="Box"]')).toHaveCount(0);
      await expect(pages.nth(1).locator('[data-sw-component="Box"]')).toHaveCount(1);
    }
    await print.emulateMedia({ media: 'print' });
    await expect(print.locator('.sw-print-controls')).toBeHidden();
    const pdf = await print.pdf({ preferCSSPageSize: true, printBackground: true });
    // Chromium's page tree contains one /Type /Page entry per emitted sheet.
    const pageCount = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
    expect(pageCount).toBe(mode === 'final' ? 2 : 4);
    await expect(page.locator('.sw-canvas-stage')).toContainText('Revealed caption');
    expect(await getEditorSource(page)).toBe(source);
  });
}

test('PDF exports every custom animation stage at its end state', async ({ page, context }) => {
  await context.addInitScript(() => { window.print = () => {}; });
  await page.goto('/canvas.html?fixture=plateau-charts');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const print = await popup;
  await expect(print.locator('.sw-print-document')).toHaveAttribute('data-ready', 'true');
  await expect(print.locator('[data-sw-chart="collection"]').first()).toHaveAttribute('data-step', '2');
  await expect(print.getByRole('group', { name: 'Chart playback' })).toHaveCount(0);
  await page.getByLabel('PDF pages').selectOption('builds');
  const initialPopup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const initial = await initialPopup;
  await expect(initial.locator('.sw-print-document')).toHaveAttribute('data-ready', 'true');
  const collection = initial.locator('[data-sw-chart="collection"]');
  await expect(collection).toHaveCount(3);
  for (let step = 0; step < 3; step++) {
    await expect(collection.nth(step)).toHaveAttribute('data-step', String(step));
  }
  // The middle stage fades the breakpoint away; capture the completed fade.
  await expect(collection.nth(1).locator('[data-chart-breakpoint]')).toHaveCSS('opacity', '0');
  await expect(initial.getByRole('group', { name: 'Chart playback' })).toHaveCount(0);
  const pdf = await initial.pdf({ preferCSSPageSize: true, printBackground: true });
  expect([...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length)
    .toBe(await initial.locator('.sw-print-page').count());
});

test('PDF captures timed calculator playback at each stage endpoint', async ({ page, context }) => {
  await context.addInitScript(() => { window.print = () => {}; });
  await page.goto('/canvas.html?fixture=calculator-slide-transition');
  await page.getByLabel('PDF pages').selectOption('builds');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const print = await popup;
  await expect(print.locator('.sw-print-document')).toHaveAttribute('data-ready', 'true');
  await expect(print.locator('.sw-print-page')).toHaveCount(7);
  const stages = print.locator('[data-demo-calculator-print]');
  await expect(stages).toHaveCount(5);
  await expect(stages.nth(3)).toHaveAttribute('data-frame', '7');
  await expect(stages.nth(4)).toHaveAttribute('data-frame', '23');
  await expect(stages.nth(4)).toContainText('26');
  // Print output must remain settled rather than progressing after readiness.
  await expect(stages.nth(4).locator('[data-demo-paused-line]')).toHaveCount(1);
});

test('PDF captures stepping debugger targets without timed intermediate states', async ({ page, context }) => {
  await context.addInitScript(() => { window.print = () => {}; });
  await page.goto('/canvas.html?fixture=stepping-debugger');
  await page.getByLabel('PDF pages').selectOption('builds');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const print = await popup;
  await expect(print.locator('.sw-print-document')).toHaveAttribute('data-ready', 'true');
  const stages = print.locator('[data-sw-breakpoint-debugger]');
  await expect(stages).toHaveCount(3);
  for (let step = 0; step < 3; step++) {
    await expect(stages.nth(step)).toHaveAttribute('data-step', String(step));
    await expect(stages.nth(step)).toHaveAttribute('data-animating', 'false');
  }
});

test('speaker notes button downloads notes for the whole deck', async ({ page }) => {
  await page.goto('/canvas.html?fixture=presenter-export-builds');
  const source = await getEditorSource(page);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export speaker notes', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/-speaker-notes\.txt$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const notes = Buffer.concat(chunks).toString('utf8');
  expect(notes).toContain('Slide 1 — Diagram\n\nExplain the reveal.');
  expect(notes).toContain('Slide 2 — Closing\n\nThank the audience.');
  expect(notes.indexOf('Explain the reveal.')).toBeLessThan(notes.indexOf('Thank the audience.'));
  expect(await getEditorSource(page)).toBe(source);
});
