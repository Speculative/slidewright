import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const rows = (page: Page, name: string) => page.locator(`.sw-hierarchy-node[data-sw-component="${name}"]`);
const visuals = (page: Page, name: string) => page.locator(`.sw-canvas-stage [data-sw-component="${name}"] > div`);

async function selectBoxes(page: Page) {
  await rows(page, 'Box').nth(0).click();
  await rows(page, 'Box').nth(1).click({ modifiers: ['Shift'] });
}

test('grouping preserves visual geometry, source content, selection and undo/redo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectBoxes(page);
  const before = await getEditorSource(page);
  const geometry = await visuals(page, 'Box').evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }));
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(rows(page, 'Group')).toHaveClass(/selected/);
  await expect.poll(() => getEditorSource(page)).toMatch(/Group\s*\{\s*x: 200\s+y: 200\s+width: 800\s+height: 450/);
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 600\s+y: 300/);
  const grouped = await getEditorSource(page);
  const after = await visuals(page, 'Box').evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }));
  expect(after).toEqual(geometry);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => getEditorSource(page)).toBe(grouped);
  await rows(page, 'Group').click();
  await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await expect(rows(page, 'Group')).toHaveCount(0);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(2);
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 800\s+y: 500/);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(grouped);
});

test('keyboard grouping, group body drag and ungroup preserve member positions', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectBoxes(page);
  await page.keyboard.press('Control+g');
  await expect(rows(page, 'Group')).toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  const box = await visuals(page, 'Box').first().boundingBox();
  const stage = await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox();
  const scale = stage!.width / 1920;
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 100 * scale, box!.y + box!.height / 2 + 50 * scale, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => getEditorSource(page)).toMatch(/Group\s*\{\s*x: 300\s+y: 250/);
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 600\s+y: 300/);
  await page.keyboard.press('Control+Shift+g');
  await expect(rows(page, 'Group')).toHaveCount(0);
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 900\s+y: 550/);
});

test('nested groups and implicit children work with mixed shapes and retain comments', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform {
    // rectangle
    Box { x: 100.5 y: 80.25 width: 200 height: 150 }
    Arrow { x1: 400 y1: 300 x2: 500 y2: 400 }
    TextBox { x: 700 y: 600 width: 200 height: 100 content: "Keep text" }
  } }] }`);
  await rows(page, 'Box').click();
  await rows(page, 'Arrow').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(rows(page, 'Group')).toHaveCount(1);
  await rows(page, 'TextBox').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+g');
  await expect(rows(page, 'Group')).toHaveCount(2);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+g');
  await expect(rows(page, 'Group')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await rows(page, 'Group').click();
  await page.keyboard.press('Control+Shift+g');
  await expect(rows(page, 'Group')).toHaveCount(0);
  const source = await getEditorSource(page);
  expect(source).toContain('// rectangle');
  expect(source).toMatch(/Box\s*\{\s*x: 100.5\s+y: 80.25/);
  expect(source).toMatch(/x1: 400\s+y1: 300\s+x2: 500\s+y2: 400/);
  expect(source).toContain('"Keep text"');
  await expect(page.locator('.sw-canvas-diagnostics')).toHaveCount(0);
});

test('flow children cannot be grouped and shortcuts leave source typing alone', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await setHostSource(page, 'Deck { slides: [Slide { content: VStack { children: [Box {} Box {}] } }] }');
  await selectBoxes(page);
  await expect(page.getByRole('button', { name: 'Group', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+g');
  await expect(rows(page, 'Group')).toHaveCount(0);
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectBoxes(page);
  await page.locator('.sw-editor-view .cm-content').focus();
  await page.keyboard.press('Control+g');
  await expect(rows(page, 'Group')).toHaveCount(0);
});

test('marquee selects a group as one unit and drill-in uses local member coordinates', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await selectBoxes(page);
  await page.keyboard.press('Control+g');
  await page.keyboard.press('Escape');
  const freeform = await visuals(page, 'Freeform').boundingBox();
  const canvas = await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox();
  const scale = canvas!.width / 1920;
  await page.mouse.move(freeform!.x + 100 * scale, freeform!.y + 100 * scale);
  await page.mouse.down();
  await page.mouse.move(freeform!.x + 1100 * scale, freeform!.y + 750 * scale, { steps: 8 });
  await page.mouse.up();
  await expect(rows(page, 'Group')).toHaveClass(/selected/);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(1);
  // One further click drills directly into the member, skipping children-slot selection.
  await visuals(page, 'Box').last().click();
  await expect(rows(page, 'Box').last()).toHaveClass(/selected/);
  const outline = await page.locator('.sw-selection-outline').boundingBox();
  const member = await visuals(page, 'Box').last().boundingBox();
  expect(outline!.x).toBeCloseTo(member!.x - 4 * scale, 1);
  expect(outline!.y).toBeCloseTo(member!.y - 4 * scale, 1);
  await page.getByRole('button', { name: 'Align left', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toMatch(/Box\s*\{\s*x: 0\s+y: 300/);
  await expect.poll(() => getEditorSource(page)).toMatch(/Group\s*\{\s*x: 200\s+y: 200/);
});

test('multiple selected groups ungroup in sibling order', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-boxes');
  await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
    Group { x: 100 y: 200 width: 100 height: 100 children: [Box { width: 100 height: 100 fill: amber }] }
    Group { x: 500 y: 600 width: 100 height: 100 children: [Box { width: 100 height: 100 fill: cyan }] }
  ] } }] }`);
  await rows(page, 'Group').first().click();
  await rows(page, 'Group').last().click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await expect(rows(page, 'Group')).toHaveCount(0);
  await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(2);
  const source = await getEditorSource(page);
  expect(source).toMatch(/Box\s*\{[^}]*x: 100\s+y: 200[^}]*\}\s*Box\s*\{[^}]*x: 500\s+y: 600/s);
});

