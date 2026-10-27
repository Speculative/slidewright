// StandaloneHost — the Slidewright canvas Host implementation that
// runs in a normal browser via Vite (not inside a VS Code webview).
//
// Built-in decks use revision-checked file synchronization in development.
// Static builds and imported decks use browser drafts.
//
// The host is also the message bus between the canvas and the
// editor pane — sendSelection (canvas → pane) and setCursor
// (pane → canvas) wire up bidirectional selection sync.
//
import { DeckDocument, type DocumentSourceUpdate, type DocumentUpdate } from '../slidewright/runtime/document.js';
import { SourceSync } from './source-sync.js';
import plateauDemoSource from '../decks/plateau-demo/deck.sw?raw';
import uistSource from '../decks/uist-2026/deck.sw?raw';
import deckSourceInitial from '../decks/v0-reference/deck.sw?raw';
import headshotImg from '../decks/v0-reference/headshot.jpg';
import type {
  Host,
  HostState,
  SourceRange,
} from '../slidewright/canvas/host.js';

const plateauAssetModules = import.meta.glob('../decks/uist-2026/assets/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
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

export type DeckChoice = 'reference' | 'uist-2026' | 'plateau-demo' | 'custom';
const builtins = {
  reference: { source: deckSourceInitial, fileName: FILE_NAME },
  'uist-2026': { source: uistSource, fileName: 'decks/uist-2026/deck.sw' },
  'plateau-demo': { source: plateauDemoSource, fileName: 'decks/plateau-demo/deck.sw' },
};
interface Draft { source: string; fileName: string; pending?: boolean }
function draftKey(deck: DeckChoice): string { return `slidewright:standalone:draft:v1:${deck}`; }
function readDraft(deck: DeckChoice): Draft | null {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(deck)) ?? 'null') as Draft | null;
    return draft && typeof draft.source === 'string' && typeof draft.fileName === 'string' ? draft : null;
  } catch { return null; }
}

export class StandaloneHost implements Host {
  readonly document: DeckDocument;
  private state: HostState;
  private stateSubscribers = new Set<(state: HostState) => void>();
  private cursorSubscribers = new Set<(offset: number) => void>();
  private selectionSubscribers = new Set<(range: SourceRange) => void>();

  private unsaved = false;
  private sync: SourceSync | null = null;
  private connected = false;
  private syncSubscribers = new Set<() => void>();
  private choice: DeckChoice = 'reference';
  private fixture = false;
  persistenceAvailable = true;
  private custom: Draft | null = null;
  get serverBacked(): boolean { return import.meta.env.DEV && !this.fixture && (this.choice === 'reference' || this.choice === 'uist-2026'); }
  get syncStatus() { return this.serverBacked ? this.sync?.status ?? 'connecting' : null; }
  get deckChoice(): DeckChoice { return this.choice; }
  get fileName(): string { return this.state.fileName; }
  get source(): string { return this.state.source; }
  get hasCustomDeck(): boolean { return !!this.custom || !!readDraft('custom'); }

  constructor() {
    const query = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    const fixture = query.get('fixture');
    this.fixture = !!fixture && !!fixtures[fixture];
    this.choice = query.get('deck') === 'plateau-demo' ? 'plateau-demo' : query.get('deck') === 'uist-2026' ? 'uist-2026' : query.get('deck') === 'custom' && readDraft('custom') ? 'custom' : 'reference';
    const draft = readDraft(this.choice);
    this.unsaved = !this.fixture && this.serverBacked && draft?.pending === true;
    const initial = this.fixture ? { source: fixtures[fixture!]!, fileName: `tests/fixtures/${fixture}.sw` } : (this.serverBacked && !this.unsaved ? null : draft) ?? builtins[this.choice === 'custom' ? 'reference' : this.choice];
    this.state = { ...initial, assets: { headshotImg, ...plateauAssets } };
    this.document = new DeckDocument(initial.source, initial.fileName);
  }

  connect(): () => void {
    this.connected = true;
    this.startSync();
    return () => { this.connected = false; this.sync?.stop(); this.sync = null; };
  }
  private startSync(): void {
    this.sync?.stop(); this.sync = null;
    if (this.serverBacked && this.connected) {
      this.sync = new SourceSync(this.choice, source => {
        const update = this.updateState({ ...this.state, source }, { origin: 'disk', replacement: true });
        this.unsaved = false;
        this.persist(); this.publish(update);
      }, () => {
        if (this.sync?.status === 'saved') { this.unsaved = false; this.persist(); }
        this.publishSync();
      });
      this.sync.start(this.unsaved ? this.state.source : undefined);
    }
    this.publishSync();
  }
  private publishSync(): void { for (const callback of this.syncSubscribers) callback(); }
  onSyncChange(callback: () => void): () => void {
    this.syncSubscribers.add(callback);
    return () => { this.syncSubscribers.delete(callback); };
  }
  reloadFromDisk(): void { this.sync?.reload(); }

  private persist(): void {
    if (this.fixture) return;
    try { localStorage.setItem(draftKey(this.choice), JSON.stringify({ source: this.state.source, fileName: this.state.fileName, pending: this.serverBacked && this.unsaved })); this.persistenceAvailable = true; }
    catch { this.persistenceAvailable = false; }
    if (this.choice === 'custom') this.custom = { source: this.state.source, fileName: this.state.fileName };
  }
  private updateState(next: HostState, edit: DocumentSourceUpdate = {}): DocumentUpdate | undefined {
    const update = this.document.updateSource(next.source, next.fileName, edit);
    this.state = next;
    return update;
  }
  private publish(update?: DocumentUpdate): void {
    for (const cb of this.stateSubscribers) cb({ ...this.state, documentUpdate: update });
  }
  private updateURL(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('fixture'); url.searchParams.set('deck', this.choice);
    window.history.replaceState(null, '', url);
  }
  switchDeck(choice: DeckChoice): void {
    const useDisk = import.meta.env.DEV && (choice === 'reference' || choice === 'uist-2026');
    const draft = readDraft(choice);
    const pending = useDisk && draft?.pending === true;
    const next = (useDisk && !pending ? null : draft) ?? (choice === 'custom' ? this.custom : builtins[choice]);
    if (!next) return;
    this.fixture = false; this.choice = choice; this.unsaved = pending;
    const update = this.updateState({ ...this.state, ...next }, { origin: 'switch-deck', replacement: true });
    this.startSync(); this.updateURL(); this.publish(update);
  }
  openSource(source: string, fileName: string): void {
    this.fixture = false; this.choice = 'custom'; this.unsaved = false;
    const update = this.updateState({ ...this.state, source, fileName }, { origin: 'open-source', replacement: true });
    this.startSync(); this.persist(); this.updateURL(); this.publish(update);
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

  setSource(source: string, edit: DocumentSourceUpdate = {}): void {
    const update = this.updateState({ ...this.state, source }, edit);
    if (!update) return;
    this.unsaved = this.serverBacked;
    this.persist(); this.publish(update);
    this.sync?.edit(source);
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
