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
//     Standalone also implements the optional editor-pane API
//     (setSource / onSelection / setCursor) so the v0.1f source
//     pane can sit next to the canvas.
//
// API surfaces:
//   - Canvas-facing (always implemented):
//       subscribe, sendSelection, onCursorChange?
//   - Editor-pane-facing (optional; only hosts that have a
//     co-located editor surface implement them):
//       setSource, onSelection, setCursor
//
// Future:
//   - VSCodeHost will gain setSource when v0.2 gestures land — it'll
//     post upstream so the extension can apply a WorkspaceEdit.
//     onSelection / setCursor probably stay no-ops there since VS
//     Code's editor is the canonical surface and the webview never
//     needs to drive it programmatically beyond what sendSelection
//     already does.

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
  // ── Canvas-facing API ───────────────────────────────────────────────

  // Subscribe to host-state updates. The host fires the callback once
  // immediately with the current state (or as soon as the state is
  // available — VSCodeHost posts a `ready` to the extension and waits
  // for the response), and again whenever the state changes. Returns
  // an unsubscribe function.
  subscribe(callback: (state: HostState) => void): () => void;

  // Sent by the canvas when the user clicks something in the rendered
  // slide. The host translates the source-range to whatever its
  // editor surface uses (revealRange + setSelection in VS Code, a
  // textarea selection in the standalone source pane, etc.).
  sendSelection(range: SourceRange): void;

  // Subscribe to source-editor cursor changes. Lets the canvas
  // highlight (or select) whatever rendered element corresponds to
  // the cursor's current source position. Optional — hosts without
  // an editor surface can omit it.
  onCursorChange?(callback: (offset: number) => void): () => void;

  // ── Editor-pane-facing API (optional) ───────────────────────────────

  // Replace the current source. Fires `subscribe` callbacks so the
  // canvas re-renders. Only implemented by hosts whose editor surface
  // can write back to source — used by the v0.1f standalone pane
  // and (eventually) by VSCodeHost when v0.2 gestures emit edits.
  setSource?(source: string): void;

  // Subscribe to selection-set events that originated from the
  // canvas (the receiving end of `sendSelection`). Used by an
  // external editor pane to mirror canvas clicks into its own
  // selection. VSCodeHost doesn't implement this since VS Code's
  // editor handles its own selection — `sendSelection` flows
  // through the extension's revealRange instead.
  onSelection?(callback: (range: SourceRange) => void): () => void;

  // Notify the host that an external editor's caret moved. Drives
  // `onCursorChange` subscribers (typically the canvas, which
  // updates the active slide).
  setCursor?(offset: number): void;
}
