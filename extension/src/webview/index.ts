// Slidewright canvas — webview-side bundle.
//
// v0.1b (this slice): parse the .sw source on each update, render the
// AST as JSON pretty-print plus any diagnostics. Debug view; the
// rendered-slides canvas (v0.1c) replaces this surface but reuses the
// same parser-in-webview wiring.

import { parse } from '../../../slidewright/runtime/parser.js';
import { formatDiagnostic } from '../../../slidewright/runtime/diagnostics.js';

interface SourceUpdatedMessage {
  type: 'source-updated';
  source: string;
  fileName: string;
}

type ExtensionToWebview = SourceUpdatedMessage;

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const vscode = acquireVsCodeApi();

const statusEl = document.getElementById('status');
const diagnosticsEl = document.getElementById('diagnostics');
const astEl = document.getElementById('ast');
if (!statusEl || !diagnosticsEl || !astEl) {
  throw new Error('Slidewright canvas: required DOM nodes are missing.');
}

window.addEventListener('message', (event: MessageEvent<ExtensionToWebview>) => {
  const message = event.data;
  if (message?.type === 'source-updated') {
    statusEl.textContent = message.fileName;
    renderParse(message.source, message.fileName);
  }
});

vscode.postMessage({ type: 'ready' });

function renderParse(source: string, fileName: string): void {
  const { ast, diagnostics } = parse(source, fileName);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity !== 'error');

  if (diagnostics.length === 0) {
    diagnosticsEl!.textContent = '';
    diagnosticsEl!.hidden = true;
  } else {
    diagnosticsEl!.hidden = false;
    diagnosticsEl!.textContent = diagnostics.map(formatDiagnostic).join('\n');
    diagnosticsEl!.dataset.severity = errors.length > 0 ? 'error' : 'warning';
    void warnings; // surfaced via the count + classification above
  }

  astEl!.textContent = JSON.stringify(ast, replacer, 2);
}

// Drop the verbose `span` field from AST nodes when serializing — it
// quadruples the output and isn't useful in this debug view. (We keep
// the field on the AST itself; the editor and renderer will need it.)
function replacer(key: string, value: unknown): unknown {
  if (key === 'span') return undefined;
  return value;
}
