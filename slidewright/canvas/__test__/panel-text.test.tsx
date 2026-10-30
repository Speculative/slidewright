import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Component, SourceFile, Value } from '../../runtime/ast.js';
import { DeckDocument } from '../../runtime/document.js';
import { buildFrames, buildObjects, buildProperty, resolveBuild } from '../../runtime/builds.js';
import { migrateTextDocumentParam } from '../../runtime/text-document-migration.js';
import { components } from '../../../decks/v0-reference/registry.js';
import { loadDeck } from '../../runtime/loader.js';
import { codeDocumentLines } from '../../../decks/uist-2026/components/code-document.js';

test('line projection preserves empty lines and marked fragments across paragraph/soft-break boundaries', () => {
  const lines = codeDocumentLines([
    createElement('p', { key: 'one' }, ['def ', createElement('span', { key: 's', style: { fontWeight: 700 } }, 'f()'), ':\n    return 42\n']),
    createElement('p', { key: 'two' }, ''),
  ]);
  assert.deepEqual(lines.map(line => line.text), ['def f():', '    return 42', '', '']);
  const html = renderToStaticMarkup(createElement('div', null, ...lines.map(line => line.content)));
  assert.match(html, /font-weight:700/);
  assert.doesNotMatch(html, /<p/);
});

test('SSR code composes syntax tokens with author styles, links and original line text', () => {
  const result = loadDeck({ source: `Deck { slides: [Slide { content: CodeDisplay { content: [Paragraph { content: [
    "def f():\\n    " Span { weight:"700" color:"#c2300e" href:"https://example.com" content:"return" } " 42"
  ] }] } }] }`, file: 'marked-code.sw', components, scope: { bindings: {} } });
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  const html = renderToStaticMarkup(createElement('div', null, result.slides));
  assert.equal((html.match(/data-demo-code-line=/g) ?? []).length, 2);
  assert.match(html, /font-weight:700/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /color:inherit[^>]*>return/);
  assert.match(html, /token keyword/);
});

const field = (node: Component, name: string) => node.fills.find(fill => fill.name === name)?.value;
const slideAt = (ast: SourceFile) => (field(ast.items[0]!, 'slides') as { items: Component[] }).items[0]!;
const wording = (slide: Component) => buildFrames(slide).map(frame => {
  const owner = buildObjects(resolveBuild(slide, frame.index, components)).find(node => field(node, 'id')?.kind === 'string' && (field(node, 'id') as { value: string }).value === 'code')!;
  const content = field(owner, 'content');
  const value = content && content.kind !== 'omit' ? content : field(owner, 'code');
  return value?.kind === 'string' ? value.value : '';
});

test('migration preserves mixed legacy/content fallback, equal-valued pins, omit and later wording', () => {
  const document = new DeckDocument(`Deck { slides: [Slide {
    content: CodeDisplay { id:"code" code:"base" }
    builds: [
      Build { id:"one" changes:[Change { target:"code" code:"base" }] }
      Build { id:"two" changes:[Change { target:"code" content:"rich" code:"shadow" }] }
      Build { id:"three" changes:[Change { target:"code" code:"later" }] }
      Build { id:"four" changes:[Change { target:"code" content:omit }] }
      Build { id:"five" changes:[Change { target:"code" code:omit }] }
    ]
  }] }`, 'migration.sw');
  const ast = structuredClone(document.snapshot.ast) as SourceFile;
  const slide = slideAt(ast);
  const before = wording(slide);
  assert.deepEqual(before, ['base', 'base', 'rich', 'rich', 'later', '']);
  const owner = field(slide, 'content') as Component;
  migrateTextDocumentParam(slide, owner, 'code');
  assert.deepEqual(wording(slide), before);
  assert.equal(buildProperty(slide, 1, 'code', 'content').keyframed, true);
  assert.equal(field(owner, 'code'), undefined);
  assert.equal((field(owner, 'content') as Value).kind, 'string');
});
