import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function getEditorSource(page: Page): Promise<string> {
  const pane = page.locator('.sw-editor-pane');
  // The pane mounts before the host's immediate subscription callback has
  // populated its initial full-deck source. Notes are allowed to be empty,
  // so only wait for a non-empty projection outside notes mode.
  if ((await pane.getAttribute('data-mode')) !== 'notes') {
    await expect(pane).not.toHaveAttribute('data-source', '');
  }
  return (await pane.getAttribute('data-source')) ?? '';
}

export async function setHostSource(page: Page, source: string): Promise<void> {
  await page.evaluate((nextSource) => {
    const host = (window as unknown as {
      __slidewrightHost?: { setSource?: (value: string) => void };
    }).__slidewrightHost;
    if (!host?.setSource) throw new Error('test host hook not available');
    host.setSource(nextSource);
  }, source);
}

export async function getEditorSelection(page: Page): Promise<{
  start: number;
  end: number;
}> {
  const pane = page.locator('.sw-editor-pane');
  return {
    start: Number(await pane.getAttribute('data-selection-start')),
    end: Number(await pane.getAttribute('data-selection-end')),
  };
}

export async function focusEditor(page: Page): Promise<void> {
  await page.locator('.sw-editor-view .cm-content').focus();
}

export async function selectRichText(page: Page, startText: string, start: number, endText = startText, end = start) {
  await page.evaluate(({ startText, start, endText, end }) => {
    const root = document.querySelector('.sw-rich-text-editor .ProseMirror');
    if (!root) throw new Error('Editor not mounted');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let from: Node | null = null, to: Node | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!from && node.textContent === startText) from = node;
      if (!to && node.textContent === endText) to = node;
    }
    if (!from || !to) throw new Error(`Missing text: ${startText} / ${endText}`);
    (root as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(from, start); range.setEnd(to, end);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { startText, start, endText, end });
}
