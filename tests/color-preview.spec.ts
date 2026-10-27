import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

async function sourceWrites(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as {
      __slidewrightHost: { setSource(source: string): void };
      colorPreviewWrites: number;
    };
    const host = state.__slidewrightHost;
    const original = host.setSource.bind(host);
    state.colorPreviewWrites = 0;
    host.setSource = source => { state.colorPreviewWrites++; original(source); };
  });
  return () => page.evaluate(() => (window as unknown as { colorPreviewWrites: number }).colorPreviewWrites);
}

for (const picker of ['inspector', 'shape', 'text'] as const) {
  for (const control of ['plane', 'hue', 'lightness'] as const) {
    test(`${picker} ${control} previews affect only the target and write source once on release`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/canvas.html?fixture=empty-freeform');
      await getEditorSource(page);
      const slide = `Slide { content: Freeform { children: [
        Box { x: 200 y: 300 width: 200 height: 150 fill: purple }
        Box { x: 800 y: 300 width: 200 height: 150 fill: amber }
        TextBox { x: 200 y: 600 width: 600 height: 150 color: purple content: [
          Paragraph { content: ["Hello" Span { color: amber content: " styled" }] }
        ] }
      ] } }`;
      // The source-write count is a deterministic performance assertion:
      // pointer movement must not trigger a deck reload, even for a large deck.
      const before = `Deck { slides: [${Array(100).fill(slide).join('\n')}] }`;
      await setHostSource(page, before);
      const kind = picker === 'text' ? 'TextBox' : 'Box';
      await page.locator(`.sw-hierarchy-node[data-sw-component="${kind}"]`).first().click();
      if (picker === 'inspector') await page.locator('.sw-color-cell input.sw-property-value').first().focus();
      else await page.getByRole('button', { name: picker === 'shape' ? 'Fill color picker' : 'Foreground color picker', exact: true }).click();
      const writes = await sourceWrites(page);
      const stage = page.locator('.sw-canvas-stage');
      const target = picker === 'text' ? stage.getByText('styled', { exact: false })
        : stage.locator('[data-sw-component="Box"] > div').first();
      const property = picker === 'text' ? 'color' : 'backgroundColor';
      const color = () => target.evaluate((element, property) => getComputedStyle(element)[property], property);
      const original = await color();
      const untouched = stage.locator('[data-sw-component="Box"] > div').nth(1);
      const otherColor = await untouched.evaluate(element => getComputedStyle(element).backgroundColor);
      const plane = control === 'lightness' ? page.locator('.sw-color-picker-field-label').first()
        : page.locator(`.sw-color-picker-${control}`);
      const rect = (await plane.boundingBox())!;
      const start = { x: rect.x + rect.width * 0.2, y: rect.y + rect.height * 0.25 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(control === 'lightness' ? start.x + 50 : rect.x + rect.width * 0.8,
        rect.y + rect.height * 0.75, { steps: 30 });
      expect(await color()).not.toBe(original);
      expect(await writes()).toBe(0);
      expect(await getEditorSource(page)).toBe(before);
      expect(await untouched.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(otherColor);
      await page.mouse.up();
      expect(await writes()).toBe(1);
      const committed = await getEditorSource(page);
      expect(committed).not.toBe(before);
      const committedColor = await color();
      const fields = page.locator('.sw-color-picker-fields input');
      const fieldValues = () => fields.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
      const committedFields = await fieldValues();
      const nextRect = (await plane.boundingBox())!;
      await plane.dispatchEvent('pointerdown', { button: 0, clientX: nextRect.x + nextRect.width * 0.3, clientY: nextRect.y + nextRect.height * 0.3 });
      if (control === 'lightness') {
        await page.mouse.move(nextRect.x + 60, nextRect.y + 5);
      }
      expect(await color()).not.toBe(committedColor);
      await plane.dispatchEvent('pointercancel');
      expect(await color()).toBe(committedColor);
      await expect.poll(fieldValues).toEqual(committedFields);
      expect(await writes()).toBe(1);
      expect(await getEditorSource(page)).toBe(committed);
      await page.keyboard.press('Escape');
      await stage.locator('.presentation').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(() => getEditorSource(page)).toBe(before);
      expect(errors).toEqual([]);
    });
  }
}

for (const interruption of ['source replacement', 'slide navigation'] as const) {
  test(`a ${interruption} cancels an unfinished color drag`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/canvas.html?fixture=two-boxes');
    await getEditorSource(page);
    const before = `Deck { slides: [
      Slide { content: Freeform { children: [Box { x: 200 y: 300 width: 200 height: 150 fill: amber }] } }
      Slide { content: Freeform { children: [] } }
    ] }`;
    await setHostSource(page, before);
    await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').first().click();
    await page.getByRole('button', { name: 'Fill color picker', exact: true }).click();
    const plane = page.locator('.sw-color-picker-plane');
    const rect = (await plane.boundingBox())!;
    await page.mouse.move(rect.x + 20, rect.y + 40);
    await page.mouse.down();
    const writes = await sourceWrites(page);
    let expected = before;
    if (interruption === 'source replacement') {
      expected = before.replace('fill: amber', 'fill: purple');
      await setHostSource(page, expected);
    } else {
      await page.evaluate(offset => {
        (window as unknown as { __slidewrightHost: { setCursor(offset: number): void } }).__slidewrightHost.setCursor(offset);
      }, before.indexOf('Slide', before.indexOf('Slide') + 1));
      await expect(page.locator('.sw-canvas-status')).toContainText('slide 2 of 2');
    }
    const count = await writes();
    await page.mouse.move(rect.x + 140, rect.y + 90, { steps: 3 });
    await page.mouse.up();
    expect(await writes()).toBe(count);
    expect(await getEditorSource(page)).toBe(expected);
    expect(errors).toEqual([]);
  });
}

test('replacing source during an inspector hue drag unmounts listeners without restoring stale source', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/canvas.html?fixture=two-boxes');
  await getEditorSource(page);
  await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').first().click();
  await page.locator('.sw-color-cell input.sw-property-value').first().focus();
  const hue = page.locator('.sw-color-picker-hue');
  const rect = (await hue.boundingBox())!;
  await page.mouse.move(rect.x + 20, rect.y + 10);
  await page.mouse.down();
  const replacement = 'Deck { slides: [Slide { content: Freeform { children: [] } }] }';
  await page.evaluate(source => (window as any).__slidewrightHost.setSource(source, { replacement: true }), replacement);
  await expect(hue).toHaveCount(0);
  await page.mouse.move(rect.x + 100, rect.y + 10, { steps: 3 });
  await page.mouse.up();
  expect(errors).toEqual([]);
  expect(await getEditorSource(page)).toBe(replacement);
});
