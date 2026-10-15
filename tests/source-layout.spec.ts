import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const prose = 'A long sentence about debugging and inspecting structured objects. '.repeat(16);
const source = `Deck {
  name: "Wrap"
  subtitle: ""
  width: 1920
  height: 1080
  slides: [
    Slide {
      label: "Wrap"
      notes: ${JSON.stringify(prose)}
      content: Freeform {
        children: [
          Box { x: 400, y: 300, width: 200, height: 100, fill: "blue" }
        ]
      }
    }
  ]
}`;

test('source wraps under property values without changing source', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/canvas.html?fixture=single-box');
  await setHostSource(page, source);
  const line = page.locator('.cm-line').filter({ hasText: 'notes:' });
  await expect(line).toBeVisible();
  await expect.poll(() => line.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(40);
  const geometry = await line.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      if (!text.textContent?.includes('A long sentence')) continue;
      const range = document.createRange();
      range.setStart(text, 0); range.setEnd(text, 1);
      const first = range.getBoundingClientRect();
      for (let i = 1; i < text.textContent.length; i++) {
        range.setStart(text, i); range.setEnd(text, i + 1);
        const next = range.getBoundingClientRect();
        if (next.top > first.top + 5 && next.width > 0) return { first: first.x, wrapped: next.x };
      }
    }
    throw new Error('No wrapped string found');
  });
  expect(Math.abs(geometry.first - geometry.wrapped)).toBeLessThan(2);
  const overflow = await page.locator('.cm-scroller').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await getEditorSource(page)).toBe(source);
});

test('nested disclosure controls fold source and canvas navigation reveals it', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await setHostSource(page, source);
  const controls = page.locator('.cm-foldGutter .cm-gutterElement');
  await expect(controls.filter({ hasText: '⌄' }).first()).toBeVisible();
  // Collapse the deck, then restore it with the placeholder.
  await controls.filter({ hasText: '⌄' }).first().click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1);
  expect(await getEditorSource(page)).toBe(source);
  await page.locator('.cm-foldPlaceholder').click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);
  // Collapse again, then reveal a nested object through canvas → source sync.
  await controls.filter({ hasText: '⌄' }).first().click();
  await page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first()
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.cm-line').filter({ hasText: 'Box {' })).toBeVisible();
  expect(await getEditorSource(page)).toBe(source);
});

test('notes wrap as prose and edits round-trip to the deck', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/canvas.html?fixture=single-box');
  await setHostSource(page, source);
  await page.locator('[data-editor-mode="notes"]').click();
  await expect.poll(() => getEditorSource(page)).toBe(prose);
  const content = page.locator('.cm-content');
  await expect(content.locator('.cm-line')).toHaveCount(1);
  await expect.poll(() => content.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(60);
  expect(await content.locator('[class^="ͼ"]').count()).toBe(0);
  expect(await page.locator('.cm-scroller').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await content.focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('More notes.');
  await expect.poll(() => getEditorSource(page)).toBe(prose + 'More notes.');
  await page.locator('[data-editor-mode="deck"]').click();
  await expect.poll(() => getEditorSource(page)).toContain(JSON.stringify(prose + 'More notes.'));
  await page.locator('[data-editor-mode="slide"]').click();
  await expect(page.locator('.cm-foldGutter')).toBeVisible();
  await expect(page.locator('.cm-line').filter({ hasText: 'notes:' })).toHaveCount(1);
});

for (const mode of ['deck', 'notes'] as const) {
  for (const backwards of [false, true]) {
    test(`${mode}: ${backwards ? 'backward' : 'forward'} mouse selection across a wrap paints both ends and edits the selected text`, async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.goto('/canvas.html?fixture=single-box');
      await setHostSource(page, source);
      if (mode === 'notes') await page.locator('[data-editor-mode="notes"]').click();
      const line = page.locator('.cm-line').filter({ hasText: mode === 'notes' ? 'A long sentence' : 'notes:' });
      await expect(line).toBeVisible();
      const targets = await line.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (!node.textContent?.includes('A long sentence')) continue;
          const range = document.createRange();
          const at = (offset: number) => {
            range.setStart(node!, offset); range.setEnd(node!, offset + 1);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + 0.5, y: (rect.top + rect.bottom) / 2 };
          };
          const start = at(3);
          for (let offset = 4; offset < node.textContent.length - 8; offset++) {
            if (at(offset).y > start.y + 5) {
              return { start, end: at(offset + 7), text: node.textContent.slice(3, offset + 7) };
            }
          }
        }
        throw new Error('No wrapped text found');
      });
      const [anchor, head] = backwards ? [targets.end, targets.start] : [targets.start, targets.end];
      await page.mouse.move(anchor.x, anchor.y);
      await page.mouse.down();
      await page.mouse.move(head.x, head.y, { steps: 12 });
      await page.mouse.up();
      if (mode === 'deck') await expect.poll(async () => {
        const pane = page.locator('.sw-editor-pane');
        const from = Number(await pane.getAttribute('data-selection-start'));
        const to = Number(await pane.getAttribute('data-selection-end'));
        return source.slice(from, to);
      }).toBe(targets.text);
      const highlights = page.locator('.cm-selectionBackground');
      await expect.poll(() => highlights.count()).toBeGreaterThanOrEqual(2);
      for (const endpoint of [targets.start, targets.end]) {
        await expect.poll(() => highlights.evaluateAll((els, point) => els.some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.left <= point.x + 1 && rect.right >= point.x - 1
            && rect.top <= point.y && rect.bottom >= point.y;
        }), endpoint)).toBe(true);
      }
      await page.keyboard.type('replacement');
      await expect.poll(() => getEditorSource(page)).toBe(
        (mode === 'notes' ? prose : source).replace(targets.text, 'replacement'),
      );
    });
  }
}

test('continuation indentation remains capped when the editor is resized', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/canvas.html?fixture=single-box');
  await setHostSource(page, source.replace('      notes:', `${' '.repeat(80)}notes:`));
  const line = page.locator('.cm-line').filter({ hasText: 'notes:' });
  const metrics = () => line.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      padding: parseFloat(style.paddingLeft),
      indent: style.textIndent,
      width: el.parentElement!.clientWidth,
    };
  });
  await expect.poll(async () => {
    const { padding, width } = await metrics();
    return padding > 0 && padding <= width * 0.4;
  }).toBe(true);
  const before = await metrics();
  expect(before.padding).toBeLessThanOrEqual(before.width * 0.4);
  expect(before.indent).toMatch(/^-\d+(\.\d+)?px$/);
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect.poll(async () => (await metrics()).padding).toBeGreaterThan(before.padding);
  const after = await metrics();
  expect(after.padding).toBeLessThanOrEqual(after.width * 0.4);
  expect(after.indent).toMatch(/^-\d+(\.\d+)?px$/);
});
