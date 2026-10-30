import { test, expect, type Page } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const program = 'def f():\n    return 42';
const source = `// retain this comment
Deck { slides: [Slide { content: Freeform { children: [
  CodeDisplay { id:"code" x:100 y:225 width:1000 height:700 code:${JSON.stringify(program)} }
  TerminalDisplay { id:"terminal" x:1150 y:225 width:600 height:350 content:"original output" }
] } }] } // retain EOF`;

async function selectWord(page: Page, word: string) {
  await page.locator('.sw-rich-text-editor .ProseMirror').evaluate((root, word) => {
    (root as HTMLElement).focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent!.indexOf(word);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + word.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return;
    }
    throw new Error(`Text not found: ${word}`);
  }, word);
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
}

test('code range formatting survives source reload with syntax, wording, indentation and undo intact', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const stage = page.locator('.sw-canvas-stage');
  const open = stage.getByRole('button', { name: 'Edit code', exact: true });
  await open.focus(); await open.press('Enter');
  await selectWord(page, 'return');
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const formatting = page.getByRole('group', { name: 'Text formatting', exact: true });
  await expect(formatting.getByLabel('Paragraph style', { exact: true })).toHaveCount(0);
  await formatting.getByLabel('Text style', { exact: true }).selectOption('color');
  await formatting.getByLabel('Style value', { exact: true }).fill('#c2300e');
  await formatting.getByRole('button', { name: 'Apply style', exact: true }).click();
  expect(await getEditorSource(page)).toBe(source);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const code = stage.getByLabel('Python code', { exact: true });
  await expect(code.locator('.token.keyword').filter({ hasText: 'return' })).toHaveCSS('color', 'rgb(194, 48, 14)');
  await expect(code.locator('.token.keyword').filter({ hasText: 'return' })).toHaveCSS('font-weight', '700');
  await expect(code.locator('.token.keyword').first()).toHaveCSS('color', 'rgb(128, 0, 255)');
  await expect(code.locator('[data-demo-code-line]')).toHaveText(program.split('\n').map((line, i) => `${i + 1} ${line}`));
  const saved = await getEditorSource(page);
  expect(saved).not.toMatch(/\bcode:/);
  expect(saved).toContain('Span');
  expect(saved).toContain('// retain this comment');
  expect(saved).toContain('// retain EOF');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await getEditorSource(page)).toBe(source);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await getEditorSource(page)).toBe(saved);
  await setHostSource(page, source);
  await setHostSource(page, saved);
  await expect(code.locator('.token.keyword').filter({ hasText: 'return' })).toHaveCSS('color', 'rgb(194, 48, 14)');
  await code.screenshot({ path: test.info().outputPath('formatted-code.png') });
  expect(errors).toEqual([]);
});

test('terminal ranges can be bold and underlined, survive further text edits, and cancel cleanly', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const stage = page.locator('.sw-canvas-stage');
  await stage.getByLabel('Demo terminal').getByText('original output', { exact: true }).dblclick();
  await selectWord(page, 'original');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.press('ControlOrMeta+u');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const body = stage.locator('[data-sw-terminal-display] [data-sw-text-document]');
  await expect(body.locator('[data-sw-component="Span"]').filter({ hasText: 'original' }).last()).toHaveCSS('font-weight', '700');
  await expect(body.locator('[data-sw-component="Span"]').first()).toHaveCSS('text-decoration-line', 'underline');
  const saved = await getEditorSource(page);
  await stage.getByRole('button', { name: 'Edit output', exact: true }).click();
  const input = stage.getByRole('textbox', { name: 'Edit text', exact: true });
  await input.press('ControlOrMeta+Home');
  await page.keyboard.insertText('new ');
  await input.press('ControlOrMeta+Enter');
  await expect(body).toContainText('new original output');
  await expect(body.locator('[data-sw-component="Span"]').filter({ hasText: 'original' }).last()).toHaveCSS('font-weight', '700');
  const updated = await getEditorSource(page);
  const reopen = stage.getByRole('button', { name: 'Edit output', exact: true });
  await reopen.focus(); await reopen.press('Space');
  await input.fill('throw away');
  await input.press('Escape');
  expect(await getEditorSource(page)).toBe(updated);
  expect(updated).not.toBe(saved);
});

test('code build wording barriers migrate together and formatting keys remain independent', async ({ page }) => {
  const built = source.replace('] } }] }', `] } builds: [
    Build { id:"one" changes: [] }
    Build { id:"two" changes: [Change { target:"code" code:${JSON.stringify('def f():\n    return 99')} }] }
  ] }] }`);
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, built);
  await page.locator('.sw-build-thumb').first().click();
  const stage = page.locator('.sw-canvas-stage');
  await stage.getByRole('button', { name: 'Edit code', exact: true }).click();
  await selectWord(page, 'return');
  await page.keyboard.press('ControlOrMeta+b');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const saved = await getEditorSource(page);
  expect(saved).toContain('textStyles:');
  expect(saved).not.toMatch(/\bcode:/);
  await expect(stage.locator('.token.keyword').filter({ hasText: 'return' })).toHaveCSS('font-weight', '700');
  await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
  await expect(stage.locator('.token.keyword').filter({ hasText: 'return' })).toHaveCSS('font-weight', '400');
  await page.locator('.sw-build-thumb').nth(1).click();
  await expect(stage.getByLabel('Python code')).toContainText('99');
  await expect(stage.getByLabel('Python code')).not.toContainText('42');
  await expect(page.locator('.sw-canvas-diagnostics')).toHaveCount(0);
});

test('code marks can span lines and Enter/Tab preserve literal whitespace', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const stage = page.locator('.sw-canvas-stage');
  await stage.getByRole('button', { name: 'Edit code', exact: true }).click();
  await stage.locator('.ProseMirror').evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let first: Node | null = null, last: Node | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent === 'def f():') first = node;
      if (node.textContent === '    return 42') last = node;
    }
    if (!first || !last) throw new Error('Missing code text');
    const range = document.createRange();
    range.setStart(first, 4); range.setEnd(last, 10);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+i');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const code = stage.getByLabel('Python code', { exact: true });
  await expect(code.locator('.token.function')).toHaveCSS('font-style', 'italic');
  await expect(code.locator('.token.keyword').filter({ hasText: 'return' })).toHaveCSS('font-style', 'italic');
  await stage.getByRole('button', { name: 'Edit code', exact: true }).click();
  const input = stage.getByRole('textbox', { name: 'Edit text', exact: true });
  await input.press('ControlOrMeta+End');
  await input.press('Enter'); await input.press('Tab');
  await page.keyboard.insertText('pass');
  await input.press('ControlOrMeta+Enter');
  await expect(code.locator('[data-demo-code-line]')).toHaveText(['1 def f():', '2     return 42', '3     pass']);
});

test('clearing a code draft on a build keeps the panel and its initial wording', async ({ page }) => {
  const built = source.replace('] } }] }', '] } builds:[Build {id:"one" changes:[]}] }] }');
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, built);
  await page.locator('.sw-build-thumb').first().click();
  const stage = page.locator('.sw-canvas-stage');
  await stage.getByRole('button', { name: 'Edit code', exact: true }).click();
  await stage.getByRole('textbox', { name: 'Edit text', exact: true }).fill('');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(stage.locator('[data-sw-code-display]')).toBeVisible();
  await expect(stage.locator('[data-demo-code-line]')).toHaveText(['1 ']);
  await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
  await expect(stage.getByLabel('Python code')).toContainText('return 42');
});
