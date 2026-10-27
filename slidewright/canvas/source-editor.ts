// Explicit CodeMirror setup keeps history independently replaceable. Source
// synchronization can clear undo without recreating language/folding/view state.
import { EditorState, Compartment, Annotation, Transaction, type TransactionSpec } from '@codemirror/state';
import {
  lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap,
} from '@codemirror/view';
import {
  foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle,
  bracketMatching, foldKeymap,
} from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import type { SourceChange } from '../runtime/document.js';

export const hostSourceSync = Annotation.define<boolean>();

export function sourceEditorSetup(undo: Compartment) {
  return [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), undo.of(history()),
    foldGutter(), drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
    indentOnInput(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), bracketMatching(),
    closeBrackets(), autocompletion(), rectangularSelection(), crosshairCursor(), highlightActiveLine(),
    highlightSelectionMatches(), keymap.of([
      ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap,
      ...foldKeymap, ...completionKeymap, ...lintKeymap,
    ]),
  ];
}

// Dispatch sequentially: removal and restoration in one transaction would
// retain the existing history field. Other fields and plugins remain installed.
export function hostSourceTransactions(undo: Compartment, changes: readonly SourceChange[]): TransactionSpec[] {
  return [
    { effects: undo.reconfigure([]), annotations: hostSourceSync.of(true) },
    { effects: undo.reconfigure(history()), changes: changes.map(({ start, end, insert }) => ({ from: start, to: end, insert })),
      annotations: [hostSourceSync.of(true), Transaction.addToHistory.of(false)] },
  ];
}