for (const order of ['inside first', 'outside first'] as const) {
  test(`hierarchy selection across nested group boundaries has correct bounds (${order})`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=two-boxes');
    await setHostSource(page, `Deck { slides: [Slide { content: Freeform { children: [
      Group { x: 100 y: 150 width: 500 height: 400 children: [
        Group { x: 200 y: 120 width: 250 height: 200 children: [
          Box { x: 30 y: 40 width: 100 height: 80 fill: amber }
        ] }
      ] }
      Box { x: 900 y: 650 width: 150 height: 100 fill: cyan }
    ] } }] }`);
    const before = await getEditorSource(page);
    const first = order === 'inside first' ? 0 : 1;
    await rows(page, 'Box').nth(first).click();
    await rows(page, 'Box').nth(1 - first).click({ modifiers: ['Shift'] });
    await expect(page.locator('.sw-hierarchy-node.selected')).toHaveCount(2);
    const scale = (await page.locator('.sw-canvas-stage .presentation-canvas').boundingBox())!.width / 1920;
    // Both per-member outlines and their union must use the same coordinates.
    for (let i = 0; i < 2; i++) {
      const span = await rows(page, 'Box').nth(i).getAttribute('data-sw-span-start');
      const member = await visuals(page, 'Box').nth(i).boundingBox();
      await expect.poll(async () => {
        const outline = await page.locator(`.sw-selection-outline[data-sw-overlay-for-start="${span}"]`).boundingBox();
        return Math.max(Math.abs(outline!.x - (member!.x - 4 * scale)), Math.abs(outline!.y - (member!.y - 4 * scale)));
      }).toBeLessThan(1);
    }
    const boxes = await visuals(page, 'Box').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }));
    const left = Math.min(...boxes.map(box => box.left));
    const top = Math.min(...boxes.map(box => box.top));
    const right = Math.max(...boxes.map(box => box.right));
    const bottom = Math.max(...boxes.map(box => box.bottom));
    const group = await page.locator('.sw-selection-group').boundingBox();
    expect(group!.x).toBeCloseTo(left - 8 * scale, 0);
    expect(group!.y).toBeCloseTo(top - 8 * scale, 0);
    expect(group!.width).toBeCloseTo(right - left + 16 * scale, 0);
    expect(group!.height).toBeCloseTo(bottom - top + 16 * scale, 0);
    await expect(page.locator('.sw-resize-handle-shape')).toHaveCount(0);
    expect(await getEditorSource(page)).toBe(before);
  });
}
