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
import plateauSource from '../decks/plateau-2026/deck.sw?raw';
import deckSourceInitial from '../decks/v0-reference/deck.sw?raw';
import headshotImg from '../decks/v0-reference/headshot.jpg';
import type {
  Host,
  HostState,
  SourceRange,
} from '../slidewright/canvas/host.js';

const plateauAssetModules = import.meta.glob('../decks/plateau-2026/assets/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const plateauAssetNames: Record<string, string> = { 'headshot.jpg': 'plateauHeadshot', 'penn-hci.svg': 'plateauPennHci', 'js_console.png': 'plateauConsole', 'pandas.png': 'plateauPandas', 'stack_trace.mp4': 'plateauStackTrace', 'streams.mp4': 'plateauStreams', 'stepping.mp4': 'plateauStepping', 'computed.mp4': 'plateauComputed', 'agg_filter.mp4': 'plateauFiltering' };
const plateauAssets = Object.fromEntries(Object.entries(plateauAssetModules).map(([path, url]) => [plateauAssetNames[path.split('/').at(-1)!]!, url]));
const FILE_NAME = 'decks/v0-reference/deck.sw';

// Test-fixture loading. Glob-imports every .sw file under
// tests/fixtures/ at build time, keyed by basename without
// extension. The standalone-host reads `?fixture=<name>` from the
// URL and (if it matches) replaces the default deck source with
// the fixture before any subscribers see it. Falls back silently
// to the default deck for non-fixture URLs and unknown names.
//
// Why glob-import vs runtime fetch: cheaper (no extra round-trip,
// no async loading state to thread through), no Vite middleware
// needed, and the fixtures show up as build artifacts so a typo
// in the test fails at build time rather than at runtime.
const fixtureModules = import.meta.glob('../tests/fixtures/*.sw', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const fixtures: Record<string, string> = {};
for (const [path, source] of Object.entries(fixtureModules)) {
  const match = path.match(/\/([^/]+)\.sw$/);
  if (match && match[1]) fixtures[match[1]] = source;
}

export type DeckChoice = 'reference' | 'plateau' | 'custom';
const builtins = {
  reference: { source: deckSourceInitial, fileName: FILE_NAME },
  plateau: { source: plateauSource, fileName: 'decks/plateau-2026/deck.sw' },
};
interface Draft { source: string; fileName: string }
function draftKey(deck: DeckChoice): string { return `slidewright:standalone:draft:v1:${deck}`; }
function readDraft(deck: DeckChoice): Draft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(deck)) ?? 'null') as Draft | null;
    return draft && typeof draft.source === 'string' && typeof draft.fileName === 'string' ? draft : null;
  } catch { return null; }
}

export class StandaloneHost implements Host {
  private state: HostState;
  private stateSubscribers = new Set<(state: HostState) => void>();
  private cursorSubscribers = new Set<(offset: number) => void>();
  private selectionSubscribers = new Set<(range: SourceRange) => void>();

  private choice: DeckChoice = 'reference';
  private fixture = false;
  persistenceAvailable = true;
  private custom: Draft | null = null;
  get deckChoice(): DeckChoice { return this.choice; }
  get fileName(): string { return this.state.fileName; }
  get source(): string { return this.state.source; }
  get hasCustomDeck(): boolean { return !!this.custom || !!readDraft('custom'); }

  constructor() {
    const query = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    const fixture = query.get('fixture');
    this.fixture = !!fixture && !!fixtures[fixture];
    this.choice = query.get('deck') === 'plateau' ? 'plateau' : query.get('deck') === 'custom' && readDraft('custom') ? 'custom' : 'reference';
    const initial = this.fixture ? { source: fixtures[fixture!]!, fileName: `tests/fixtures/${fixture}.sw` } : readDraft(this.choice) ?? builtins[this.choice === 'custom' ? 'reference' : this.choice];
    this.state = { ...initial, assets: { headshotImg, ...plateauAssets } };
    if (import.meta.hot) {
      import.meta.hot.accept('../decks/v0-reference/deck.sw?raw', mod => {
        if (!this.fixture && this.choice === 'reference' && mod) this.setSource(mod.default);
      });
      import.meta.hot.accept('../decks/plateau-2026/deck.sw?raw', mod => {
        if (!this.fixture && this.choice === 'plateau' && mod) this.setSource(mod.default);
      });
    }
  }

  private persist(): void {
    if (this.fixture) return;
    try { localStorage.setItem(draftKey(this.choice), JSON.stringify({ source: this.state.source, fileName: this.state.fileName })); this.persistenceAvailable = true; }
    catch { this.persistenceAvailable = false; }
    if (this.choice === 'custom') this.custom = { source: this.state.source, fileName: this.state.fileName };
  }
  private publish(): void { for (const cb of this.stateSubscribers) cb(this.state); }
  private updateURL(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('fixture'); url.searchParams.set('deck', this.choice);
    window.history.replaceState(null, '', url);
  }
  switchDeck(choice: DeckChoice): void {
    const next = readDraft(choice) ?? (choice === 'custom' ? this.custom : builtins[choice]);
    if (!next) return;
    this.fixture = false; this.choice = choice;
    this.state = { ...this.state, ...next };
    this.updateURL(); this.publish();
  }
  openSource(source: string, fileName: string): void {
    this.fixture = false; this.choice = 'custom';
    this.state = { ...this.state, source, fileName };
    this.persist(); this.updateURL(); this.publish();
  }
  saveDraft(): boolean { this.persist(); this.publish(); return this.persistenceAvailable; }


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
    this.persist(); this.publish();
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
