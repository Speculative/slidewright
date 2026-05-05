// Slidewright canvas — Host interface.
//
// The canvas (slidewright/canvas/App.tsx) is host-agnostic. A Host
// supplies the source-of-truth for the .sw being rendered and any
// asset URIs that depend on the runtime environment. Two adapters
// implement this interface today:
//
//   - VSCodeHost (extension/src/webview/vscode-host.ts) — talks to
//     the extension via postMessage. Asset URIs come from
//     webview.asWebviewUri().
//   - StandaloneHost (src/standalone-host.ts) — runs in a normal
//     browser. Asset URIs come from Vite's static asset imports.
//
// Future:
//   - writeSource: (newSource: string) => Promise<void> when v0.2
//     gestures land. VSCodeHost posts to the extension which writes
//     via WorkspaceEdit; StandaloneHost holds the new source in
//     memory (or, optionally, writes via the File System Access API
//     or a Vite dev-server endpoint).

export interface HostState {
  source: string;
  fileName: string;
  // Map of name → URL string. The canvas merges these into the deck
  // scope so DSL name-references like `headshotImg` resolve.
  assets: Record<string, string>;
}

export interface Host {
  // Subscribe to host-state updates. The host fires the callback once
  // immediately with the current state (or as soon as the state is
  // available — VSCodeHost posts a `ready` to the extension and waits
  // for the response), and again whenever the state changes. Returns
  // an unsubscribe function.
  subscribe(callback: (state: HostState) => void): () => void;
}
