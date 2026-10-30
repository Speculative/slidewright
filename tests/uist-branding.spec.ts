import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';
import { executionFrames } from '../decks/uist-2026/components/debugger-stages';

const source = readFileSync('decks/uist-2026/deck.sw', 'utf8');

test('UIST exposes the light brand palette and uses Lato for authored text', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  await expect(page.locator('.sw-canvas-diagnostics')).toHaveCount(0);
  const text = page.locator('.sw-canvas-stage [data-sw-textbox-content]').first();
  await expect(text).toHaveCSS('color', 'rgb(0, 0, 0)');
  expect(await text.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Lato');
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').first().click();
  await page.getByRole('button', { name: 'Foreground color picker', exact: true }).click();
  const palette = page.getByRole('group', { name: 'global colors', exact: true });
  for (const [name, color] of [['orange', 'rgb(255, 139, 30)'], ['red', 'rgb(212, 42, 12)'], ['cyan', 'rgb(0, 168, 232)'], ['purple', 'rgb(128, 0, 255)'], ['ink', 'rgb(0, 0, 0)'], ['teal', 'rgb(0, 125, 112)'], ['canvasGrey', 'rgb(232, 232, 232)'], ['canvasNeutral', 'rgb(245, 245, 245)'], ['canvasWarm', 'rgb(248, 246, 241)'], ['canvasDot', 'rgb(154, 154, 154)'], ['canvasGridLine', 'rgb(235, 235, 235)'], ['canvasBlueprintLine', 'rgb(232, 238, 255)']]) {
    await expect(palette.getByRole('button', { name, exact: true })).toHaveCSS('background-color', color);
  }
  expect(await getEditorSource(page)).toBe(source);
});

test('branding changes demo code to JetBrains Mono and ink while legacy defaults remain intact', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  const deck = (branding: boolean) => `Deck { slides: [Slide { content: PlateauSlide { branding: ${branding}
    content: Freeform { children: [DebuggerDemo { mode: "place-time" width: 1600 height: 780 }] }
  } }] }`;
  for (const branding of [false, true]) {
    await setHostSource(page, deck(branding));
    const code = page.locator('.sw-canvas-stage').getByLabel('Demo code');
    await expect(code.locator('.token.keyword').first()).toHaveCSS('color', branding ? 'rgb(0, 0, 0)' : 'rgb(215, 58, 73)');
    expect(await code.evaluate(element => getComputedStyle(element).fontFamily)).toContain(branding ? 'JetBrains Mono' : 'Plateau Monaspace Neon');
  }
});

test('branding preserves SVG chart paint colors across chart modes and debugger stages', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  const paints = async () => page.locator('.sw-canvas-stage svg[role="img"] *').evaluateAll(elements => elements.filter(element => ['path', 'rect', 'line', 'polyline', 'circle', 'text'].includes(element.tagName)).map(element => {
    const style = getComputedStyle(element);
    return { tag: element.tagName, fill: style.fill, stroke: style.stroke, fillOpacity: style.fillOpacity };
  }));
  for (const component of ['StateTimeChart { mode: "collection" }', 'StateTimeChart { mode: "streams" }', 'StateTimeChart { mode: "filtering" }', 'DebuggerDemo { mode: "place-time" }']) {
    const deck = (branding: boolean) => `Deck { slides: [Slide { content: PlateauSlide { branding: ${branding}
      content: Freeform { children: [${component}] }
    } }] }`;
    const snapshots = [];
    for (const branding of [false, true]) {
      await setHostSource(page, deck(branding));
      const stage = page.locator('.sw-canvas-stage');
      await expect(stage.locator('svg[role="img"]')).toHaveCount(1);
      // Pause at a representative state with data marks visible.
      if (component.startsWith('DebuggerDemo')) {
        await stage.getByLabel('Demo stage').selectOption('18');
        await expect(stage.locator('[data-sw-debugger]')).toHaveAttribute('data-frame', String(executionFrames(18).length - 1));
      }
      else {
        await stage.getByRole('button', { name: 'Reset chart', exact: true }).click();
        const next = stage.getByRole('button', { name: 'Next step', exact: true });
        await next.click(); if (await next.isEnabled()) await next.click();
      }
      snapshots.push(await paints());
    }
    expect(snapshots[1], component).toEqual(snapshots[0]);
  }
});
