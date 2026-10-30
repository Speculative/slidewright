import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeckDocument, type DocumentSnapshot, type OccurrenceHandle } from '../../runtime/document.js';
import type { Component, SourceFile } from '../../runtime/ast.js';
import { buildProperty } from '../../runtime/builds.js';
import { components } from '../../../decks/v0-reference/registry.js';
import type { ParamPatch } from '../../runtime/component-editing.js';
import { createBuildEditingSnapshot } from '../build-editing.js';
import { prepareComponentParamEdit } from '../component-editing.js';

const source = `// keep header\r\nDeck { slides: [Slide {
  content: Freeform { children: [
    // keep panel
    CodeDisplay { id:"code" code:"return 1" highlightedLines: [] x:1.50 }
    TerminalDisplay { id:"terminal" content:"original" }
  ] }
  builds: [
    Build { id:"one" changes: [Change { target:"code" highlightedLines:[2] }] }
    Build { id:"two" changes: [] }
    Build { id:"three" changes: [Change { target:"code" highlightedLines:[3] }] }
  ]
} Slide { content: TextBox { content: "untouched" } }] } // keep EOF`;
const setup = (input = source) => {
  const document = new DeckDocument(input, 'component-edit.sw');
  const handle = document.snapshot.occurrences.find(item => item.component.name === 'CodeDisplay')!.handle;
  return { document, handle };
};
const frame = (snapshot: DocumentSnapshot, index = 2, direction: 'forward' | 'backward' | 'everywhere' = 'forward') =>
  createBuildEditingSnapshot(snapshot, { slideIndex: 0, buildIndex: index, direction, registry: components });
const lines = (ast: SourceFile, index: number) => {
  const slides = ast.items[0]!.fills.find(fill => fill.name === 'slides')!.value;
  assert.equal(slides.kind, 'list');
  const slide = slides.kind === 'list' ? slides.items[0] as Component : undefined;
  const value = buildProperty(slide!, index, 'code', 'highlightedLines').value;
  return value?.kind === 'list' ? value.items.map(item => item.kind === 'number' ? item.value : null) : undefined;
};

test('parameter callback sees effective values and lowers forward while preserving comments and selections', () => {
  const { document, handle } = setup();
  const original = document.snapshot;
  const result = prepareComponentParamEdit(frame(original), components, handle, current => {
    assert.deepEqual(current.highlightedLines, [2]);
    return { highlightedLines: [...current.highlightedLines as number[], 7] };
  })!;
  assert.ok(result);
  assert.deepEqual([0, 1, 2, 3].map(i => lines(result.ast, i)), [[], [2], [2, 7], [3]]);
  assert.match(result.newSource, /x:1\.50/);
  assert.ok(result.newSource.startsWith('// keep header\r\n'));
  assert.ok(result.newSource.includes('// keep panel'));
  assert.ok(result.newSource.endsWith('} Slide { content: TextBox { content: "untouched" } }] } // keep EOF'));
  assert.equal(result.baseRevision, original.revision);
  assert.equal(result.newSelections.length, 1);
  assert.equal(document.snapshot, original);
  document.updateSource(result.newSource, 'component-edit.sw', { baseRevision: result.baseRevision, changes: result.changes });
  assert.deepEqual(lines(document.snapshot.ast as SourceFile, 2), [2, 7]);
});

test('parameter edits reuse backward and everywhere propagation', () => {
  const { document, handle } = setup();
  const backward = prepareComponentParamEdit(frame(document.snapshot, 2, 'backward'), components, handle, { highlightedLines: [9] })!;
  assert.deepEqual([0, 1, 2, 3].map(i => lines(backward.ast, i)), [[], [2], [9], [3]]);
  const everywhere = prepareComponentParamEdit(frame(document.snapshot, 2, 'everywhere'), components, handle, { highlightedLines: [9] })!;
  assert.deepEqual([0, 1, 2, 3].map(i => lines(everywhere.ast, i)), [[9], [9], [9], [9]]);
});

test('updates are atomic, validate declared types/permissions, and reject retired targets and references', () => {
  const { document, handle } = setup();
  const patches: ParamPatch[] = [{ highlightedLines: ['bad'] }, { code: 'new', fontSize: 99 }, { highlightedLines: [NaN] }, { children: [] }];
  for (const patch of patches) {
    assert.equal(prepareComponentParamEdit(document.snapshot, components, handle, patch), null);
  }
  assert.equal(prepareComponentParamEdit(document.snapshot, components, handle, () => { throw new Error('abort'); }), null);
  assert.equal(prepareComponentParamEdit(document.snapshot, components, 'retired' as OccurrenceHandle, { code: 'new' }), null);
  const reference = setup(source.replace('code:"return 1"', 'code: sharedCode'));
  assert.equal(prepareComponentParamEdit(reference.document.snapshot, components, reference.handle, { code: 'new' }), null);
  assert.equal(document.snapshot.source, source);
});

test('defaults and empty patches are no-ops; multiline content and literal arrays round-trip together', () => {
  const { document, handle } = setup(source.replace('highlightedLines: [] ', ''));
  const patches: ParamPatch[] = [{}, { highlightedLines: [] }];
  for (const patch of patches) {
    const result = prepareComponentParamEdit(document.snapshot, components, handle, patch)!;
    assert.equal(result.newSource, document.snapshot.source);
    assert.deepEqual(result.changes, []);
  }
  const result = prepareComponentParamEdit(document.snapshot, components, handle, { code: 'def f():\n    return "<>&🙂"\n', highlightedLines: [1, 2] })!;
  assert.ok(result);
  assert.deepEqual(lines(result.ast, 0), [1, 2]);
  const edited = new DeckDocument(result.newSource, 'edited.sw').snapshot.occurrences.find(item => item.component.name === 'CodeDisplay')!.component;
  const code = edited.fills.find(fill => fill.name === 'code')!.value;
  assert.equal(code.kind === 'string' ? code.value : undefined, 'def f():\n    return "<>&🙂"\n');
  assert.ok(result.changes.length);
});

test('terminal transcript uses the same generic command', () => {
  const { document } = setup();
  const terminal = document.snapshot.occurrences.find(item => item.component.name === 'TerminalDisplay')!;
  const result = prepareComponentParamEdit(frame(document.snapshot), components, terminal.handle, { content: '>>> custom()\n\n42' })!;
  assert.ok(result);
  assert.ok(result.newSource.includes('custom()'));
});
