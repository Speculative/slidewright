import { useEffect, useRef, useState } from 'react';
import type { PdfExportMode } from './pdf-export-model.js';
import { parse } from '../slidewright/runtime/parser.js';
import type { StandaloneHost, DeckChoice } from './standalone-host.js';

export function StandaloneControls({ host, presenting, onPresent, onPresenter, onFullscreen, onExportPdf, presenterError }: { host: StandaloneHost; presenting: boolean; onPresent(): void; onPresenter(): void; onFullscreen(): void; presenterError: string; onExportPdf(mode: PdfExportMode): void }) {
  const [, refresh] = useState(0);
  const [message, setMessage] = useState('');
  const [pdfMode, setPdfMode] = useState<PdfExportMode>('final');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => host.subscribe(() => refresh(value => value + 1)), [host]);
  useEffect(() => host.onSyncChange(() => refresh(value => value + 1)), [host]);
  const syncMessages = {
    connecting: 'Connecting to source file…',
    saved: 'Saved to source file',
    saving: 'Saving to source file…',
    conflict: 'Out of sync: the source file changed. Local edits are kept here but will not be written. Download a copy or reload from disk.',
    error: 'Source file unavailable. Edits are kept here; retrying connection…',
  };
  function download() {
    const url = URL.createObjectURL(new Blob([host.source], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = host.deckChoice === 'plateau-demo' ? 'plateau-demo.sw' : host.deckChoice === 'uist-2026' ? 'uist-2026.sw' : host.fileName.split('/').at(-1) ?? 'deck.sw';
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function open(file: File) {
    try {
      const source = await file.text();
      const parsed = parse(source, file.name);
      if (parsed.diagnostics.some(diagnostic => diagnostic.severity === 'error') || !parsed.ast.items.some(item => item.name === 'Deck')) {
        setMessage('Could not open: choose a valid .sw Deck source file.'); return;
      }
      host.openSource(source, file.name); setMessage(`Opened ${file.name}`);
    } catch { setMessage('Could not read that source file.'); }
  }
  return <div className="sw-standalone-controls" role="group" aria-label="Deck files">
    <button type="button" onClick={onPresent}>{presenting ? 'Edit slides' : 'Present'}</button>
    {presenting && <button type="button" onClick={onFullscreen}>Fullscreen</button>}
    <button type="button" onClick={onPresenter}>Presenter view</button>
    <label>Deck <select aria-label="Deck" value={host.deckChoice} onChange={event => { host.switchDeck(event.target.value as DeckChoice); setMessage(''); }}>
      <option value="reference">Slidewright reference</option><option value="uist-2026">UIST 2026</option><option value="plateau-demo">PLATEAU 2026 demo</option>
      {host.hasCustomDeck && <option value="custom">Opened deck</option>}
    </select></label>
    <button type="button" onClick={() => setMessage(host.saveDraft() ? 'Saved in this browser' : 'Browser storage unavailable; download a copy.')}>Save draft</button>
    <label>PDF pages <select aria-label="PDF pages" value={pdfMode} onChange={event => setPdfMode(event.target.value as PdfExportMode)}>
      <option value="final">Final state per slide</option>
      <option value="builds">Every authored build (including initial)</option>
    </select></label>
    <button type="button" onClick={() => onExportPdf(pdfMode)}>Export PDF</button>
    <button type="button" onClick={download}>Download source</button>
    <button type="button" onClick={() => fileInput.current?.click()}>Open source</button>
    <input ref={fileInput} type="file" accept=".sw,text/plain" aria-label="Open deck file" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void open(file); event.currentTarget.value = ''; }} />
    {host.serverBacked && <button type="button" onClick={() => host.reloadFromDisk()}>Reload from disk</button>}
    <span role="status">{!host.persistenceAvailable && 'Browser backup unavailable; download a copy before closing. '}{(host.syncStatus && host.syncStatus !== 'saved' ? syncMessages[host.syncStatus] : '') || presenterError || message || (host.syncStatus ? syncMessages[host.syncStatus] : '') || (host.persistenceAvailable ? 'Committed edits save in this browser' : 'Browser storage unavailable; download a copy.')}</span>
  </div>;
}
