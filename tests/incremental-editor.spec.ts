import { test, expect } from '@playwright/test';
import { getEditorSelection, getEditorSource, setHostSource } from './editor-helpers';

const source = `Deck {
  name: "first"
  slides: [
    Slide { label: "one" }
    Slide {
      label: "retained"
    }
    Slide { label: "three" }
  ]
  subtitle: "last"
}`;

test('host disjoint edits map the retained CodeMirror state, selection and collapsed fold without feedback', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await setHostSource(page, source);
  await expect.poll(() => getEditorSource(page)).toBe(source);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = await page.evaluate(async source => {
    const { EditorView, StateEffect, StateField, foldEffect, foldedRanges } = await import('/tests/editor-harness.ts');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    const host = (window as any).__slidewrightHost;
    const retained = StateField.define({ create: () => ({}), update: value => value });
    view.dispatch({ effects: StateEffect.appendConfig.of(retained) });
    const identity = view.state.field(retained);
    const from = source.indexOf('Slide {\n') + 'Slide {'.length;
    const to = source.indexOf('\n    }', from);
    const cursor = source.indexOf('three');
    view.dispatch({ effects: foldEffect.of({ from, to }), selection: { anchor: cursor } });
    const changes = [
      { start: source.indexOf('first'), end: source.indexOf('first') + 5, insert: 'longer first' },
      { start: source.indexOf('last'), end: source.indexOf('last') + 4, insert: 'longer last' },
    ];
    let callbacks = 0;
    const unsubscribe = host.subscribe(() => callbacks++);
    callbacks = 0;
    const next = source.replace('first', 'longer first').replace('last', 'longer last');
    const applied = new Promise<void>(resolve => {
      view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of(update => {
        if (update.state.doc.toString() === next) resolve();
      })) });
    });
    host.setSource(next, { changes, baseRevision: host.document.snapshot.revision, origin: 'test' });
    await applied;
    const folds: { from: number; to: number }[] = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => folds.push({ from, to }));
    unsubscribe();
    return { sameState: view.state.field(retained, false) === identity, callbacks, folds,
      expectedFold: { from: from + 7, to: to + 7 }, cursor: view.state.selection.main.head,
      expectedCursor: cursor + 7, next };
  }, source);
  expect(result.sameState).toBe(true);
  expect(result.callbacks).toBe(1);
  expect(result.folds).toEqual([result.expectedFold]);
  expect(result.cursor).toBe(result.expectedCursor);
  await expect.poll(() => getEditorSelection(page)).toEqual({ start: result.cursor, end: result.cursor });
  expect(await getEditorSource(page)).toBe(result.next);
  expect(errors).toEqual([]);
});

test('disjoint CodeMirror edits publish precise ranges and preserve middle slide occurrences', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await setHostSource(page, source);
  await expect.poll(() => getEditorSource(page)).toBe(source);
  const result = await page.evaluate(async source => {
    const { EditorView } = await import('/tests/editor-harness.ts');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    const host = (window as any).__slidewrightHost;
    const deckDocument = host.document;
    const middle = deckDocument.snapshot.occurrences.filter((o: any) => o.component.name === 'Slide')[1].handle;
    const changes = [
      { from: source.indexOf('first'), to: source.indexOf('first') + 5, insert: 'longer first' },
      { from: source.indexOf('last'), to: source.indexOf('last') + 4, insert: 'longer last' },
    ];
    let received: any;
    const unsubscribe = host.subscribe((state: any) => { received = state.documentUpdate; });
    const revision = deckDocument.snapshot.revision;
    view.dispatch({ changes });
    unsubscribe();
    return { retained: !!deckDocument.occurrence(middle), revisionDelta: deckDocument.snapshot.revision - revision,
      origin: received.origin, changes: received.changes, expected: changes.map(({ from, to, insert }) => ({ start: from, end: to, insert })) };
  }, source);
  expect(result.retained).toBe(true);
  expect(result.revisionDelta).toBe(1);
  expect(result.origin).toBe('source-editor');
  expect(result.changes).toEqual(result.expected);
  await expect.poll(() => getEditorSource(page)).toBe(source.replace('first', 'longer first').replace('last', 'longer last'));
});

