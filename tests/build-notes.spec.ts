import { parse } from '../slidewright/runtime/parser';
import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const source = (notes = '["Opening", "Reveal", "Finish"]', builds = true) => `Deck { slides: [
  Slide { label: "Notes" notes: ${notes} content: Freeform { children: [] }
    ${builds ? 'builds: [Build { id: "reveal" changes: [] } Build { id: "finish" changes: [] }]' : ''}
  }
] }`;

async function saved(page: Page) {
  return page.evaluate(() => (window as any).__slidewrightHost.source as string);
}
async function savedNotes(page: Page) {
  const ast = parse(await saved(page), 'notes.sw').ast;
  const slides = ast.items[0]!.fills.find(fill => fill.name === 'slides')!.value;
  if (slides.kind !== 'list' || slides.items[0]?.kind !== 'component') throw new Error('Missing slide');
  const notes = slides.items[0].fills.find(fill => fill.name === 'notes')?.value;
  if (notes?.kind === 'list') return notes.items.map(item => item.kind === 'string' ? item.value : null);
  return notes?.kind === 'string' ? notes.value : null;
}
async function edit(page: Page, text: string) {
  await page.locator('.cm-content').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}
async function frame(page: Page, index: number) {
  if (!index) await page.locator('.sw-thumb').first().click();
  else await page.getByRole('option', { name: `Slide 1 build ${index}:`, exact: false }).click();
}

test('notes edit only the selected build, flush on navigation, and follow presenter navigation', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  const baseline = source().replace('"Reveal"', '// keep this entry\n "Reveal"');
  await setHostSource(page, baseline);
  await page.locator('[data-editor-mode="notes"]').click();
  await expect.poll(() => getEditorSource(page)).toBe('Opening');
  await frame(page, 1);
  await expect.poll(() => getEditorSource(page)).toBe('Reveal');
  await edit(page, 'Reveal edited\nSecond line');
  await frame(page, 2);
  await expect.poll(() => getEditorSource(page)).toBe('Finish');
  const result = await saved(page);
  expect(result).toContain('// keep this entry');
  expect(result).toContain('"Opening"');
  expect(result).toContain('"Finish"');
  await frame(page, 1);
  await expect.poll(() => getEditorSource(page)).toBe('Reveal edited\nSecond line');

  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Presenter view', exact: true }).click();
  const presenter = await popup;
  await expect(presenter.getByLabel('Speaker notes')).toContainText('Opening');
  await presenter.keyboard.press('ArrowRight');
  await expect(presenter.getByLabel('Speaker notes')).toContainText('Reveal edited');
  await presenter.keyboard.press('ArrowRight');
  await expect(presenter.getByLabel('Speaker notes')).toContainText('Finish');
  await presenter.keyboard.press('r');
  await expect(presenter.getByLabel('Speaker notes')).toContainText('Opening');
});

test('notes stay with frames through add, duplicate, reorder, delete and return to a string', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await setHostSource(page, source('"Opening"', false));
  await page.locator('[data-editor-mode="notes"]').click();
  await page.getByRole('button', { name: 'Add build', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toBe('');
  await expect.poll(() => savedNotes(page)).toEqual(['Opening', '']);
  await edit(page, 'New build');
  await page.getByRole('button', { name: 'Duplicate frame', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toBe('New build');
  await edit(page, 'Copy');
  await page.getByRole('button', { name: 'Move build up', exact: true }).click();
  await expect.poll(() => savedNotes(page)).toEqual(['Opening', 'Copy', 'New build']);
  await page.getByRole('button', { name: 'Delete build', exact: true }).click();
  await expect.poll(() => getEditorSource(page)).toBe('Opening');
  await frame(page, 1);
  await expect.poll(() => getEditorSource(page)).toBe('New build');
  await page.getByRole('button', { name: 'Delete build', exact: true }).click();
  await expect.poll(() => saved(page)).toContain('notes: "Opening"');
  await expect.poll(() => getEditorSource(page)).toBe('Opening');
});

for (const notes of ['"Shared"', '["Opening"]', '[]', 'missing']) {
  test(`editing a build materializes ${notes} notes without affecting other frames`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=two-slides');
    await setHostSource(page, notes === 'missing' ? source().replace('notes: ["Opening", "Reveal", "Finish"]', '') : source(notes));
    await frame(page, 2);
    await page.locator('[data-editor-mode="notes"]').click();
    await expect.poll(() => getEditorSource(page)).toBe(notes === '"Shared"' ? 'Shared' : '');
    await edit(page, 'Last');
    await page.locator('[data-editor-mode="deck"]').click();
    const first = notes === '"Shared"' ? '"Shared", "Shared"' : notes === '["Opening"]' ? '"Opening", ""' : '"", ""';
    expect(await saved(page)).toContain(`notes: [${first}, "Last"]`);
    await page.locator('[data-editor-mode="notes"]').click();
    await edit(page, 'Last again');
    await page.locator('[data-editor-mode="deck"]').click();
    expect(await saved(page)).toContain(`notes: [${first}, "Last again"]`);
  });
}

test('pending shared notes flush to their original frame on build navigation', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await setHostSource(page, source('"Shared"'));
  await page.locator('[data-editor-mode="notes"]').click();
  await page.clock.pauseAt(new Date());
  await edit(page, 'Opening changed');
  await frame(page, 1);
  await expect.poll(() => getEditorSource(page)).toBe('Shared');
  await expect.poll(() => savedNotes(page)).toEqual(['Opening changed', 'Shared', 'Shared']);
  // Moving between frames must not carry the previous frame's editor undo.
  await page.locator('.cm-content').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => getEditorSource(page)).toBe('Shared');
});

test('materializing shared notes advances the literal range before React renders', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await setHostSource(page, source('"Shared"'));
  await frame(page, 1);
  await page.locator('[data-editor-mode="notes"]').click();
  await expect.poll(() => getEditorSource(page)).toBe('Shared');
  await page.evaluate(async () => {
    const { EditorView } = await import('/tests/editor-harness.ts');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'First edit' } });
    window.dispatchEvent(new Event('pagehide'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Second edit' } });
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect.poll(() => savedNotes(page)).toEqual(['Shared', 'Second edit', 'Shared']);
});
