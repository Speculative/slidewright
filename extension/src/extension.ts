// Slidewright VS Code extension — entry point.
//
// v0.1 scope per SLIDEWRIGHT.md / v0 sequencing: scaffold + read-only
// canvas + selection sync + file-watcher reparse. This file is the
// scaffold step: activates on .sw files, registers one command that
// proves activation works. Webview wiring lands in a follow-up.

import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('slidewright.openCanvas', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.endsWith('.sw')) {
        vscode.window.showWarningMessage(
          'Slidewright: open a .sw file before invoking the canvas.',
        );
        return;
      }
      vscode.window.showInformationMessage(
        `Slidewright canvas (placeholder): ${editor.document.fileName}`,
      );
    }),
  );

  // eslint-disable-next-line no-console
  console.log('Slidewright extension activated.');
}

export function deactivate(): void {
  // No-op for the scaffold; lifecycle resources will be added in
  // context.subscriptions when the canvas + watchers land.
}
