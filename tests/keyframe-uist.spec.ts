import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { getEditorSource, setHostSource } from './editor-helpers';
import { parse } from '../slidewright/runtime/parser';
import { buildObjects, buildProperty, objectId } from '../slidewright/runtime/builds';
import type { Component } from '../slidewright/runtime/ast';

test('UIST implicit containers and interactive demo thumbnails support adding builds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, readFileSync('decks/uist-2026/deck.sw', 'utf8'));
  // Slide 2 uses implicit Freeform children; slide 12 embeds playback buttons.
  for (const index of [2, 12]) {
    const initial = page.getByRole('option', { name: `Slide ${index}`, exact: true });
    await initial.click();
    await page.getByRole('button', { name: 'Add build', exact: true }).click();
    await expect(page.locator('.sw-build-controls')).toContainText('Frame 2 of 2');
    const build = page.locator(`.sw-thumb-slot[data-slide-index="${index - 1}"] .sw-build-thumb`);
    await expect(build).toHaveCount(1);
    await expect(build).toHaveAttribute('aria-selected', 'true');
    await initial.focus();
    await initial.press('Enter');
    await expect(page.locator('.sw-build-controls')).toContainText('Frame 1 of 2');
    await build.focus();
    await build.press('Space');
    await expect(page.locator('.sw-build-controls')).toContainText('Frame 2 of 2');
  }
  await expect(page.locator('.sw-strip button button')).toHaveCount(0);
  await expect(page.locator('.sw-strip .sw-thumb-frame:not([inert])')).toHaveCount(0);
  expect(parse(await getEditorSource(page), 'uist.sw').diagnostics).toEqual([]);
  expect(errors).toEqual([]);
});

test('UIST nested slide content supports add-build, position edits and typography barriers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Fixture mode keeps this edit exercise separate from server persistence.
  await page.goto('/canvas.html?fixture=empty-freeform');
  await setHostSource(page, readFileSync('decks/uist-2026/deck.sw', 'utf8'));
  const before = await getEditorSource(page);
  await page.getByRole('button', { name: 'Add build', exact: true }).click();
  await expect(page.locator('.sw-build-controls')).toContainText('Frame 2 of 2');
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').first().click();
  const x = page.locator('[data-build-property="x"] input');
  const originalX = Number(await x.inputValue());
  await x.fill(String(originalX + 40)); await x.press('Enter');
  await page.locator('.sw-additional-keyframes summary').click();
  await page.getByRole('button', { name: 'Keyframe fontSize', exact: true }).click();
  const toolbar = page.getByRole('toolbar', { name: 'TextBox formatting', exact: true });
  await toolbar.getByLabel('Font size', { exact: true }).fill('90');
  await page.keyboard.press('Enter');
  await expect(toolbar.getByLabel('Font size', { exact: true })).toHaveValue('90');
  await expect(page.locator('.sw-canvas-diagnostics')).toHaveCount(0);
  const ast = parse(await getEditorSource(page), 'uist.sw').ast;
  const slides = ast.items[0]!.fills.find(fill => fill.name === 'slides')!.value;
  const slide = (slides as { items: Component[] }).items[0]!;
  const title = buildObjects(slide).find(object => object.name === 'TextBox')!;
  const id = objectId(title)!;
  const initial = buildProperty(slide, 0, id, 'x').value;
  const changed = buildProperty(slide, 1, id, 'x').value;
  expect(initial?.kind === 'number' && initial.value).toBe(originalX);
  expect(changed?.kind === 'number' && changed.value).toBe(originalX + 40);
  const fontSize = buildProperty(slide, 1, id, 'fontSize').value;
  expect(fontSize?.kind === 'number' && fontSize.value).toBe(90);
  await page.getByRole('option', { name: 'Slide 1', exact: true }).click();
  await page.locator('.sw-hierarchy-node[data-sw-component="TextBox"]').first().click();
  await expect(page.locator('[data-build-property="x"] input')).toHaveValue(String(originalX));
  expect(await getEditorSource(page)).not.toBe(before);
  expect(errors).toEqual([]);
});
