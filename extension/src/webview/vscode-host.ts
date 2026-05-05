// VSCodeHost — the Slidewright canvas Host implementation that runs
// inside a VS Code webview.
//
// Source updates arrive via webview postMessage from the extension
// (see extension/src/canvas.ts → SlidewrightCanvasPanel.pushSource).
// Asset URIs are computed extension-side via webview.asWebviewUri().
// Selection sync (v0.1e) flows in both directions: clicks in the
// canvas post `select-source-range` upstream so the extension can
// reveal + select that range in the .sw editor, and editor-side
// cursor changes arrive as `cursor-changed` messages so the canvas
// can highlight the matching slide.

import type { Host, HostState, SourceRange } from '../../../slidewright/canvas/host.js';

interface SourceUpdatedMessage {
  type: 'source-updated';
  source: string;
  fileName: string;
  assets: Record<string, string>;
}

interface CursorChangedMessage {
  type: 'cursor-changed';
  offset: number;
}

type ExtensionToWebview = SourceUpdatedMessage | CursorChangedMessage;

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export class VSCodeHost implements Host {
  private readonly vscode = acquireVsCodeApi();
  private stateSubscribers = new Set<(state: HostState) => void>();
  private cursorSubscribers = new Set<(offset: number) => void>();

  constructor() {
    window.addEventListener('message', this.onMessage);
  }

  subscribe(callback: (state: HostState) => void): () => void {
    this.stateSubscribers.add(callback);
    if (
      this.stateSubscribers.size === 1 &&
      this.cursorSubscribers.size === 0
    ) {
      // First subscriber — tell the extension we're ready for the
      // initial push. Without this handshake the extension's first
      // postMessage races the webview script load and gets dropped.
      this.vscode.postMessage({ type: 'ready' });
    }
    return () => {
      this.stateSubscribers.delete(callback);
    };
  }

  sendSelection(range: SourceRange): void {
    this.vscode.postMessage({
      type: 'select-source-range',
      start: range.start,
      end: range.end,
    });
  }

  setSource(source: string): void {
    this.vscode.postMessage({ type: 'set-source', source });
  }

  onCursorChange(callback: (offset: number) => void): () => void {
    this.cursorSubscribers.add(callback);
    return () => {
      this.cursorSubscribers.delete(callback);
    };
  }

  private onMessage = (event: MessageEvent<ExtensionToWebview>): void => {
    const message = event.data;
    if (message?.type === 'source-updated') {
      const state: HostState = {
        source: message.source,
        fileName: message.fileName,
        assets: message.assets,
      };
      for (const cb of this.stateSubscribers) cb(state);
    } else if (message?.type === 'cursor-changed') {
      for (const cb of this.cursorSubscribers) cb(message.offset);
    }
  };
}
