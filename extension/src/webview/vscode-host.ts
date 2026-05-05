// VSCodeHost — the Slidewright canvas Host implementation that runs
// inside a VS Code webview.
//
// Source updates arrive via webview postMessage from the extension
// (see extension/src/canvas.ts → SlidewrightCanvasPanel.pushSource).
// Asset URIs are computed extension-side via webview.asWebviewUri().
//
// Lifecycle:
//   - constructor attaches a window 'message' listener
//   - subscribe(cb) stores cb and posts {type: 'ready'} so the
//     extension knows it can push the initial source
//   - the listener forwards source-updated messages to the cb

import type { Host, HostState } from '../../../slidewright/canvas/host.js';

interface SourceUpdatedMessage {
  type: 'source-updated';
  source: string;
  fileName: string;
  assets: Record<string, string>;
}

type ExtensionToWebview = SourceUpdatedMessage;

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export class VSCodeHost implements Host {
  private readonly vscode = acquireVsCodeApi();
  private subscribers = new Set<(state: HostState) => void>();

  constructor() {
    window.addEventListener('message', this.onMessage);
  }

  subscribe(callback: (state: HostState) => void): () => void {
    this.subscribers.add(callback);
    if (this.subscribers.size === 1) {
      // First subscriber — tell the extension we're ready for the
      // initial push. Without this handshake the extension's first
      // postMessage races the webview script load and gets dropped.
      this.vscode.postMessage({ type: 'ready' });
    }
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private onMessage = (event: MessageEvent<ExtensionToWebview>): void => {
    const message = event.data;
    if (message?.type !== 'source-updated') return;
    const state: HostState = {
      source: message.source,
      fileName: message.fileName,
      assets: message.assets,
    };
    for (const cb of this.subscribers) cb(state);
  };
}
