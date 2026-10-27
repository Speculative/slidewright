// VS Code owns the native buffer. Local source transactions publish synchronously
// to the canvas, then serialize against confirmed native document versions. An
// external edit or rejection replaces speculative source and clears its history.
import { DeckDocument, type DocumentSourceUpdate } from '../../../slidewright/runtime/document.js';
import type { Host, HostState, SourceRange } from '../../../slidewright/canvas/host.js';
import { verifyChanges, type ExtensionToWebview, type SetSourceMessage, type SourceSnapshot } from '../source-protocol.js';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
interface PendingSource { request: Omit<SetSourceMessage, 'baseVersion'>; sent: boolean }
export class VSCodeHost implements Host {
  document?: DeckDocument;
  private state?: HostState;
  private authority?: SourceSnapshot;
  private pending: PendingSource[] = [];
  private nextRequest = 0;
  private pendingSelection?: SourceRange;
  private readonly vscode = acquireVsCodeApi();
  private stateSubscribers = new Set<(state: HostState) => void>();
  private cursorSubscribers = new Set<(offset: number) => void>();
  constructor() { window.addEventListener('message', this.onMessage); }

  subscribe(callback: (state: HostState) => void): () => void {
    this.stateSubscribers.add(callback);
    if (this.state) callback(this.state);
    if (this.stateSubscribers.size === 1 && this.cursorSubscribers.size === 0) this.vscode.postMessage({ type: 'ready' });
    return () => { this.stateSubscribers.delete(callback); };
  }
  sendSelection(range: SourceRange): void {
    if (this.pending.length) { this.pendingSelection = { ...range }; return; }
    if (this.authority) this.vscode.postMessage({ type: 'select-source-range', start: range.start, end: range.end, version: this.authority.version });
  }
  setSource(source: string, options: DocumentSourceUpdate = {}): void {
    if (!this.document || !this.state || !this.authority) throw new Error('VS Code source is not initialized');
    const update = this.document.updateSource(source, this.state.fileName, options);
    if (!update) return;
    this.pendingSelection = undefined;
    this.pending.push({ sent: false, request: { type: 'set-source', requestId: ++this.nextRequest,
      source, changes: update.changes, origin: options.origin ?? 'canvas', replacement: options.replacement } });
    this.publish({ ...this.state, source, documentUpdate: update });
    this.flush();
  }
  onCursorChange(callback: (offset: number) => void): () => void {
    this.cursorSubscribers.add(callback);
    return () => { this.cursorSubscribers.delete(callback); };
  }
  private publish(state: HostState): void {
    this.state = { ...state, documentUpdate: undefined };
    for (const callback of this.stateSubscribers) callback(state);
  }
  private flush(): void {
    const next = this.pending[0];
    if (!next) {
      const selection = this.pendingSelection;
      this.pendingSelection = undefined;
      if (selection) this.sendSelection(selection);
      return;
    }
    if (next.sent || !this.authority) return;
    next.sent = true;
    this.vscode.postMessage({ ...next.request, baseVersion: this.authority.version });
  }
  private replaceAuthority(message: SourceSnapshot, replacement: boolean, changes?: DocumentSourceUpdate['changes']): void {
    this.pending = [];
    this.pendingSelection = undefined;
    this.authority = message;
    const documentUpdate = this.document?.updateSource(message.source, message.fileName, {
      origin: 'vscode', replacement, changes,
    });
    this.document ??= new DeckDocument(message.source, message.fileName);
    this.publish({ source: message.source, fileName: message.fileName, assets: message.assets, documentUpdate });
  }
  private onMessage = (event: MessageEvent<ExtensionToWebview>): void => {
    const message = event.data;
    if (message?.type === 'cursor-changed') {
      // Native offsets belong to confirmed source. During queued local edits
      // they cannot safely navigate the speculative document.
      if (!this.pending.length && message.version === this.authority?.version) for (const callback of this.cursorSubscribers) callback(message.offset);
      return;
    }
    if (message?.type !== 'source-updated' && message?.type !== 'source-result') return;
    if (!Number.isInteger(message.version) || message.version < 0) return;
    if (this.authority && message.fileName === this.authority.fileName && message.version < this.authority.version) return;
    const head = this.pending[0];
    if (message.type === 'source-result') {
      // Late results from canceled requests cannot resurrect old source/history.
      if (!head || message.requestId !== head.request.requestId) return;
      if (message.accepted && message.source === head.request.source && message.fileName === this.authority?.fileName) {
        this.authority = message;
        this.pending.shift();
        this.flush();
      } else this.replaceAuthority(message, true);
      return;
    }
    if (head && message.requestId === head.request.requestId && message.source === head.request.source) {
      // The native change event can precede apply's result. Record its version
      // without echoing an old source over later local transactions.
      this.authority = message;
      return;
    }
    if (this.authority && message.version === this.authority.version && message.fileName === this.authority.fileName &&
        message.source === this.authority.source && !message.replacement) {
      // Readiness resends and own-event echoes are not canvas history barriers.
      if (JSON.stringify(message.assets) !== JSON.stringify(this.state?.assets)) {
        if (this.state) this.publish({ ...this.state, assets: message.assets });
      }
      return;
    }
    let precise = message.changes;
    let replacement = !!message.replacement || !!head ||
      (!!this.authority && message.baseVersion !== this.authority.version);
    if (precise && this.authority && !replacement) {
      try { verifyChanges(this.authority.source, message.source, precise); }
      catch { replacement = true; precise = undefined; }
    } else precise = undefined;
    this.replaceAuthority(message, replacement, precise);
  };
}
