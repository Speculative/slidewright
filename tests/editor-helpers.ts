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
