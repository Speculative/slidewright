import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, getEditorSelection, setHostSource } from './editor-helpers';

function deck(count = 100) {
  return `Deck { name: "Cache" slides: [\n${Array.from({ length: count }, (_, i) =>
    `Slide { label: "slide-${i}" content: Freeform { children: [TextBox { x: ${200 + i} y: 300 width: 500 height: 100 content: "content-${i}" }] } }`).join('\n')}\n] }`;
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function navigate(page: Page, source: string, label: string) {
  await page.evaluate(offset => (window as any).__slidewrightHost.setCursor(offset), source.indexOf(`label: "${label}"`));
}
const metrics = (page: Page) => page.locator('.sw-authoring-workspace');

test('a length edit in slide 1 retains later resolution, render counts, DOM and accurate source targets', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  await page.evaluate(async () => {
    const { components } = await import('/decks/v0-reference/registry.ts');
    const entry = components.TextBox;
    const original = entry.render;
    (window as any).cacheRenderCounts = {};
    components.TextBox = { ...entry, render(props: any) {
      const counts = (window as any).cacheRenderCounts;
      counts[props.params.x] = (counts[props.params.x] ?? 0) + 1;
      return original(props);
    } };
  });
  const before = deck();
  await setHostSource(page, before);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '100');
  await navigate(page, before, 'slide-99');
  await expect(page.locator('.sw-canvas-status')).toContainText('slide 100 of 100');
  await settle(page);
  await page.evaluate(() => {
    (window as any).retainedContent = document.querySelector('.sw-canvas-stage [data-sw-textbox-content]');
    (window as any).retainedRenderCount = (window as any).cacheRenderCounts[299];
  });
  const after = before.replace('"content-0"', '"""a much longer first\nslide"""');
  await setHostSource(page, after);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
  await settle(page);
  expect(await page.evaluate(() => document.querySelector('.sw-canvas-stage [data-sw-textbox-content]') === (window as any).retainedContent)).toBe(true);
  expect(await page.evaluate(() => (window as any).cacheRenderCounts[299])).toBe(await page.evaluate(() => (window as any).retainedRenderCount));
  const marker = page.locator('.sw-canvas-stage [data-sw-component="TextBox"]');
  await expect(marker).toHaveAttribute('data-sw-span-start', String(after.lastIndexOf('TextBox')));
  await page.locator('.sw-canvas-stage').getByText('content-99', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
  const selection = await getEditorSelection(page);
  expect(after.slice(selection.start, selection.end)).toContain('content-99');
  expect(selection.start).toBeGreaterThanOrEqual(after.lastIndexOf('TextBox'));
  await page.locator('.sw-canvas-stage').getByText('content-99', { exact: true }).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  await editor.fill('edited later');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => getEditorSource(page)).toContain('edited later');
  expect(await getEditorSource(page)).toContain('a much longer first');
  expect(errors).toEqual([]);
});

test('insertion/deletion preserve the active authored slide and unaffected thumbnail DOM', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  const before = deck(3);
  await setHostSource(page, before);
  await navigate(page, before, 'slide-2');
  await expect(page.locator('.sw-canvas-status')).toContainText('slide 3 of 3');
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').click();
  await page.evaluate(() => {
    (window as any).retainedThumb = document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]')[2];
    (window as any).retainedStage = document.querySelector('.sw-canvas-stage [data-sw-textbox-content]');
  });
  const after = before.replace('slides: [', 'slides: [Slide { content: TextBox { content: "inserted" } }');
  await setHostSource(page, after);
  await expect(page.locator('.sw-canvas-status')).toContainText('slide 4 of 4');
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  await expect(page.locator('.sw-selection-outline')).toBeVisible();
  expect(await page.evaluate(() => document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]')[3] === (window as any).retainedThumb)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.sw-canvas-stage [data-sw-textbox-content]') === (window as any).retainedStage)).toBe(true);
  await setHostSource(page, before);
  await expect(page.locator('.sw-canvas-status')).toContainText('slide 3 of 3');
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '0');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '3');
  await expect(page.locator('.sw-selection-outline')).toBeVisible();
});

test('retained diagnostics move correctly, while explicit replacements and syntax recovery invalidate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  const before = deck(3).replace('"content-2"', 'missingLater');
  await setHostSource(page, before);
  const after = before.replace('"content-0"', '"""longer first\nslide"""');
  await setHostSource(page, after);
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '2');
  const offset = after.indexOf('missingLater');
  const prefix = after.slice(0, offset);
  const line = prefix.split('\n').length;
  const column = offset - prefix.lastIndexOf('\n');
  await expect(page.locator('.sw-canvas-diagnostics')).toContainText(`single-textbox.sw:${line}:${column}:`);
  await page.evaluate(source => (window as any).__slidewrightHost.setSource(source, { replacement: true }), after);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '3');
  const broken = after.slice(0, after.indexOf('missingLater'));
  await setHostSource(page, broken);
  await expect(page.locator('.sw-canvas-diagnostics')).toContainText('[parse]');
  await setHostSource(page, after);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '3');
  expect(errors).toEqual([]);
});

