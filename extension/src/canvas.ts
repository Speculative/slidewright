// Slidewright canvas — VS Code webview panel that renders the .sw
// document beside the source editor.
//
// v0.1a (this slice): one panel per .sw document, plain text passthrough.
//   - createOrShow keys panels by document URI so re-running the command
//     focuses the existing panel rather than creating duplicates.
//   - Source updates are pushed via webview.postMessage; the webview
//     bundle (extension/src/webview/index.ts) consumes them.
// v0.1b/c will replace the plain-text body with the slidewright runtime
// and renderer; v0.1d adds selection-sync messages in both directions.

import * as vscode from 'vscode';

interface SourceUpdatedMessage {
  type: 'source-updated';
  source: string;
  fileName: string;
}

interface WebviewReadyMessage {
  type: 'ready';
}

type ExtensionToWebview = SourceUpdatedMessage;
type WebviewToExtension = WebviewReadyMessage;

export class SlidewrightCanvasPanel {
  // One panel per source document URI. Reusing keeps the experience
  // sane when the user runs the open-canvas command multiple times.
  private static readonly panels = new Map<string, SlidewrightCanvasPanel>();

  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
  ): SlidewrightCanvasPanel {
    const key = document.uri.toString();
    const existing = SlidewrightCanvasPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      'slidewright.canvas',
      `Slidewright: ${document.fileName.split('/').pop() ?? 'canvas'}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
        ],
      },
    );

    const instance = new SlidewrightCanvasPanel(panel, context, document);
    SlidewrightCanvasPanel.panels.set(key, instance);
    return instance;
  }

  static forDocument(document: vscode.TextDocument): SlidewrightCanvasPanel | undefined {
    return SlidewrightCanvasPanel.panels.get(document.uri.toString());
  }

  // The panel is always associated with one specific .sw document (panels
  // are keyed by document URI). The TextDocument reference is live —
  // .getText() always reflects current contents — so we don't need to
  // re-pass it on every update.
  private readonly document: vscode.TextDocument;
  private webviewReady = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
  ) {
    this.document = document;
    this.panel.webview.html = renderHtml(this.panel.webview, context.extensionUri);

    // Wait for the webview's script to attach its message listener
    // before pushing the initial source. Without this handshake the
    // initial postMessage races the script load and gets dropped.
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToExtension) => {
        if (message?.type === 'ready') {
          this.webviewReady = true;
          this.pushSource();
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // Called externally (extension.ts) when the document changes. Safe to
  // call before the webview is ready — pushSource reads current contents
  // when the ready handshake completes.
  update(): void {
    this.pushSource();
  }

  private pushSource(): void {
    if (!this.webviewReady) return;
    const message: ExtensionToWebview = {
      type: 'source-updated',
      source: this.document.getText(),
      fileName: this.document.fileName,
    };
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    SlidewrightCanvasPanel.panels.delete(this.document.uri.toString());
    while (this.disposables.length > 0) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'),
  );
  // CSP locks down what the webview can load. We allow only our own
  // bundle (script-src) and inline styles (style-src 'unsafe-inline'
  // — VS Code's default theme injects them and the webview gets them
  // automatically; tighten later if needed).
  const nonce = makeNonce();
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           img-src ${webview.cspSource} data:;
           style-src ${webview.cspSource} 'unsafe-inline';
           script-src 'nonce-${nonce}';" />
<title>Slidewright canvas</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }
  #status {
    padding: 8px 16px;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    font-size: 12px;
    opacity: 0.7;
  }
  #diagnostics {
    margin: 0;
    padding: 12px 16px;
    white-space: pre-wrap;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    line-height: 1.5;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
  }
  #diagnostics[data-severity="error"] {
    color: var(--vscode-errorForeground, #f14c4c);
  }
  #diagnostics[data-severity="warning"] {
    color: var(--vscode-editorWarning-foreground, #cca700);
  }
  #ast {
    margin: 0;
    padding: 16px;
    white-space: pre;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    line-height: 1.5;
    overflow: auto;
  }
</style>
</head>
<body>
<div id="status">waiting for source…</div>
<pre id="diagnostics" hidden></pre>
<pre id="ast"></pre>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
