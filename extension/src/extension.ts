// Slidewright VS Code extension — entry point.
//
// v0.1 scope per SLIDEWRIGHT.md / v0 sequencing: scaffold + read-only
// canvas + selection sync + file-watcher reparse. This file wires:
//   - the slidewright.openCanvas command (creates/focuses a panel
//     beside the active .sw editor),
//   - a document-change subscription that pushes source updates to any
//     open canvas panel.
// Webview rendering itself lives in canvas.ts (extension-side panel
// management) and src/webview/index.ts (webview bundle).

import * as vscode from 'vscode';
import { SlidewrightCanvasPanel } from './canvas.js';

const SW_LANG_ID = 'slidewright';
const SW_EXT = '.sw';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('slidewright.openCanvas', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(
          'Slidewright: no active editor — open a .sw file first.',
        );
        return;
      }
      if (!isSlidewrightDocument(editor.document)) {
        vscode.window.showWarningMessage(
          'Slidewright: the active file is not a .sw document.',
        );
        return;
      }
      SlidewrightCanvasPanel.createOrShow(context, editor.document);
    }),
  );

  // Push source updates to any open canvas panel when the underlying
  // document changes. Cheap (we just postMessage); the webview decides
  // how to consume.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!isSlidewrightDocument(event.document)) return;
      const panel = SlidewrightCanvasPanel.forDocument(event.document);
      if (panel) panel.update();
    }),
  );

  // eslint-disable-next-line no-console
  console.log('Slidewright extension activated.');
}

export function deactivate(): void {
  // No global resources to clean up; per-panel disposal is wired via
  // panel.onDidDispose in canvas.ts.
}

function isSlidewrightDocument(doc: vscode.TextDocument): boolean {
  return doc.languageId === SW_LANG_ID || doc.fileName.endsWith(SW_EXT);
}
