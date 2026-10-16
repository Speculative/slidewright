import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';
import { parse } from '../slidewright/runtime/parser';

const source = `Deck {
  name: "Notes"
  subtitle: ""
  width: 1920
  height: 1080
  slides: [
${Array.from({ length: 60 }, (_, i) => `    Slide {
      label: "Slide ${i + 1}"
      content: Freeform { children: [] }
    }`).join('\n')}
  ]
}`;

for (const exit of ['pause', 'tab', 'slide', 'pagehide'] as const) {
  test(`notes batch a typing burst and flush on ${exit}`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=two-slides');
    await setHostSource(page, source);
    await page.locator('[data-editor-mode="notes"]').click();
    await page.locator('.cm-content').focus();
    await page.clock.pauseAt(new Date());
    await page.evaluate(() => {
      const host = (window as any).__slidewrightHost;
      let previous = host.source;
      (window as any).__notesChanges = [];
      host.subscribe(({ source }: { source: string }) => {
        if (source !== previous) (window as any).__notesChanges.push(source);
        previous = source;
      });
    });
    const text = 'Typing a paragraph should not reload sixty slides for every letter.';
    await page.keyboard.type(text);
    await expect.poll(() => getEditorSource(page)).toBe(text);
    expect(await page.evaluate(() => (window as any).__notesChanges.length)).toBe(0);
    // A same-source host notification must not erase the pending text.
    await page.evaluate(() => (window as any).__slidewrightHost.saveDraft());
    await expect.poll(() => getEditorSource(page)).toBe(text);

    if (exit === 'pause') await page.clock.runFor(350);
    if (exit === 'tab') await page.locator('[data-editor-mode="deck"]').click();
    if (exit === 'slide') await page.locator('.sw-thumb').nth(1).click();
    if (exit === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => page.evaluate(() => (window as any).__notesChanges.length)).toBe(1);
    const saved = await page.evaluate(() => (window as any).__slidewrightHost.source as string);
    expect(saved).toContain(`notes: ${JSON.stringify(text)}`);
    expect(saved.match(/notes:/g)).toHaveLength(1);
    if (exit === 'slide') {
      await expect.poll(() => getEditorSource(page)).toBe('');
      await page.locator('.sw-thumb').nth(0).click();
      await expect.poll(() => getEditorSource(page)).toBe(text);
    }
    if (exit === 'pause') {
      // Flushing must retain the local CodeMirror undo history.
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => getEditorSource(page)).toBe('');
      await page.locator('[data-editor-mode="deck"]').click();
      await expect.poll(() => getEditorSource(page)).toContain('notes: ""');
    }
  });
}

test('external source replacement cancels pending notes', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await page.locator('[data-editor-mode="notes"]').click();
  await page.locator('.cm-content').focus();
  await page.clock.pauseAt(new Date());
  await page.keyboard.type('Pending notes');
  const replacement = source.replace('label: "Slide 1"', 'label: "Replacement"\n      notes: "External notes"');
  await setHostSource(page, replacement);
  await expect.poll(() => getEditorSource(page)).toBe('External notes');
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => (window as any).__slidewrightHost.source)).toBe(replacement);
});

for (const placement of ['before-content', 'last-field', 'missing'] as const) {
  test(`consecutive deletion flushes cannot reuse an old notes span (${placement})`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=two-slides');
    const original = 'A long paragraph of notes that can be shortened twice.';
    let baseline = await getEditorSource(page);
    if (placement === 'before-content') baseline = baseline.replace('notes: ""', `notes: ${JSON.stringify(original)}`);
    else {
      baseline = baseline.replace('      notes: ""\n', '');
      if (placement === 'last-field') baseline = baseline.replace('    }\n    Slide {', `      notes: ${JSON.stringify(original)}\n    }\n    Slide {`);
    }
    await setHostSource(page, baseline);
    await page.locator('[data-editor-mode="notes"]').click();
    const saved = await page.evaluate(async ({ placement, original }) => {
      // Exercise two edits before React can refresh the source projection.
      const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
      const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
      if (placement === 'missing') {
        view.dispatch({ changes: { from: 0, insert: original } });
        window.dispatchEvent(new Event('pagehide'));
      }
      view.dispatch({ changes: { from: 4, to: 16, insert: '' } });
      window.dispatchEvent(new Event('pagehide'));
      view.dispatch({ changes: { from: 2, to: 8, insert: '' } });
      window.dispatchEvent(new Event('pagehide'));
      return (window as any).__slidewrightHost.source as string;
    }, { placement, original });
    const first = original.slice(0, 4) + original.slice(16);
    const final = first.slice(0, 2) + first.slice(8);
    if (placement === 'missing') expect(saved.replace(`      notes: ${JSON.stringify(final)}\n`, '')).toBe(baseline);
    else expect(saved).toBe(baseline.replace(JSON.stringify(original), JSON.stringify(final)));
    expect(parse(saved, '<notes-test>').diagnostics).toEqual([]);
  });
}

for (const text of ['A """ delimiter\nSecond line', 'Trailing blank lines\n\n', '  indented\n  text', '\n']) {
  test(`notes encoding preserves ${JSON.stringify(text)}`, async ({ page }) => {
    await page.goto('/canvas.html?fixture=two-slides');
    const baseline = (await getEditorSource(page)).replace('notes: ""', 'notes: """\n        Old notes\n      """');
    await setHostSource(page, baseline);
    await page.locator('[data-editor-mode="notes"]').click();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(text);
    await page.locator('[data-editor-mode="deck"]').click();
    const saved = await getEditorSource(page);
    expect(parse(saved, '<notes-test>').diagnostics).toEqual([]);
    // Everything after the notes literal must remain byte-for-byte intact.
    expect(saved.slice(saved.indexOf('      content:'))).toBe(baseline.slice(baseline.indexOf('      content:')));
    await page.locator('[data-editor-mode="notes"]').click();
    await expect.poll(() => getEditorSource(page)).toBe(text);
  });
}

test('an edit before React reconciles an external replacement cannot overwrite it', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  const baseline = await getEditorSource(page);
  const replacement = baseline.replace('notes: ""', 'notes: "External notes"');
  await page.locator('[data-editor-mode="notes"]').click();
  const saved = await page.evaluate(async (replacement) => {
    const { EditorView } = await import('/node_modules/@codemirror/view/dist/index.js');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    const host = (window as any).__slidewrightHost;
    host.setSource(replacement);
    view.dispatch({ changes: { from: 0, insert: 'Stale edit' } });
    window.dispatchEvent(new Event('pagehide'));
    return host.source;
  }, replacement);
  expect(saved).toBe(replacement);
  await expect.poll(() => getEditorSource(page)).toBe('External notes');
});