test('ordinary canvas commits preserve later source verbatim and resolve only the edited slide, including undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  const before = deck().replace('x: 200', 'x: 9');
  await setHostSource(page, before);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '100');
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => getEditorSource(page)).toBe(before.replace('x: 9', 'x: 19'));
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
  await page.keyboard.press('Escape');
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
});

test('canvas slide insertion and deletion retain stationary slides and their thumbnail nodes', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  await getEditorSource(page);
  await setHostSource(page, deck(8));
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '8');
  await page.evaluate(() => { (window as any).lastThumb = document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]')[7]; });
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+m');
  await expect(page.locator('.sw-canvas-status')).toContainText('slide 2 of 9');
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '8');
  expect(await page.evaluate(() => document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]')[7] === (window as any).lastThumb)).toBe(true);
  await page.keyboard.press('Delete');
  await expect(page.locator('.sw-canvas-status')).toContainText('of 8');
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '0');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '8');
  expect(await page.evaluate(() => document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]')[7] === (window as any).lastThumb)).toBe(true);
});

test('source and canvas local edits use bounded document parsing in a 100-slide deck', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = deck().replace('x: 200', 'x: 9');
  await setHostSource(page, before);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '100');
  const parseWork = () => page.evaluate(() => (window as any).__slidewrightHost.document.snapshot.parsing);
  // The initial replacement has no complete prior component boundary.
  expect((await parseWork()).fullParses).toBe(1);
  await page.locator('.sw-canvas-stage').getByText('content-0', { exact: true }).click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => getEditorSource(page)).toBe(before.replace('x: 9', 'x: 19'));
  expect(await parseWork()).toEqual({ fullParses: 0, componentParses: 1,
    parsedCharacters: 'TextBox { x: 19 y: 300 width: 500 height: 100 content: "content-0" }'.length });
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
  expect((await parseWork()).fullParses).toBe(0);
  const updated = before.replace('content-0', 'a longer first content 🌍');
  await setHostSource(page, updated);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
  expect((await parseWork()).parsedCharacters).toBeLessThan(120);
  expect((await parseWork()).fullParses).toBe(0);
  // An incomplete edit must publish full-parser diagnostics and recover.
  const broken = updated.slice(0, -1);
  await setHostSource(page, broken);
  await expect.poll(async () => (await parseWork()).fullParses).toBe(1);
  expect(await page.evaluate(() => (window as any).__slidewrightHost.document.snapshot.diagnostics.length)).toBeGreaterThan(0);
  await setHostSource(page, updated);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '100');
  expect((await parseWork()).fullParses).toBe(1);
});

test('a canvas nudge avoids full-deck parsing and emission across the entire application path', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = deck();
  await setHostSource(page, before);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '100');
  await page.locator('.sw-canvas-stage').getByText('content-0', { exact: true }).click();
  await settle(page);
  const readWork = () => page.evaluate(async () => {
    const { readParserWork } = await import('/slidewright/runtime/parser.ts');
    const { readEmitterWork } = await import('/slidewright/runtime/emitter.ts');
    return { ...readParserWork(), ...readEmitterWork() };
  });
  const start = await readWork();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => getEditorSource(page)).toBe(before.replace('x: 200', 'x: 210'));
  await settle(page);
  const end = await readWork();
  // Include command validation, host publication and source-dependent UI
  // queries. Even one full-deck parse would exceed this bound by >20x.
  expect(end.calls - start.calls).toBeGreaterThanOrEqual(2);
  expect(end.parsedCharacters - start.parsedCharacters).toBeLessThan(500);
  expect(end.sourceEmits - start.sourceEmits).toBe(0);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
});

