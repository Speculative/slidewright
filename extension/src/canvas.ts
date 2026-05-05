// Slidewright canvas — VS Code webview panel that renders the .sw
// document beside the source editor.
//
// Per-document panel:
//   - createOrShow keys panels by document URI so re-running the
//     command focuses the existing panel rather than creating duplicates.
//   - Source updates are pushed via webview.postMessage; the webview
//     bundle (extension/src/webview/index.tsx) renders them.
//   - Selection sync (v0.1e) flows in both directions:
//     * canvas-side click → webview posts `select-source-range` →
//       extension reveals + selects that range in the .sw editor
//     * editor cursor moves → extension posts `cursor-changed` →
//       webview shifts active slide to match.

import * as vscode from 'vscode';

interface SourceUpdatedMessage {
  type: 'source-updated';
  source: string;
  fileName: string;
  // Asset URIs computed by the extension via webview.asWebviewUri(),
  // mapped by deck-scope binding name. The webview merges these into
  // the deck scope so name-references in the DSL (e.g. `headshotImg`)
  // resolve to webview-loadable URLs. v0.1c hardcodes the v0-reference
  // deck's asset list (just headshot.jpg); v0.2's on-the-fly deck
  // loader will discover assets dynamically.
  assets: Record<string, string>;
}

interface CursorChangedMessage {
  type: 'cursor-changed';
  offset: number;
}

interface WebviewReadyMessage {
  type: 'ready';
}

interface SelectSourceRangeMessage {
  type: 'select-source-range';
  start: number;
  end: number;
}

interface SetSourceMessage {
  type: 'set-source';
  source: string;
}

type ExtensionToWebview = SourceUpdatedMessage | CursorChangedMessage;
type WebviewToExtension =
  | WebviewReadyMessage
  | SelectSourceRangeMessage
  | SetSourceMessage;

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

    const localResourceRoots: vscode.Uri[] = [
      vscode.Uri.joinPath(context.extensionUri, 'dist'),
    ];
    // Allow the webview to load assets from the workspace folder
    // (deck assets, the existing src/styles.css). Scoped to one folder
    // for v0.1c; tighten later if multi-root workspaces matter.
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder) {
      localResourceRoots.push(workspaceFolder.uri);
    }

    const panel = vscode.window.createWebviewPanel(
      'slidewright.canvas',
      `Slidewright: ${document.fileName.split('/').pop() ?? 'canvas'}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots,
      },
    );

    const instance = new SlidewrightCanvasPanel(
      panel,
      context,
      document,
      workspaceFolder?.uri,
    );
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
  private readonly workspaceUri: vscode.Uri | undefined;
  private webviewReady = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    workspaceUri: vscode.Uri | undefined,
  ) {
    this.document = document;
    this.workspaceUri = workspaceUri;
    this.panel.webview.html = renderHtml(
      this.panel.webview,
      context.extensionUri,
      workspaceUri,
    );

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToExtension) => {
        if (message?.type === 'ready') {
          this.webviewReady = true;
          this.pushSource();
        } else if (message?.type === 'select-source-range') {
          this.revealSourceRange(message.start, message.end);
        } else if (message?.type === 'set-source') {
          void this.applySource(message.source);
        }
      },
      null,
      this.disposables,
    );

    // Push the editor's cursor position to the webview whenever it
    // moves on this document. Lets the canvas highlight the slide that
    // contains the source caret (v0.1e Phase 2). Filtered by URI so
    // selections in other open editors don't drive this panel.
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor.document.uri.toString() !== this.document.uri.toString()) {
          return;
        }
        const offset = event.textEditor.document.offsetAt(
          event.textEditor.selection.active,
        );
        this.pushCursor(offset);
      }),
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  // Apply a canvas-emitted source string to the document. v0.2 first
  // gestures (text edit) replace the whole document with the new
  // source via WorkspaceEdit; once round-trip emit lands and we can
  // compute minimal diffs we'll narrow this to the specific edited
  // range. Whole-document replace is fine for v0.2 — the document
  // change fires onDidChangeTextDocument → existing pushSource path
  // → webview re-renders.
  private async applySource(source: string): Promise<void> {
    if (source === this.document.getText()) return;
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      this.document.positionAt(0),
      this.document.positionAt(this.document.getText().length),
    );
    edit.replace(this.document.uri, fullRange, source);
    await vscode.workspace.applyEdit(edit);
  }

  // Reveal the given source range in the editor showing this panel's
  // document, opening it if it's not currently visible. The selection
  // is placed *inside* the range start so the caret lands at the
  // beginning of the matching component invocation rather than
  // sweeping across it (less disruptive when the user is in the
  // middle of typing somewhere else).
  private async revealSourceRange(start: number, end: number): Promise<void> {
    void end;
    const startPos = this.document.positionAt(start);
    const editor = await vscode.window.showTextDocument(this.document, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: true,
      preview: false,
    });
    editor.selection = new vscode.Selection(startPos, startPos);
    editor.revealRange(
      new vscode.Range(startPos, startPos),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
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
      assets: this.computeAssets(),
    };
    void this.panel.webview.postMessage(message);
  }

  private pushCursor(offset: number): void {
    if (!this.webviewReady) return;
    const message: ExtensionToWebview = {
      type: 'cursor-changed',
      offset,
    };
    void this.panel.webview.postMessage(message);
  }

  // v0.1c: hardcoded asset map for the v0-reference deck. The webview
  // merges these URIs into the deck scope so DSL name-references
  // resolve to webview-loadable URLs. Generalizing this requires the
  // on-the-fly deck loader (v0.2).
  private computeAssets(): Record<string, string> {
    if (!this.workspaceUri) return {};
    const headshotUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.workspaceUri, 'decks/v0-reference/headshot.jpg'),
    );
    return {
      headshotImg: headshotUri.toString(),
    };
  }

  private dispose(): void {
    SlidewrightCanvasPanel.panels.delete(this.document.uri.toString());
    while (this.disposables.length > 0) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

function renderHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  workspaceUri: vscode.Uri | undefined,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'),
  );
  // The deck's slide chrome and typography come from the existing
  // scaffold's stylesheet at src/styles.css. The canvas-around-the-
  // slide UI (status bar, diagnostics, presentation positioning) lives
  // in slidewright/canvas/canvas.css — shared between this webview
  // host and the standalone web host.
  const stylesUri = workspaceUri
    ? webview.asWebviewUri(vscode.Uri.joinPath(workspaceUri, 'src/styles.css'))
    : null;
  const canvasCssUri = workspaceUri
    ? webview.asWebviewUri(
        vscode.Uri.joinPath(workspaceUri, 'slidewright/canvas/canvas.css'),
      )
    : null;

  const nonce = makeNonce();
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           img-src ${webview.cspSource} data: blob:;
           font-src ${webview.cspSource} https://fonts.gstatic.com;
           style-src ${webview.cspSource} https://fonts.googleapis.com 'unsafe-inline';
           script-src 'nonce-${nonce}';" />
<title>Slidewright canvas</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Arvo:wght@400;700&family=Lato:wght@400;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
${stylesUri ? `<link rel="stylesheet" href="${stylesUri}" />` : ''}
${canvasCssUri ? `<link rel="stylesheet" href="${canvasCssUri}" />` : ''}
</head>
<body>
<div id="root"></div>
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
