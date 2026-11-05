import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { PresentationBuild, PresentationContext } from '../slidewright/runtime/presentation.js';
import { prepareSlide } from '../slidewright/canvas/App.js';
import { components, staticTokens } from '../decks/v0-reference/registry.js';
import { DeckMetaContext } from './Slide.jsx';
import type { StandaloneHost } from './standalone-host.js';
import { resolvePdfDocument, type PdfDocument, type PdfExportMode, type PdfPage } from './pdf-export-model.js';

interface PdfJob { popup: Window; document: PdfDocument; mode: PdfExportMode }

function PrintPage({ page, step, width, height, onCount }: {
  page: PdfPage; step: number | 'final'; width: number; height: number;
  onCount?(count: number): void;
}) {
  const build = useMemo(() => new PresentationBuild(), []);
  // Descendants register their stage counts before this passive effect runs.
  useEffect(() => { onCount?.(build.stageCount()); }, [build, onCount]);
  return <div className="sw-print-page" data-slide-index={page.slideIndex} data-build-index={page.buildIndex} data-animation-step={step} style={{ width, height }}>
    <PresentationContext.Provider value={{ build, exportStep: step }}>
      {prepareSlide(page.slide)}
    </PresentationContext.Provider>
  </div>;
}

function PrintFrames({ page, final, width, height }: { page: PdfPage; final: boolean; width: number; height: number }) {
  const [count, setCount] = useState(1);
  return <>{Array.from({ length: final ? 1 : count }, (_, step) =>
    <PrintPage key={step} page={page} step={final ? 'final' : step} width={width} height={height} onCount={step === 0 ? setCount : undefined} />
  )}</>;
}

export function PdfExportView({ job }: { job: PdfJob }) {
  const { popup, document: deck, mode } = job;
  const [readyDocument, setReadyDocument] = useState<PdfDocument | null>(null);
  const ready = readyDocument === deck;
  const [pageCount, setPageCount] = useState(deck.pages.length);
  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      const doc = popup.document;
      await Promise.all(Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(link => link.sheet ? Promise.resolve() : new Promise<void>(resolve => {
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => resolve(), { once: true });
      })));
      // Stage discovery adds pages in a React update. Mount those before
      // enumerating their assets and requesting their fonts.
      await new Promise<void>(resolve => popup.requestAnimationFrame(() => popup.requestAnimationFrame(() => resolve())));
      // Force layout so cloned styles have requested their fonts before waiting.
      doc.body.getBoundingClientRect();
      await doc.fonts.ready;
      await Promise.all(Array.from(doc.images).map(img => img.decode().catch(() => {})));
      // Let discovered animation pages mount and browser layout finish.
      await new Promise<void>(resolve => popup.requestAnimationFrame(() => popup.requestAnimationFrame(() => resolve())));
      // Finish finite CSS/Web Animations, preserving their end-state fill.
      for (const animation of doc.getAnimations()) {
        const end = animation.effect?.getComputedTiming().endTime;
        if (typeof end === 'number' && Number.isFinite(end)) animation.finish();
      }
      if (cancelled || popup.closed) return;
      setPageCount(doc.querySelectorAll('.sw-print-page').length);
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
        <p>{mode === 'final' ? 'Final state per slide' : 'Every build and animation stage (including initial)'} · {pageCount} pages. Choose Save as PDF in the print dialog.</p>
        <p>{mode === 'final' ? 'Custom component builds use their final stage.' : 'Each custom animation stage is exported at its end state.'}</p>
        <button type="button" disabled={!ready} onClick={() => popup.print()}>Print / Save as PDF</button>
        <button type="button" onClick={() => popup.close()}>Close</button>
        {!ready && <p role="status">Preparing fonts and images…</p>}
      </header>
      {deck.pages.map(page => <PrintFrames key={`${page.slideIndex}:${page.buildIndex}`} page={page} final={mode === 'final'} width={deck.meta.width} height={deck.meta.height} />)}
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
        .sw-print-page *, .sw-print-page *::before, .sw-print-page *::after { transition: none !important; animation-duration: 0.001ms !important; animation-delay: -1s !important; animation-iteration-count: 1 !important; }
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
