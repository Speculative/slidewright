// StandaloneHost — the Slidewright canvas Host implementation that
// runs in a normal browser via Vite (not inside a VS Code webview).
//
// Source-of-truth lives in this host's internal state. Edits arrive
// from two paths:
//   - Vite HMR fires when decks/v0-reference/deck.sw changes on disk
//     (so saving the file in any external editor refreshes the
//     canvas without a page reload).
//   - The standalone source pane (v0.1f) calls setSource on each
//     keystroke, which flows back to the canvas via subscribe
//     callbacks.
//
// The host is also the message bus between the canvas and the
// editor pane — sendSelection (canvas → pane) and setCursor
// (pane → canvas) wire up bidirectional selection sync.
//
// HARDCODED FOR v0-REFERENCE: same as the webview path — the deck
// imports are baked in. Generalizing to "any deck" is v0.2 territory.

import deckSourceInitial from '../decks/v0-reference/deck.sw?raw';
import headshotImg from '../decks/v0-reference/headshot.jpg';
import type {
  Host,
  HostState,
  SourceRange,
} from '../slidewright/canvas/host.js';

const FILE_NAME = 'decks/v0-reference/deck.sw';

export class StandaloneHost implements Host {
  private state: HostState = {
    source: deckSourceInitial,
    fileName: FILE_NAME,
    assets: { headshotImg },
  };
  private stateSubscribers = new Set<(state: HostState) => void>();
  private cursorSubscribers = new Set<(offset: number) => void>();
  private selectionSubscribers = new Set<(range: SourceRange) => void>();

  constructor() {
    // Vite HMR: hot-update the canvas when deck.sw changes on disk
    // without forcing a full page refresh. Without this hook the
    // standalone would only see source changes after a manual reload.
    if (import.meta.hot) {
      import.meta.hot.accept('../decks/v0-reference/deck.sw?raw', (mod) => {
        const next = (mod as unknown as { default?: unknown })?.default;
        if (typeof next === 'string') {
          this.setSource(next);
        }
      });
    }
  }

  // ── Canvas-facing ──────────────────────────────────────────────────

  subscribe(callback: (state: HostState) => void): () => void {
    this.stateSubscribers.add(callback);
    callback(this.state);
    return () => {
      this.stateSubscribers.delete(callback);
    };
  }

  sendSelection(range: SourceRange): void {
    for (const cb of this.selectionSubscribers) cb(range);
  }

  onCursorChange(callback: (offset: number) => void): () => void {
    this.cursorSubscribers.add(callback);
    return () => {
      this.cursorSubscribers.delete(callback);
    };
  }

  // ── Editor-pane-facing ─────────────────────────────────────────────

  setSource(source: string): void {
    if (source === this.state.source) return;
    this.state = { ...this.state, source };
    for (const cb of this.stateSubscribers) cb(this.state);
  }

  onSelection(callback: (range: SourceRange) => void): () => void {
    this.selectionSubscribers.add(callback);
    return () => {
      this.selectionSubscribers.delete(callback);
    };
  }

  setCursor(offset: number): void {
    for (const cb of this.cursorSubscribers) cb(offset);
  }
}
