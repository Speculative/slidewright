// StandaloneHost — the Slidewright canvas Host implementation that
// runs in a normal browser via Vite (not inside a VS Code webview).
//
// Source-of-truth lives in this host's internal state. v0.1 reads it
// once at module load via Vite's `?raw` import and registers an HMR
// hook so editing decks/v0-reference/deck.sw on disk hot-updates the
// canvas without a page refresh. v0.2 will gain a writeSource API
// (gestures emit a new source string) — at that point the in-memory
// state becomes the authoritative source until a persistence path
// (FS Access API or a Vite dev-server endpoint) is wired in.
//
// HARDCODED FOR v0-REFERENCE: same as the webview path — the deck
// imports are baked in. Generalizing to "any deck" is v0.2 territory.

import deckSourceInitial from '../decks/v0-reference/deck.sw?raw';
import headshotImg from '../decks/v0-reference/headshot.jpg';
import type { Host, HostState } from '../slidewright/canvas/host.js';

const FILE_NAME = 'decks/v0-reference/deck.sw';

export class StandaloneHost implements Host {
  private state: HostState = {
    source: deckSourceInitial,
    fileName: FILE_NAME,
    assets: { headshotImg },
  };
  private subscribers = new Set<(state: HostState) => void>();

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

  subscribe(callback: (state: HostState) => void): () => void {
    this.subscribers.add(callback);
    // Fire immediately with current state — synchronous since the
    // initial source is available from the static import.
    callback(this.state);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  // v0.2 hook: gestures will call this with the emitted source string.
  // For now it's used by the HMR hot-update path.
  private setSource(source: string): void {
    this.state = { ...this.state, source };
    for (const cb of this.subscribers) cb(this.state);
  }
}