test('disjoint slide deletion undo and redo retain stationary handles, thumbnail DOM and cached resolution', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = deck(8);
  await setHostSource(page, before);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '8');
  await page.evaluate(() => {
    const doc = (window as any).__slidewrightHost.document;
    const slides = doc.snapshot.occurrences.filter((o: any) => o.component.name === 'Slide');
    const nodes = document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]');
    (window as any).historyRetained = [1, 7].map(i => ({ handle: slides[i].handle, node: nodes[i] }));
  });
  await page.locator('.sw-thumb').nth(0).click();
  await page.locator('.sw-thumb').nth(2).click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('Delete');
  await expect(page.locator('.sw-thumb')).toHaveCount(6);
  const deleted = await getEditorSource(page);
  const retained = () => page.evaluate(() => {
    const doc = (window as any).__slidewrightHost.document;
    const nodes = Array.from(document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]'));
    return (window as any).historyRetained.every(({ handle, node }: any) => {
      const current = doc.occurrence(handle);
      const span = current && doc.locate(handle, { start: 0, end: 5 });
      return current && nodes.includes(node) && doc.snapshot.source.slice(span.start.offset, span.end.offset) === 'Slide';
    });
  });
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '0');
  await expect.poll(retained).toBe(true);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => getEditorSource(page)).toBe(before);
    await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '2');
    await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '6');
    await expect.poll(retained).toBe(true);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => getEditorSource(page)).toBe(deleted);
    await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '0');
    await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '6');
    await expect.poll(retained).toBe(true);
  }
});

test('slide reorder undo and redo preserve stationary source targets and thumbnail identity', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  const before = deck(4);
  await setHostSource(page, before);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '4');
  await page.evaluate(() => {
    const doc = (window as any).__slidewrightHost.document;
    const slides = doc.snapshot.occurrences.filter((o: any) => o.component.name === 'Slide');
    const nodes = document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]');
    (window as any).reorderRetained = [1, 3].map(i => ({ handle: slides[i].handle, node: nodes[i] }));
  });
  const thumb = (await page.locator('.sw-thumb').nth(0).boundingBox())!;
  const target = (await page.locator('.sw-thumb').nth(2).boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await settle(page);
  await page.mouse.move(thumb.x + thumb.width / 2 + 8, thumb.y + thumb.height / 2 + 8);
  await settle(page);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height - 2, { steps: 10 });
  await settle(page);
  await page.mouse.up();
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  const after = await getEditorSource(page);
  expect(after.indexOf('label: "slide-0"')).toBeGreaterThan(after.indexOf('label: "slide-2"'));
  const retained = () => page.evaluate(() => {
    const doc = (window as any).__slidewrightHost.document;
    const nodes = Array.from(document.querySelectorAll('.sw-thumb-slot [data-sw-textbox-content]'));
    return (window as any).reorderRetained.every(({ handle, node }: any) => {
      const current = doc.occurrence(handle);
      return current && nodes.includes(node) && doc.snapshot.source.slice(current.range.start, current.range.end).startsWith('Slide {');
    });
  });
  await expect.poll(retained).toBe(true);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => getEditorSource(page)).toBe(before);
    await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
    await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '3');
    await expect.poll(retained).toBe(true);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => getEditorSource(page)).toBe(after);
    await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
    await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '3');
    await expect.poll(retained).toBe(true);
  }
});

for (const command of ['clipboard', 'inspector'] as const) {
  test(`${command} commands avoid full-deck parsing and preserve later slides`, async ({ page, context }) => {
    if (command === 'clipboard') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/canvas.html?fixture=single-textbox');
    const before = deck().replaceAll(/TextBox \{[^}]+\}/g, 'Box { x: 200 y: 300 width: 100 height: 100 }');
    await setHostSource(page, before);
    await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '100');
    await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').click();
    await settle(page);
    const work = () => page.evaluate(async () => (await import('/slidewright/runtime/parser.ts')).readParserWork());
    const start = await work();
    if (command === 'clipboard') {
      await page.keyboard.press('Control+c');
      expect((await work()).parsedCharacters).toBe(start.parsedCharacters);
      await page.keyboard.press('Control+v');
      await expect(page.locator('.sw-hierarchy-node[data-sw-component="Box"]')).toHaveCount(2);
      await expect(page.locator('.sw-hierarchy-node[data-sw-component="Box"]').last()).toHaveClass(/selected/);
    } else {
      const radius = page.getByRole('textbox', { name: 'radius (default)', exact: true });
      await radius.fill('12');
      await radius.press('Enter');
      await expect.poll(() => getEditorSource(page)).toContain('radius: 12');
      await expect(page.locator('.sw-hierarchy-node[data-sw-component="Box"]')).toHaveClass(/selected/);
    }
    await settle(page);
    expect((await work()).parsedCharacters - start.parsedCharacters).toBeLessThan(800);
    const after = await getEditorSource(page);
    expect(after.slice(after.indexOf('Slide { label: "slide-1"'))).toBe(before.slice(before.indexOf('Slide { label: "slide-1"')));
    await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
    await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
    await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => getEditorSource(page)).toBe(before);
    await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => getEditorSource(page)).toBe(after);
    await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
  });
}
