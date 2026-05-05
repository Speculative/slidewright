// Slidewright canvas — webview-side bundle.
//
// v0.1a (this slice): plain text passthrough — receive source-updated
// messages from the extension and render the source as-is in a <pre>.
// React + slidewright runtime lands once we tackle deck-loading
// (v0.1c).

interface SourceUpdatedMessage {
  type: 'source-updated';
  source: string;
  fileName: string;
}

type ExtensionToWebview = SourceUpdatedMessage;

// `acquireVsCodeApi` is injected by the webview host. Cache the handle
// so future slices that need to postMessage back can reuse it.
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const vscode = acquireVsCodeApi();

const statusEl = document.getElementById('status');
const source = document.getElementById('source');
if (!statusEl || !source) {
  throw new Error('Slidewright canvas: required DOM nodes are missing.');
}

window.addEventListener('message', (event: MessageEvent<ExtensionToWebview>) => {
  const message = event.data;
  if (message?.type === 'source-updated') {
    statusEl.textContent = message.fileName;
    source.textContent = message.source;
  }
});

// Tell the extension we're ready for the initial source push. Without
// this handshake, the extension's first postMessage races the webview
// script's load and the message gets dropped.
vscode.postMessage({ type: 'ready' });
