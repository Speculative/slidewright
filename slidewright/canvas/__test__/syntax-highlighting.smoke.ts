import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

import { slidewrightLanguage } from '../sw-language.js';

const source = `Deck {
  slides: [
    TitleSlide {
      title: "Hello"
      accent: oklch(0.7 0.2 240)
      enabled: true
      body: """A
        multiline string"""
    }
  ]
  notes: "ok"
  // line comment
  /* block
     comment */
}`;

const state = EditorState.create({
  doc: source,
  extensions: [slidewrightLanguage.extension],
});
const treeText = syntaxTree(state).toString();

for (const token of [
  'typeName',
  'propertyName',
  'string',
  'atom',
  'bool',
  'lineComment',
  'blockComment',
]) {
  assert.match(treeText, new RegExp(`\\b${token}\\b`), `missing ${token}`);
}

// A closed multiline string must not leak its style into the following
// component punctuation.
assert.equal(treeText.endsWith('blockComment,punctuation)'), true);

console.log('Slidewright CodeMirror syntax highlighting smoke test passed.');
