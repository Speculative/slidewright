// End-to-end tests for the source ↔ canvas sync paths that
// gestures.spec.ts doesn't cover. Each case loads a fixture, drives
// a host-level interaction (editor edit, double-click, cursor
// move, slide-strip click, text-edit gesture), and asserts that
// the *other* side caught up.
//
// These exercise the bidirectional `Host` contract — subscribe,
// sendSelection, setSource, setCursor, onCursorChange,
// onSelection — across the StandaloneHost ↔ canvas ↔ EditorPane
// triangle. The VS Code path uses a different host with the same
// shape; the canvas-side logic under test is identical.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function getSource(page: Page): Promise<string> {
  return page.locator('.sw-editor-pane').inputValue();
}

async function setSource(page: Page, source: string): Promise<void> {
  // `.fill()` clears + types — replaces the whole editor pane,
  // which is what we want when we're staging a known source state.
  // Blur after so subsequent keypresses (e.g., Cmd-Z) don't get
  // intercepted by the textarea's native handlers (the textarea
  // tracks its own undo for typing; we want our canvas handler).
  await page.locator('.sw-editor-pane').fill(source);
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body) el.blur();
  });
}

interface EditorSelection {
  start: number;
  end: number;
}

async function getEditorSelection(page: Page): Promise<EditorSelection> {
  return page.evaluate(() => {
    const ta = document.querySelector('.sw-editor-pane') as HTMLTextAreaElement | null;
    if (!ta) throw new Error('editor pane not found');
    return { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
  });
}

async function setEditorCursor(page: Page, offset: number): Promise<void> {
  // Use the host's setCursor directly. Programmatic
  // textarea.setSelectionRange + dispatchEvent('select') doesn't
  // reliably trigger React's onSelect (the synthetic event system
  // skips synthetic events that the underlying DOM didn't surface),
  // and we don't want this test to depend on simulating real
  // mouse / keyboard input precisely. Calling host.setCursor
  // directly is what an editor-pane integration would do anyway —
  // the test exercises the canvas's response, which is the
  // interesting half.
  await page.evaluate((off) => {
    const host = (window as unknown as { __slidewrightHost?: { setCursor?: (n: number) => void } }).__slidewrightHost;
    if (!host?.setCursor) throw new Error('test host hook not available');
    host.setCursor(off);
  }, offset);
}

// "Slide N of M" appears in .sw-canvas-status. Reads the active
// slide index (1-based as shown to the user, 0-based from React's
// activeIdx state).
async function getActiveSlideOneBased(page: Page): Promise<number> {
  const text = await page.locator('.sw-canvas-status').textContent();
  if (!text) throw new Error('canvas status bar not found');
  const match = text.match(/slide (\d+) of /);
  if (!match) throw new Error(`status text didn't match expected shape: ${text}`);
  return parseInt(match[1]!, 10);
}

// ─── Source → canvas ─────────────────────────────────────────────

test('typing in the editor pane re-renders the canvas', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  // Confirm the original Box is rendered.
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  // Replace source with a deck that has NO Box, just an empty
  // Freeform. Canvas should drop the Box on the next render.
  const newSource = `Deck {
  name: "Test"
  subtitle: "live edit"
  width: 1920
  height: 1080
  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: Freeform { children: [] }
    }
  ]
}
`;
  await setSource(page, newSource);
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toHaveCount(0);
});

test('source edit that moves a Box is reflected in the canvas', async ({
  page,
}) => {
  await page.goto('/canvas.html?fixture=single-box');
  // Replace `x: 400` with `x: 700` — Box should jump 300px right.
  const original = await getSource(page);
  const edited = original.replace(/x:\s*400/, 'x: 700');
  await setSource(page, edited);
  // Read the box's inner-div left style to confirm the new x.
  const left = await page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first()
    .evaluate((el) => (el as HTMLElement).style.left);
  expect(left).toBe('700px');
});

// ─── Canvas → editor selection ───────────────────────────────────

test('double-click on a shape moves the editor caret to its source range', async ({
  page,
}) => {
  await page.goto('/canvas.html?fixture=single-box');
  // Wait for the canvas to mount before reading data attrs.
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]'),
  ).toBeVisible();
  // Read the wrapper's data-sw-span attrs so we know the expected
  // selection range. Whatever the parser computed at load time is
  // ground truth.
  const span = await page.evaluate(() => {
    const wrapper = document.querySelector(
      '.sw-canvas-stage [data-sw-component="Box"]',
    );
    if (!wrapper) throw new Error('Box wrapper not found');
    return {
      start: parseInt(wrapper.getAttribute('data-sw-span-start') ?? '', 10),
      end: parseInt(wrapper.getAttribute('data-sw-span-end') ?? '', 10),
    };
  });
  // Double-click the rendered Box. The canvas's selection-sync
  // dispatch posts the range upstream, host.sendSelection fires,
  // EditorPane's onSelection listener calls
  // textarea.setSelectionRange.
  await page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first()
    .dblclick();
  // selectionStart/end should match the wrapper's source range.
  // EditorPane uses 'backward' direction so the caret is at start;
  // selectionStart is what we care about for caret position.
  const sel = await getEditorSelection(page);
  expect(sel.start).toBe(span.start);
  expect(sel.end).toBe(span.end);
});

