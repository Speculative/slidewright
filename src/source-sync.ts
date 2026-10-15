export type SyncStatus = 'connecting' | 'saved' | 'saving' | 'conflict' | 'error';
interface Snapshot { source: string; revision: string }

// A single request lane serializes saves and disk checks, avoiding stale
// acknowledgements and self-conflicts. Edits during a save coalesce into the
// next request; polling continues even when the user isn't committing edits.
export class SourceSync {
  status: SyncStatus = 'connecting';
  private base: Snapshot | null = null;
  private desired: string | null = null;
  private running = false;
  private stopped = false;
  private reloadRequested = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private deck: string, private adopt: (source: string) => void, private changed: () => void) {}

  start(recoveredSource?: string): void {
    if (recoveredSource !== undefined) this.desired = recoveredSource;
    void this.run();
  }
  stop(): void { this.stopped = true; clearTimeout(this.timer); }
  edit(source: string): void {
    this.desired = source;
    if (this.status !== 'conflict') { this.setStatus('saving'); void this.run(); }
  }
  reload(): void { this.reloadRequested = true; void this.run(); }
  private setStatus(status: SyncStatus): void {
    if (this.stopped) return;
    if (this.status !== status) { this.status = status; this.changed(); }
  }
  private async request(method: 'GET' | 'PUT', body?: Snapshot): Promise<Snapshot> {
    const response = await fetch(`/__slidewright/source?deck=${this.deck}`, {
      method, cache: 'no-store', signal: AbortSignal.timeout(5000),
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (response.status === 409) { this.setStatus('conflict'); throw new Error('conflict'); }
    if (!response.ok) throw new Error('Source request failed');
    const snapshot = await response.json() as Snapshot;
    if (typeof snapshot.source !== 'string' || typeof snapshot.revision !== 'string') throw new Error('Invalid snapshot');
    return snapshot;
  }
  private async run(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    clearTimeout(this.timer);
    try {
      do {
        if (this.reloadRequested || !this.base) {
          const snapshot = await this.request('GET');
          if (this.stopped) return;
          const reload = this.reloadRequested;
          this.reloadRequested = false;
          this.base = snapshot;
          // Never send an old browser draft to a newly connected file.
          if (!reload && this.desired !== null && this.desired !== snapshot.source) { this.setStatus('conflict'); return; }
          if (reload || this.desired === null) {
            this.desired = snapshot.source;
            this.adopt(snapshot.source);
          }
        } else if (this.status === 'conflict') {
          return;
        } else if (this.desired !== this.base.source) {
          this.setStatus('saving');
          const saved = await this.request('PUT', { source: this.desired!, revision: this.base.revision });
          if (this.stopped) return;
          this.base = saved;
        } else {
          const snapshot = await this.request('GET');
          if (this.stopped) return;
          if (snapshot.revision !== this.base.revision) { this.setStatus('conflict'); return; }
        }
      } while (this.reloadRequested || this.desired !== this.base.source);
      this.setStatus('saved');
    } catch {
      if (!this.stopped && this.status !== 'conflict') this.setStatus('error');
    } finally {
      this.running = false;
      if (!this.stopped) this.timer = setTimeout(() => void this.run(), 500);
    }
  }
}
