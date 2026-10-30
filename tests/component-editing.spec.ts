import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const source = `// preserve this header
Deck { width:1920 height:1080 slides: [Slide { content: PlateauSlide { branding:true content: Freeform { children: [
  CodeDisplay { id:"code" x:100 y:225 width:1000 height:700 code:"def f():\\n    return 42" }
  TerminalDisplay { id:"terminal" x:1150 y:225 width:600 height:350 content:"original output" }
] } } builds: [Build { id:"one" changes: [] }] }
Slide { content: TextBox { content:"second slide" } }] } // preserve EOF`;

test('component clicks persist parameter edits with keyboard access and canvas undo/redo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const stage = page.locator('.sw-canvas-stage');
  const line = stage.getByRole('button', { name: 'Emphasize line 2', exact: true });
  await line.click();
  await expect(line).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await getEditorSource(page)).includes('highlightedLines')).toBe(true);
  expect(await getEditorSource(page)).toContain('// preserve this header');
  expect(await getEditorSource(page)).toContain('// preserve EOF');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(line).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(line).toHaveAttribute('aria-pressed', 'true');
  await line.focus();
  await line.press('Space');
  await expect(line).toHaveAttribute('aria-pressed', 'false');
  await line.press('Enter');
  await expect(line).toHaveAttribute('aria-pressed', 'true');

  // One Save publishes one transaction; typing does not publish drafts.
  const before = await getEditorSource(page);
  await stage.getByRole('button', { name: 'Edit output', exact: true }).click();
  const input = stage.getByRole('textbox', { name: 'Edit output', exact: true });
  const transcript = '>>> calculate("🙂")\n\n  output <>&\n';
  await input.fill(transcript);
  expect(await getEditorSource(page)).toBe(before);
  await stage.getByRole('button', { name: 'Save output', exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(stage.getByLabel('Demo terminal').locator(':scope > div')).toHaveText(transcript.split('\n'));
  await page.keyboard.press('ControlOrMeta+z');
  await expect(stage.getByLabel('Demo terminal')).toContainText('original output');
  expect(await getEditorSource(page)).toBe(before);

  await stage.getByRole('button', { name: 'Edit code', exact: true }).click();
  const code = stage.getByRole('textbox', { name: 'Edit code', exact: true });
  await code.fill('def edited():\n    return 7');
  await code.press('ControlOrMeta+Enter');
  await expect(stage.getByLabel('Python code')).toContainText('edited');
  await expect(stage.getByLabel('Python code').locator('.token.keyword').first()).toHaveText('def');
  expect(errors).toEqual([]);
});

test('edits follow build scope and controls are absent from thumbnails and presentation', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const stage = page.locator('.sw-canvas-stage');
  const line = stage.getByRole('button', { name: 'Emphasize line 2', exact: true });
  await expect(page.locator('.sw-strip').getByRole('button', { name: /Emphasize line|Edit output|Edit code/ })).toHaveCount(0);
  await page.locator('.sw-build-thumb').first().click();
  await line.click();
  await expect(line).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
  await expect(line).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.sw-build-thumb').first().click();
  await expect(line).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(stage.getByRole('button', { name: /Emphasize line|Edit output|Edit code/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
  await expect(stage.getByRole('button', { name: 'Edit output', exact: true })).toBeVisible();
});

test('cancel and external source/build/slide changes discard output drafts', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await getEditorSource(page);
  await setHostSource(page, source);
  const stage = page.locator('.sw-canvas-stage');
  const open = async () => {
    await stage.getByRole('button', { name: 'Edit output', exact: true }).click();
    const input = stage.getByRole('textbox', { name: 'Edit output', exact: true });
    await input.fill('discard this draft');
    return input;
  };
  await (await open()).press('Escape');
  expect(await getEditorSource(page)).toBe(source);
  await open();
  await setHostSource(page, source.replace('original output', 'external output'));
  await expect(stage.getByRole('textbox')).toHaveCount(0);
  await expect(stage.getByLabel('Demo terminal')).toContainText('external output');
  await open();
  await page.locator('.sw-build-thumb').first().click();
  await expect(stage.getByRole('textbox')).toHaveCount(0);
  await open();
  await page.getByRole('option', { name: 'Slide 2', exact: true }).click();
  await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
  await expect(stage.getByRole('textbox')).toHaveCount(0);
  expect(await getEditorSource(page)).not.toContain('discard this draft');
});