// ─── Editor → canvas active slide ────────────────────────────────

test('moving the editor cursor into a slide makes that slide active', async ({
  page,
}) => {
  await page.goto('/canvas.html?fixture=two-slides');
  // Wait for the strip to render both slides before reading attrs.
  await expect(page.locator('.sw-thumb')).toHaveCount(2);
  // First slide is active by default.
  expect(await getActiveSlideOneBased(page)).toBe(1);
  // Find each slide's source range. Only the *active* slide shows
  // up in .sw-canvas-stage, so query the strip instead — it
  // renders all slides as thumbnails, each wrapped with
  // data-sw-component="Slide" and the source-span attrs.
  const spans = await page.evaluate(() => {
    const slides = document.querySelectorAll(
      '.sw-strip [data-sw-component="Slide"]',
    );
    return Array.from(slides).map((s) => ({
      start: parseInt(s.getAttribute('data-sw-span-start') ?? '', 10),
      end: parseInt(s.getAttribute('data-sw-span-end') ?? '', 10),
    }));
  });
  expect(spans.length).toBe(2);
  // Move the editor cursor to inside slide 2's source span. The
  // canvas's onCursorChange listener walks the slide list and
  // updates activeIdx. Use `expect.poll` so the status-bar read
  // retries while React commits the state change.
  await setEditorCursor(page, spans[1]!.start + 5);
  await expect.poll(() => getActiveSlideOneBased(page)).toBe(2);
  // Move it back to slide 1.
  await setEditorCursor(page, spans[0]!.start + 5);
  await expect.poll(() => getActiveSlideOneBased(page)).toBe(1);
});

// ─── Text-edit gesture (round-trip) ──────────────────────────────

test('double-click on a text span makes it editable; Enter commits', async ({
  page,
}) => {
  await page.goto('/canvas.html?fixture=single-textbox');
  // The TextBox content "Hello" renders inside a span with
  // data-sw-text-span-* attrs. Double-click → contentEditable.
  const textSpan = page
    .locator('.sw-canvas-stage [data-sw-text-span-start]')
    .first();
  await textSpan.dblclick();
  // Replace the contents (Cmd+A then type) and commit with Enter.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('World');
  await page.keyboard.press('Enter');
  const source = await getSource(page);
  expect(source).toMatch(/content:\s*"World"/);
  expect(source).not.toMatch(/content:\s*"Hello"/);
});

// ─── Selection clearing ──────────────────────────────────────────

test('Escape clears the active selection', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await page.locator('.sw-canvas-stage [data-sw-component="Box"] > div').first().click();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sw-selection-outline')).toHaveCount(0);
});

// ─── Slide-strip navigation ──────────────────────────────────────

test('clicking a thumbnail in the slide strip changes the active slide', async ({
  page,
}) => {
  await page.goto('/canvas.html?fixture=two-slides');
  expect(await getActiveSlideOneBased(page)).toBe(1);
  // The strip's thumbnails are .sw-thumb buttons; nth(1) = second.
  await page.locator('.sw-thumb').nth(1).click();
  expect(await getActiveSlideOneBased(page)).toBe(2);
});

// ─── External-edit reconciliation ────────────────────────────────

test('external param edit preserves selection on the same shape', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  // Select the Box. Outline appears.
  await page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first()
    .click();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  // Externally edit the source — change x: 400 → x: 600. Same
  // shape, different param. (slideIdx, childIdx, componentName)
  // identity is intact, so selection should survive.
  const original = await getSource(page);
  await setSource(page, original.replace(/x:\s*400/, 'x: 600'));
  // Outline still on screen, now at the new position.
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
});

test('canvas Cmd-Z undoes a drag commit', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const box = page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first();
  await expect(box).toBeVisible();
  // Read initial source for the assertion baseline.
  const beforeDrag = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  // Drag the box, commit a new x position.
  await box.hover();
  const eb = await box.boundingBox();
  if (!eb) throw new Error('box not found');
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.mouse.move(eb.x + eb.width / 2 + 50, eb.y + eb.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  // Confirm source actually changed.
  const afterDrag = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  expect(afterDrag).not.toBe(beforeDrag);
  // Move focus away from the editor pane (Cmd-Z routes to our
  // canvas handler only when focus isn't in the textarea — the
  // textarea has its own native undo for typing).
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  // Cmd-Z (or Ctrl-Z, ControlOrMeta covers both).
  await page.keyboard.press('ControlOrMeta+Z');
  const afterUndo = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  expect(afterUndo).toBe(beforeDrag);
});

test('canvas Cmd-Shift-Z redoes the undone gesture', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const box = page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first();
  await expect(box).toBeVisible();
  const eb = await box.boundingBox();
  if (!eb) throw new Error('box not found');
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.mouse.move(eb.x + eb.width / 2 + 50, eb.y + eb.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  const afterDrag = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z'); // undo
  await page.keyboard.press('ControlOrMeta+Shift+Z'); // redo
  const afterRedo = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  expect(afterRedo).toBe(afterDrag);
});

