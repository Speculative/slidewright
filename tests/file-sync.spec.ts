import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';

const endpoint = '/__slidewright/source?deck=reference';

test('editor saves continuously, coalesces rapid edits, and reloads from disk', async ({ page, request }) => {
  const original = await (await request.get(endpoint)).json();
  try {
    await page.goto('/canvas.html');
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    await page.locator('.sw-editor-view .cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\n// streamed edit');
    const typed = await getEditorSource(page);
    await expect.poll(async () => (await (await request.get(endpoint)).json()).source).toBe(typed);
    await page.evaluate(() => {
      const host = (window as any).__slidewrightHost;
      for (let i = 0; i < 20; i++) host.setSource(host.source + '\n// queued');
    });
    const latest = await getEditorSource(page);
    await expect.poll(async () => (await (await request.get(endpoint)).json()).source).toBe(latest);
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    expect(await getEditorSource(page)).toBe(latest);
  } finally {
    await page.close();
    const disk = await (await request.get(endpoint)).json();
    await request.put(endpoint, { data: { revision: disk.revision, source: original.source } });
  }
});

test('external edits are noticed while idle, preserve the draft, and require explicit reload', async ({ page, request }) => {
  const original = await (await request.get(endpoint)).json();
  try {
    await page.goto('/canvas.html');
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    const external = `${original.source}\n// external agent edit`;
    expect((await request.put(endpoint, { data: { revision: original.revision, source: external } })).ok()).toBe(true);
    await expect(page.getByRole('status')).toContainText('Out of sync');
    expect(await getEditorSource(page)).toBe(original.source);
    const local = `${original.source}\n// retained local draft`;
    await setHostSource(page, local);
    await expect(page.getByRole('status')).toContainText('Out of sync');
    expect((await (await request.get(endpoint)).json()).source).toBe(external);
    await page.getByRole('button', { name: 'Reload from disk', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    expect(await getEditorSource(page)).toBe(external);
    await setHostSource(page, `${external}\n// after reload`);
    await expect.poll(async () => (await (await request.get(endpoint)).json()).source).toBe(`${external}\n// after reload`);
  } finally {
    await page.close();
    const disk = await (await request.get(endpoint)).json();
    await request.put(endpoint, { data: { revision: disk.revision, source: original.source } });
  }
});

test('an external change just before a save rejects the write without replacing either version', async ({ page, request }) => {
  const original = await (await request.get(endpoint)).json();
  const external = `${original.source}\n// concurrent external edit`;
  let intercepted = false;
  try {
    await page.goto('/canvas.html');
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    await page.route('**/__slidewright/source?deck=reference', async route => {
      if (route.request().method() === 'PUT' && !intercepted) {
        intercepted = true;
        const disk = await (await request.get(endpoint)).json();
        expect((await request.put(endpoint, { data: { revision: disk.revision, source: external } })).ok()).toBe(true);
      }
      await route.continue();
    });
    const local = `${original.source}\n// concurrent local edit`;
    await setHostSource(page, local);
    await expect(page.getByRole('status')).toContainText('Out of sync');
    expect(intercepted).toBe(true);
    expect(await getEditorSource(page)).toBe(local);
    expect((await (await request.get(endpoint)).json()).source).toBe(external);
  } finally {
    await page.close();
    const disk = await (await request.get(endpoint)).json();
    await request.put(endpoint, { data: { revision: disk.revision, source: original.source } });
  }
});

test('failed saves survive reload and deck switching without overwriting disk', async ({ page, request }) => {
  const original = await (await request.get(endpoint)).json();
  await page.goto('/canvas.html');
  await expect(page.getByRole('status')).toHaveText('Saved to source file');
  await page.route('**/__slidewright/source?deck=reference', route =>
    route.request().method() === 'PUT' ? route.abort() : route.continue());
  const local = `${original.source}\n// work during an outage`;
  await setHostSource(page, local);
  await expect(page.getByRole('status')).toContainText('Source file unavailable');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Out of sync');
  expect(await getEditorSource(page)).toBe(local);
  expect((await (await request.get(endpoint)).json()).source).toBe(original.source);
  await page.getByLabel('Deck', { exact: true }).selectOption('uist-2026');
  await expect(page.getByRole('status')).toHaveText('Saved to source file');
  await page.getByLabel('Deck', { exact: true }).selectOption('reference');
  await expect(page.getByRole('status')).toContainText('Out of sync');
  expect(await getEditorSource(page)).toBe(local);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download source', exact: true }).click();
  const { readFile } = await import('node:fs/promises');
  expect(await readFile((await (await downloadPromise).path())!, 'utf8')).toBe(local);
  await page.getByRole('button', { name: 'Reload from disk', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved to source file');
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Saved to source file');
  expect(await getEditorSource(page)).toBe(original.source);
});

test('lost save acknowledgement recovers the already saved draft after reload', async ({ page, request }) => {
  const original = await (await request.get(endpoint)).json();
  try {
    await page.goto('/canvas.html');
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    await page.route('**/__slidewright/source?deck=reference', async route => {
      if (route.request().method() === 'PUT') { await route.fetch(); await route.abort(); }
      else await route.continue();
    });
    const local = `${original.source}\n// acknowledgement lost`;
    await setHostSource(page, local);
    await expect(page.getByRole('status')).toContainText('Source file unavailable');
    expect((await (await request.get(endpoint)).json()).source).toBe(local);
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    expect(await getEditorSource(page)).toBe(local);
  } finally {
    await page.close();
    const disk = await (await request.get(endpoint)).json();
    await request.put(endpoint, { data: { revision: disk.revision, source: original.source } });
  }
});

test('browser backup failure stays visible alongside a save error', async ({ page }) => {
  await page.goto('/canvas.html');
  await expect(page.getByRole('status')).toHaveText('Saved to source file');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('storage full'); }; });
  await page.route('**/__slidewright/source?deck=reference', route => route.abort());
  const local = `${await getEditorSource(page)}\n// backup unavailable`;
  await setHostSource(page, local);
  await expect(page.getByRole('status')).toContainText('Browser backup unavailable');
  await expect(page.getByRole('status')).toContainText('Source file unavailable');
  expect(await getEditorSource(page)).toBe(local);
});

test('a transient save failure retries and saves the newest queued edit', async ({ page, request }) => {
  const original = await (await request.get(endpoint)).json();
  try {
    await page.goto('/canvas.html');
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    let fail = true;
    await page.route('**/__slidewright/source?deck=reference', route =>
      fail && route.request().method() === 'PUT' ? route.abort() : route.continue());
    await setHostSource(page, `${original.source}\n// first queued edit`);
    await expect(page.getByRole('status')).toContainText('Source file unavailable');
    const latest = `${original.source}\n// latest queued edit`;
    await setHostSource(page, latest);
    await expect(page.getByRole('status')).toContainText('Source file unavailable');
    fail = false;
    await expect(page.getByRole('status')).toHaveText('Saved to source file');
    expect((await (await request.get(endpoint)).json()).source).toBe(latest);
    expect(await getEditorSource(page)).toBe(latest);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('slidewright:standalone:draft:v1:reference')!).pending)).toBe(false);
  } finally {
    await page.close();
    const disk = await (await request.get(endpoint)).json();
    await request.put(endpoint, { data: { revision: disk.revision, source: original.source } });
  }
});
