// Slidewright canvas — Host interface.
//
// The canvas (slidewright/canvas/App.tsx) is host-agnostic. A Host
// supplies the source-of-truth for the .sw being rendered, asset URIs
// that depend on the runtime environment, and the bidirectional
// selection-sync channel between the canvas and an external source
// editor.
//
// Two adapters implement this interface today:
//   - VSCodeHost (extension/src/webview/vscode-host.ts) — talks to
//     the extension via postMessage. Asset URIs come from
//     webview.asWebviewUri(). Selection sync routes through
//     vscode.window.activeTextEditor.
//   - StandaloneHost (src/standalone-host.ts) — runs in a normal
//     browser. Asset URIs come from Vite's static asset imports.
//     Selection sync is a no-op until v0.1f's standalone source
//     editor pane lands; the interface lets us wire it later
//     without changing the canvas.
//
// Future:
//   - writeSource: (newSource: string) => Promise<void> when v0.2
//     gestures land. VSCodeHost will post to the extension which
//     applies a WorkspaceEdit; StandaloneHost will hold the new
//     source in memory (or, optionally, write via the File System
//     Access API or a Vite dev-server endpoint).

export interface HostState {
  source: string;
  fileName: string;
  // Map of name → URL string. The canvas merges these into the deck
  // scope so DSL name-references like `headshotImg` resolve.
  assets: Record<string, string>;
}

export interface SourceRange {
  start: number; // 0-based byte/char offset, inclusive
  end: number;   // 0-based byte/char offset, exclusive
}

export interface Host {
  // Subscribe to host-state updates. The host fires the callback once
  // immediately with the current state (or as soon as the state is
  // available — VSCodeHost posts a `ready` to the extension and waits
  // for the response), and again whenever the state changes. Returns
  // an unsubscribe function.
  subscribe(callback: (state: HostState) => void): () => void;

  // Sent by the canvas when the user clicks something in the rendered
  // slide. The host translates the source-range to whatever its
  // editor surface uses (revealRange + setSelection in VS Code,
  // a textarea selection in v0.1f's standalone editor, etc.).
  sendSelection(range: SourceRange): void;

  // Subscribe to source-editor cursor changes. Lets the canvas
  // highlight (or select) whatever rendered element corresponds to
  // the cursor's current source position. Optional — hosts without
  // an editor surface (StandaloneHost in v0.1e) can omit it.
  onCursorChange?(callback: (offset: number) => void): () => void;
}