test('external edit clears the undo stack (barrier)', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const box = page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first();
  await expect(box).toBeVisible();
  const beforeDrag = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  // Commit a drag → undo stack now has [beforeDrag].
  const eb = await box.boundingBox();
  if (!eb) throw new Error('box not found');
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.mouse.move(eb.x + eb.width / 2 + 50, eb.y + eb.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  const afterDrag = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  // External edit: type in the editor pane.
  await setSource(page, afterDrag.replace(/y:\s*\d+/, 'y: 444'));
  // Confirm the external edit landed before testing the barrier.
  const afterEdit = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  expect(afterEdit).toMatch(/y:\s*444\b/);
  // Try to undo. Stack was cleared by the external edit, so this
  // should be a no-op — source stays at the externally-edited
  // version (not afterDrag, not beforeDrag).
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  const after = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  expect(after).toMatch(/y:\s*444\b/);
  expect(after).not.toBe(beforeDrag);
  expect(after).not.toBe(afterDrag);
});

test('undo walks back across edits made on different slides', async ({ page }) => {
  await page.goto('/canvas.html?fixture=two-slides');
  // Wait for the deck to render so the textarea has its source.
  await expect(
    page.locator('.sw-canvas-stage [data-sw-component="Box"]').first(),
  ).toBeVisible();
  const original = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  // Drag on slide 1.
  const dragInPlace = async () => {
    const box = page
      .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
      .first();
    await expect(box).toBeVisible();
    const eb = await box.boundingBox();
    if (!eb) throw new Error('box not found');
    await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
    await page.mouse.down();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve()),
          ),
        ),
    );
    await page.mouse.move(eb.x + eb.width / 2 + 50, eb.y + eb.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
  };
  await dragInPlace();
  // Nav to slide 2 and drag there.
  await page.locator('.sw-thumb').nth(1).click();
  await dragInPlace();
  // Nav back to slide 1. Two commits pushed (slide-1 drag, slide-2
  // drag). Mash Cmd-Z twice — each pop walks back one whole-source
  // snapshot, regardless of which slide was edited.
  await page.locator('.sw-thumb').nth(0).click();
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  await page.keyboard.press('ControlOrMeta+Z');
  const after = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  expect(after).toBe(original);
});

test('navigating slides preserves the undo stack', async ({ page }) => {
  // Regression: subscribe was registered with `activeIdx` in deps,
  // so each nav re-subscribed and the host's immediate-fire-on-
  // subscribe was indistinguishable from an external edit, silently
  // clearing the canvas-side undo stack.
  await page.goto('/canvas.html?fixture=two-slides');
  // Drag the box on slide 1.
  const box = page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first();
  await expect(box).toBeVisible();
  const beforeDrag = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  const eb = await box.boundingBox();
  if (!eb) throw new Error('box not found');
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.mouse.move(eb.x + eb.width / 2 + 50, eb.y + eb.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  // Navigate to slide 2 and back. Each nav is a state change but
  // not a source change — undo stack should survive.
  await page.locator('.sw-thumb').nth(1).click();
  await page.locator('.sw-thumb').nth(0).click();
  // Cmd-Z. Should revert to pre-drag.
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  const afterUndo = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  expect(afterUndo).toBe(beforeDrag);
});

test('focusing the editor pane without changes preserves the undo stack', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  const box = page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first();
  await expect(box).toBeVisible();
  const beforeDrag = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  // Commit a drag.
  const eb = await box.boundingBox();
  if (!eb) throw new Error('box not found');
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.mouse.move(eb.x + eb.width / 2 + 50, eb.y + eb.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  // Focus the editor pane (e.g., user clicks into it to read source)
  // without typing anything.
  await page.locator('.sw-editor-pane').focus();
  // Move focus back to the canvas so Cmd-Z routes to the canvas
  // handler (textarea's native undo would otherwise intercept).
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body) el.blur();
  });
  await page.locator('.sw-canvas-stage .presentation').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Z');
  // Should revert to the pre-drag source.
  const afterUndo = await page.evaluate(
    () =>
      (
        document.querySelector('.sw-editor-pane') as HTMLTextAreaElement
      ).value,
  );
  expect(afterUndo).toBe(beforeDrag);
});

test('external edit that deletes the selected shape clears selection', async ({ page }) => {
  await page.goto('/canvas.html?fixture=single-box');
  await page
    .locator('.sw-canvas-stage [data-sw-component="Box"] > div')
    .first()
    .click();
  await expect(page.locator('.sw-selection-outline')).toHaveCount(1);
  // Strip the Box from source.
  const stripped = `Deck {
  name: "Test"
  subtitle: "single-box (stripped)"
  width: 1920
  height: 1080
  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: Freeform { children: [] }
    }
  ]
}
`;
  await setSource(page, stripped);
  await expect(page.locator('.sw-selection-outline')).toHaveCount(0);
});
