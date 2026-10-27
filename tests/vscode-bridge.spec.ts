import { test, expect, type Page } from '@playwright/test';
const source = (page: Page) => page.evaluate(() => (window as any).bridge.host.document.snapshot.source);
const native = (page: Page) => page.evaluate(() => (window as any).bridge.source());
const requests = (page: Page) => page.evaluate(() => (window as any).bridge.requests);
const complete = (page: Page, accepted = true) => page.evaluate(value => (window as any).bridge.complete(value), accepted);
const metrics = (page: Page) => page.locator('.sw-authoring-workspace');
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/vscode-harness.html');
  await expect(page.locator('.sw-hierarchy-node[data-sw-component="Box"]')).toHaveCount(1);
});

test('rapid canvas edits, undo and redo queue precise requests and retain later slides through native acknowledgements', async ({ page }) => {
  const original = await source(page);
  await page.evaluate(() => {
    const doc = (window as any).bridge.host.document;
    (window as any).laterHandle = doc.snapshot.occurrences.filter((o: any) => o.component.name === 'Slide')[99].handle;
    (window as any).laterThumb = document.querySelectorAll('.sw-thumb-slot [data-sw-component="Box"]')[99];
  });
  await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const after = original.replace('x: 200', 'x: 220');
  await expect.poll(() => source(page)).toBe(after);
  expect(await native(page)).toBe(original);
  expect(await requests(page)).toHaveLength(1);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '1');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '99');
  await complete(page);
  await expect.poll(async () => (await requests(page)).length).toBe(2);
  expect(await source(page)).toBe(after);
  await complete(page);
  await expect.poll(() => native(page)).toBe(after);
  await expect(page.locator('.sw-selection-outline')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => source(page)).toBe(original.replace('x: 200', 'x: 210'));
  await complete(page);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => source(page)).toBe(original);
  await complete(page);
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect.poll(() => source(page)).toBe(original.replace('x: 200', 'x: 210'));
  await complete(page);
  const sent = await requests(page);
  expect(sent.map((r: any) => r.baseVersion)).toEqual([1, 2, 3, 4, 5]);
  for (const request of sent) {
    expect(request.changes).toHaveLength(1);
    expect(request.changes[0].end - request.changes[0].start).toBeLessThan(4);
  }
  expect(await page.evaluate(() => {
    const doc = (window as any).bridge.host.document;
    return !!doc.occurrence((window as any).laterHandle) &&
      document.querySelectorAll('.sw-thumb-slot [data-sw-component="Box"]')[99] === (window as any).laterThumb;
  })).toBe(true);
  await expect(page.locator('.sw-selection-outline')).toHaveCount(0);
});

for (const external of [false, true]) {
  test(`${external ? 'an external race' : 'a rejected native edit'} restores source and clears speculative canvas history`, async ({ page }) => {
    const original = await source(page);
    await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').click();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => source(page)).toBe(original.replace('x: 200', 'x: 220'));
    const authority = external ? original.replace('x: 200', 'x: 999') : original;
    if (external) await page.evaluate(value => (window as any).bridge.external(value), authority);
    await complete(page, false);
    await expect.poll(() => source(page)).toBe(authority);
    await page.keyboard.press('ControlOrMeta+Z');
    expect(await source(page)).toBe(authority);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    expect(await source(page)).toBe(authority);
    expect(await requests(page)).toHaveLength(1);
    await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').click();
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => source(page)).toBe(authority.replace(external ? 'x: 999' : 'x: 200', external ? 'x: 1009' : 'x: 210'));
    await complete(page);
    expect(await source(page)).toBe(await native(page));
  });
}

test('canvas undo and redo can queue before the first native acknowledgement', async ({ page }) => {
  const original = await source(page);
  const edited = original.replace('x: 200', 'x: 210');
  await page.locator('.sw-hierarchy-node[data-sw-component="Box"]').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => source(page)).toBe(original);
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect.poll(() => source(page)).toBe(edited);
  expect(await requests(page)).toHaveLength(1);
  for (let i = 0; i < 3; i++) {
    await complete(page);
    await expect.poll(() => native(page)).toBe(i === 1 ? original : edited);
    expect(await source(page)).toBe(edited);
  }
  expect((await requests(page)).map((r: any) => r.baseVersion)).toEqual([1, 2, 3]);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(() => source(page)).toBe(original);
  await complete(page);
  expect(await native(page)).toBe(original);
});

test('disjoint native source changes retain middle occurrences, DOM and accurate global offsets', async ({ page }) => {
  const original = await source(page);
  const result = await page.evaluate(original => {
    const bridge = (window as any).bridge;
    const doc = bridge.host.document;
    const middle = doc.snapshot.occurrences.filter((o: any) => o.component.name === 'Slide')[50].handle;
    const thumb = document.querySelectorAll('.sw-thumb-slot [data-sw-component="Box"]')[50];
    (window as any).nativeMiddle = { middle, thumb };
    const changes = ['"slide-0"', '"slide-99"'].map(text => ({ start: original.indexOf(text),
      end: original.indexOf(text) + text.length, insert: '"a longer ' + text.slice(1) }));
    let next = original;
    for (const change of changes.reverse()) next = next.slice(0, change.start) + change.insert + next.slice(change.end);
    bridge.external(next, changes.reverse());
    return { next, retained: !!doc.occurrence(middle), parsed: doc.snapshot.parsing };
  }, original);
  expect(result.retained).toBe(true);
  expect(result.parsed.fullParses).toBe(0);
  expect(result.parsed.parsedCharacters).toBeLessThan(400);
  await expect(metrics(page)).toHaveAttribute('data-sw-resolved-slides', '2');
  await expect(metrics(page)).toHaveAttribute('data-sw-reused-slides', '98');
  expect(await source(page)).toBe(result.next);
  expect(await page.evaluate(() => {
    const { middle, thumb } = (window as any).nativeMiddle;
    const doc = (window as any).bridge.host.document;
    const range = doc.occurrence(middle).range;
    return document.querySelectorAll('.sw-thumb-slot [data-sw-component="Box"]')[50] === thumb &&
      doc.snapshot.source.slice(range.start, range.end).includes('label: "slide-50"');
  })).toBe(true);
});
