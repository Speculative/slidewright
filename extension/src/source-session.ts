// Native document authority, independent of the VS Code API for contract tests.
import { verifyChanges, type SourceChange, type ExtensionToWebview, type SetSourceMessage, type SourceSnapshot } from './source-protocol.js';

export interface SourceAuthority {
  snapshot(): SourceSnapshot;
  // The native adapter must reject if the document changes while applying.
  apply(changes: readonly SourceChange[], baseVersion: number): Promise<boolean>;
  post(message: ExtensionToWebview): void;
}
export class SourceSession {
  private ready = false;
  private published?: SourceSnapshot;
  private applying?: SetSourceMessage;
  constructor(private readonly authority: SourceAuthority) {}
  start(): void { this.ready = true; this.update(); }
  update(changes?: readonly SourceChange[]): void {
    if (!this.ready) return;
    const current = this.authority.snapshot();
    const before = this.published;
    let precise: readonly SourceChange[] | undefined;
    if (before && changes) {
      try { verifyChanges(before.source, current.source, changes); precise = changes; } catch { /* A missed event requires a replacement. */ }
    }
    const own = this.applying && before?.version === this.applying.baseVersion && current.source === this.applying.source;
    this.authority.post({ type: 'source-updated', ...current,
      baseVersion: precise ? before?.version : undefined, changes: precise,
      requestId: own ? this.applying!.requestId : undefined,
      replacement: !!before && current.version !== before.version && !precise,
    });
    this.published = current;
  }
  async setSource(request: SetSourceMessage): Promise<void> {
    let accepted = false;
    // Never execute overlapping requests based on the same native version.
    if (!this.applying) {
      this.applying = request;
      try {
        const before = this.authority.snapshot();
        if (request.baseVersion === before.version) {
          verifyChanges(before.source, request.source, request.changes);
          accepted = request.source === before.source || await this.authority.apply(request.changes, request.baseVersion);
        }
      } catch { /* Return current source on invalid, failed or rejected edits. */ }
      finally { this.applying = undefined; }
    }
    const current = this.authority.snapshot();
    this.authority.post({ type: 'source-result', ...current, requestId: request.requestId,
      accepted: accepted && current.source === request.source });
  }
}