test('host synchronization clears editor history while subsequent edits still undo', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const original = await getEditorSource(page);
  const editor = page.locator('.cm-content');
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' ');
  const incoming = original.replace('single-box', 'external replacement');
  await setHostSource(page, incoming);
  await expect.poll(() => getEditorSource(page)).toBe(incoming);
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Z');
  expect(await getEditorSource(page)).toBe(incoming);
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' ');
  await expect.poll(() => getEditorSource(page)).toBe(incoming + ' ');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => getEditorSource(page)).toBe(incoming);
});

test('rapid slide-projection edits advance source ranges before React delivers another projection', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  await page.locator('[data-editor-mode="slide"]').click();
  await expect(page.locator('.sw-editor-pane')).toHaveAttribute('data-mode', 'slide');
  const result = await page.evaluate(async () => {
    const { EditorView } = await import('/tests/editor-harness.ts');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    const host = (window as any).__slidewrightHost;
    const original = host.source;
    const text = view.state.doc.toString();
    view.dispatch({ changes: { from: 7, insert: ' ' } });
    view.dispatch({ changes: { from: 8, insert: ' ' } });
    return { actual: host.source, expected: original.replace(text, text.slice(0, 7) + '  ' + text.slice(7)), projected: view.state.doc.toString() };
  });
  expect(result.actual).toBe(result.expected);
  await expect.poll(() => getEditorSource(page)).toBe(result.projected);
});

test('an editor transaction on an obsolete projection cannot overwrite incoming source', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const result = await page.evaluate(async () => {
    const { EditorView } = await import('/tests/editor-harness.ts');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    const host = (window as any).__slidewrightHost;
    const next = host.source + '\n// external authority';
    host.setSource(next);
    view.dispatch({ changes: { from: 0, insert: '// obsolete editor input\n' } });
    return { actual: host.source, next };
  });
  expect(result.actual).toBe(result.next);
  await expect.poll(() => getEditorSource(page)).toBe(result.next);
});

test('incomplete source stays authoritative and recovers without resetting editor state', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  const result = await page.evaluate(async () => {
    const { EditorView, StateEffect, StateField } = await import('/tests/editor-harness.ts');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!;
    const host = (window as any).__slidewrightHost;
    const original = host.source;
    const at = original.lastIndexOf('}');
    const retained = StateField.define({ create: () => ({}), update: value => value });
    view.dispatch({ effects: StateEffect.appendConfig.of(retained) });
    const identity = view.state.field(retained);
    view.dispatch({ changes: { from: at, to: at + 1, insert: '' } });
    const incomplete = host.source;
    const hasErrors = host.document.snapshot.diagnostics.some((d: any) => d.severity === 'error');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    view.dispatch({ changes: { from: at, insert: '}' } });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { incomplete, expectedIncomplete: original.slice(0, at) + original.slice(at + 1), hasErrors,
      recovered: host.source === original, sameState: view.state.field(retained, false) === identity,
      recoveredErrors: host.document.snapshot.diagnostics.length };
  });
  expect(result.incomplete).toBe(result.expectedIncomplete);
  expect(result.hasErrors).toBe(true);
  expect(result.recovered).toBe(true);
  expect(result.sameState).toBe(true);
  expect(result.recoveredErrors).toBe(0);
});

test('an explicit equal-source replacement is still an editor history barrier', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const editor = page.locator('.cm-content');
  const original = await getEditorSource(page);
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' ');
  await expect.poll(() => getEditorSource(page)).toBe(original + ' ');
  await page.evaluate(() => {
    const host = (window as any).__slidewrightHost;
    host.setSource(host.source, { replacement: true, origin: 'test' });
  });
  // Wait for React to apply the barrier, even though the text is identical.
  await expect.poll(() => page.evaluate(async () => {
    const { EditorView, undoDepth } = await import('/tests/editor-harness.ts');
    return undoDepth(EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.state);
  })).toBe(0);
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Z');
  expect(await getEditorSource(page)).toBe(original + ' ');
});
