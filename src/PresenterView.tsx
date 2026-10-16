import { PresentationBuild, PresentationContext } from '../slidewright/runtime/presentation.js';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { loadDeck } from '../slidewright/runtime/loader.js';
import { prepareSlide } from '../slidewright/canvas/App.js';
import { components, staticTokens } from '../decks/v0-reference/registry.js';
import { DeckMetaContext } from './Slide.jsx';
import type { HostState } from '../slidewright/canvas/host.js';
import type { StandaloneHost } from './standalone-host.js';

function Preview({ slide, label, build }: { slide: ReactElement; label: string; build?: PresentationBuild | null }) {
  const initial = useMemo(() => new PresentationBuild(), []);
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(.25);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const resize = new ResizeObserver(() => setScale(node.clientWidth / 1920));
    resize.observe(node); setScale(node.clientWidth / 1920);
    return () => resize.disconnect();
  }, []);
  return <div><h2>{label}</h2><div ref={frame} style={{ position: 'relative', aspectRatio: '16 / 9', overflow: 'hidden', border: '1px solid #bbb', pointerEvents: 'none' }}>
    <div inert style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left' }}><PresentationContext.Provider value={{ build: build ?? initial, preview: true }}>{prepareSlide(slide)}</PresentationContext.Provider></div>
  </div></div>;
}

export function PresenterView({ host, index, popup, build }: { host: StandaloneHost; index: number; popup: Window; build: PresentationBuild | null }) {
  const [state, setState] = useState<HostState | null>(null);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => host.subscribe(setState), [host]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const deck = useMemo(() => state ? loadDeck({ source: state.source, file: state.fileName, components, scope: { bindings: { ...staticTokens, ...state.assets } } }) : null, [state]);
  const active = Math.max(0, Math.min(index, (deck?.slides.length ?? 1) - 1));
  function navigate(next: number) { const slide = deck?.slidesData[next]; if (slide) host.setCursor(slide.comp.span.start.offset); }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || ((event.target as HTMLElement | null)?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement | null)?.tagName ?? ''))) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); if (!build?.advance(1)) navigate(active + 1); }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); if (!build?.advance(-1)) navigate(active - 1); }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); build?.reset(); }
    }
    popup.addEventListener('keydown', key);
    return () => popup.removeEventListener('keydown', key);
  }, [popup, active, deck, build]);
  if (!deck) return null;
  const note = deck.slidesData[active]?.comp.fills.find(fill => fill.name === 'notes')?.value;
  const label = deck.slidesData[active]?.comp.fills.find(fill => fill.name === 'label')?.value;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  return createPortal(<DeckMetaContext.Provider value={{ ...deck.meta, total: deck.slides.length }}>
    <main className="sw-presenter-console">
      <header><h1>Presenter view</h1><span aria-label="Presenter slide">Slide {active + 1} of {deck.slides.length}{label?.kind === 'string' ? ` · ${label.value}` : ''}</span>
        <span aria-label="Elapsed time">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>
        <button type="button" onClick={() => { const time = Date.now(); setStarted(time); setNow(time); }}>Reset timer</button>
        <button type="button" disabled={active === 0} onClick={() => navigate(active - 1)}>Previous slide</button>
        <button type="button" disabled={active >= deck.slides.length - 1} onClick={() => navigate(active + 1)}>Next slide</button>
      </header>
      <div className="sw-presenter-previews">
        {deck.slides[active] && <Preview key={active} slide={deck.slides[active]!} label="Current slide overview" build={build} />}
        {deck.slides[active + 1] ? <Preview key={active + 1} slide={deck.slides[active + 1]!} label="Next slide overview" /> : <p>End of deck</p>}
      </div>
      <section aria-label="Speaker notes"><h2>Speaker notes</h2><div className="sw-presenter-notes">{note?.kind === 'string' && note.value ? note.value : 'No speaker notes.'}</div></section>
      <p className="sw-presenter-help">Arrow keys advance or reverse builds, then navigate slides. R resets the current build. The current preview follows the audience; the next preview shows its initial build.</p>
    </main>
  </DeckMetaContext.Provider>, popup.document.body);
}

export function usePresenterWindow() {
  const [popup, setPopup] = useState<Window | null>(null);
  const [error, setError] = useState('');
  function open() {
    if (popup && !popup.closed) { popup.focus(); return; }
    const next = window.open('', 'slidewright-presenter', 'popup,width=1280,height=900');
    if (!next) { setError('Allow this site to open the presenter window.'); return; }
    next.document.title = 'Slidewright presenter';
    next.document.body.replaceChildren();
    for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) next.document.head.append(style.cloneNode(true));
    const css = next.document.createElement('style');
    css.textContent = '.sw-presenter-console{font:16px system-ui,sans-serif;padding:20px;color:#111;background:#f5f5f5;min-height:100vh;box-sizing:border-box}.sw-presenter-console header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sw-presenter-console h1{font-size:24px}.sw-presenter-console h2{font-size:18px;margin:12px 0 8px}.sw-presenter-previews{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.sw-presenter-notes{white-space:pre-wrap;background:white;padding:20px;line-height:1.5;max-height:35vh;overflow:auto}.sw-presenter-help{font-size:13px;color:#555}';
    next.document.head.append(css);
    setError(''); setPopup(next);
  }
  useEffect(() => {
    if (!popup) return;
    const close = () => popup.close();
    const timer = setInterval(() => { if (popup.closed) setPopup(null); }, 500);
    window.addEventListener('beforeunload', close);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', close); popup.close(); };
  }, [popup]);
  return { popup, open, error };
}
