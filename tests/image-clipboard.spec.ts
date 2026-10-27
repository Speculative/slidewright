import { test, expect, type Page } from '@playwright/test';
import { focusEditor, getEditorSource, setHostSource } from './editor-helpers';

const images = (page: Page) => page.locator('.sw-canvas-stage [data-sw-component="Image"] img');
const rows = (page: Page) => page.locator('.sw-hierarchy-node[data-sw-component="Image"]');

async function writeImage(page: Page, width = 320, height = 160) {
  await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.fillRect(0, 0, width, height);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, { width, height });
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('native image paste selects an editable image, supports undo/redo, and survives reload', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const source = await getEditorSource(page);
  // Use a custom deck to exercise real browser draft persistence without
  // writing the repository's working talk.
  await page.evaluate(source => {
    (window as any).__slidewrightHost.openSource(source, 'pasted-images.sw');
  }, source);
  await writeImage(page);
  await page.keyboard.press('Control+v');
  await expect(images(page)).toHaveCount(1);
  await expect(rows(page)).toHaveClass(/selected/);
  await expect.poll(() => images(page).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
  const pasted = await getEditorSource(page);
  expect(pasted).toContain('src: "data:image/png;base64,');
  expect(pasted).toMatch(/width: 320\s+height: 160/);
  await page.keyboard.press('Control+z');
  await expect(images(page)).toHaveCount(0);
  await expect.poll(() => getEditorSource(page)).toBe(source);
  await page.keyboard.press('Control+Shift+z');
  await expect(images(page)).toHaveCount(1);
  await expect.poll(() => getEditorSource(page)).toBe(pasted);
  await page.reload();
  await expect(images(page)).toHaveCount(1);
  await expect.poll(() => images(page).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320);
});

test('large images fit with their aspect ratio inside a wrapped Freeform on the active slide', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, `Deck { slides: [
    Slide { content: PlateauSlide { content: Freeform { children: [] } } }
    Slide { content: Freeform { children: [] } }
  ] }`);
  await writeImage(page, 3200, 1600);
  await page.keyboard.press('Control+v');
  await expect(images(page)).toHaveCount(1);
  expect(await getEditorSource(page)).toMatch(/width: 1440\s+height: 720/);
  await expect(rows(page)).toHaveClass(/selected/);
});

test('multiple clipboard files become distinct images in one undo step', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const before = await getEditorSource(page);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 120;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'first.png', { type: 'image/png' }));
    data.items.add(new File([blob], 'second.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true }));
  });
  await expect(images(page)).toHaveCount(2);
  await expect(page.locator('.sw-hierarchy-node[data-sw-component="Image"].selected')).toHaveCount(2);
  expect((await getEditorSource(page)).match(/src: "data:image\/png/g)).toHaveLength(2);
  await page.keyboard.press('Control+z');
  await expect.poll(() => getEditorSource(page)).toBe(before);
});

test('image paste leaves source text editing alone and reports unreadable images on the canvas', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const before = await getEditorSource(page);
  await writeImage(page);
  await focusEditor(page);
  await page.keyboard.press('Control+v');
  expect(await getEditorSource(page)).toBe(before);
  await expect(images(page)).toHaveCount(0);
  // The unreadable-file case belongs to the canvas. Move focus there
  // before dispatching paste; the preceding assertion leaves it in source.
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['not an image'], 'broken.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true }));
  });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  expect(await getEditorSource(page)).toBe(before);
});

test('an image still decoding cannot overwrite a newer source edit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=empty-freeform');
  const before = await getEditorSource(page);
  await page.evaluate(async () => {
    const NativeReader = window.FileReader;
    window.FileReader = class extends NativeReader {
      override readAsDataURL(blob: Blob) {
        (window as any).releaseImageRead = () => super.readAsDataURL(blob);
      }
    };
    const canvas = document.createElement('canvas');
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'pending.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true }));
  });
  const newer = before.replace('Test', 'Newer source');
  await setHostSource(page, newer);
  await page.evaluate(async () => {
    const release = (window as any).releaseImageRead;
    if (!release) throw new Error('Image decoding did not start');
    release();
    // Wait for the pending file read and image decode to settle.
    await new Promise<void>(resolve => {
      const image = new Image();
      image.onload = () => requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      const canvas = document.createElement('canvas');
      image.src = canvas.toDataURL();
    });
  });
  expect(await getEditorSource(page)).toBe(newer);
  await expect(images(page)).toHaveCount(0);
});
