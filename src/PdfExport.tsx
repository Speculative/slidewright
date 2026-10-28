import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { PresentationBuild, PresentationContext } from '../slidewright/runtime/presentation.js';
import { prepareSlide } from '../slidewright/canvas/App.js';
import { components, staticTokens } from '../decks/v0-reference/registry.js';
import { DeckMetaContext } from './Slide.jsx';
import type { StandaloneHost } from './standalone-host.js';
import { resolvePdfDocument, type PdfDocument, type PdfExportMode, type PdfPage } from './pdf-export-model.js';

interface PdfJob { popup: Window; document: PdfDocument; mode: PdfExportMode }

function PrintPage({ page, final, width, height }: { page: PdfPage; final: boolean; width: number; height: number }) {
  const build = useMemo(() => new PresentationBuild(), []);
  // Child useBuildStep effects register first. Final-state exports settle those
  // components at their last stage; authored-build exports show initial stages.
  useEffect(() => { if (final) build.advance(Number.MAX_SAFE_INTEGER); }, [build, final]);
  return <div className="sw-print-page" data-slide-index={page.slideIndex} data-build-index={page.buildIndex} style={{ width, height }}>
    <PresentationContext.Provider value={{ build }}>
      {prepareSlide(page.slide)}
    </PresentationContext.Provider>
  </div>;
}

export function PdfExportView({ job }: { job: PdfJob }) {
  const { popup, document: deck, mode } = job;
  const [readyDocument, setReadyDocument] = useState<PdfDocument | null>(null);
  const ready = readyDocument === deck;
  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      const doc = popup.document;
      await Promise.all(Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(link => link.sheet ? Promise.resolve() : new Promise<void>(resolve => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
      })));
      // Force layout so cloned styles have requested their fonts before waiting.
      doc.body.getBoundingClientRect();
      await doc.fonts.ready;
      await Promise.all(Array.from(doc.images).map(img => img.decode().catch(() => {})));
      // Let the final build's React update and browser layout finish.
      await new Promise<void>(resolve => popup.requestAnimationFrame(() => popup.requestAnimationFrame(() => resolve())));
      if (cancelled || popup.closed) return;
      setReadyDocument(deck);
      popup.focus();
      popup.print();
    }
    void prepare();
    return () => { cancelled = true; };
  }, [popup, deck]);
  const style = { '--deck-design-w': `${deck.meta.width}px`, '--deck-design-h': `${deck.meta.height}px` } as CSSProperties;
  return createPortal(<DeckMetaContext.Provider value={{ ...deck.meta, total: deck.slideCount }}>
    <div className="sw-print-document" style={style} data-ready={ready}>
      <header className="sw-print-controls"><h1>Export PDF</h1>
        <p>{mode === 'final' ? 'Final state per slide' : 'Every authored build (including initial)'} · {deck.pages.length} pages. Choose Save as PDF in the print dialog.</p>
        <p>{mode === 'final' ? 'Custom component builds use their final stage.' : 'Custom component builds use their initial stage on each authored page.'}</p>
        <button type="button" disabled={!ready} onClick={() => popup.print()}>Print / Save as PDF</button>
        <button type="button" onClick={() => popup.close()}>Close</button>
        {!ready && <p role="status">Preparing fonts and images…</p>}
      </header>
      {deck.pages.map(page => <PrintPage key={`${page.slideIndex}:${page.buildIndex}`} page={page} final={mode === 'final'} width={deck.meta.width} height={deck.meta.height} />)}
    </div>
  </DeckMetaContext.Provider>, popup.document.body);
}

export function usePdfExport() {
  const [job, setJob] = useState<PdfJob | null>(null);
  const [error, setError] = useState('');
  function open(host: StandaloneHost, mode: PdfExportMode) {
    try {
      let assets: Record<string, string> = {};
      host.subscribe(state => { assets = state.assets; })();
      const deck = resolvePdfDocument({ source: host.source, file: host.fileName, components,
        scope: { bindings: { ...staticTokens, ...assets } } }, mode);
      const popup = window.open('', '_blank', 'popup,width=1100,height=850');
      if (!popup) { setError('Allow this site to open the PDF print window.'); return; }
      popup.document.title = `${deck.meta.name || 'Slidewright'} — ${mode === 'final' ? 'Final slides' : 'All builds'}`;
      const base = popup.document.createElement('base'); base.href = document.baseURI;
      popup.document.head.append(base);
      for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) popup.document.head.append(style.cloneNode(true));
      const css = popup.document.createElement('style');
      css.textContent = `
        @page { size: ${deck.meta.width}px ${deck.meta.height}px; margin: 0; }
        html,body { margin:0 !important; padding:0 !important; overflow:auto !important; height:auto !important; }
        body { background:#ddd; }
        .sw-print-controls { padding:16px; font:16px system-ui,sans-serif; color:#111; background:white; }
        .sw-print-controls button { margin-right:12px; }
        .sw-print-page { position:relative; overflow:hidden; margin:20px 0; break-inside:avoid; break-after:page; }
        .sw-print-page > div { width:100%; height:100%; }
        .sw-print-page section.slide { width:100%; height:100%; visibility:visible; opacity:1; }
        .sw-print-page:last-child { break-after:auto; }
        @media print {
          html,body { width:${deck.meta.width}px; background:none; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
          .sw-print-controls { display:none !important; }
          .sw-print-page { margin:0; }
        }`;
      popup.document.head.append(css);
      setError(''); setJob({ popup, document: deck, mode });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not prepare PDF.'); }
  }
  useEffect(() => {
    if (!job) return;
    const close = () => job.popup.close();
    const timer = setInterval(() => { if (job.popup.closed) setJob(null); }, 500);
    window.addEventListener('beforeunload', close);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', close); close(); };
  }, [job]);
  return { job, open, error };
}
