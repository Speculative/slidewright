import { PresentationBuild, PresentationContext } from '../slidewright/runtime/presentation.js';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { loadDeck } from '../slidewright/runtime/loader.js';
import { prepareSlide, type BuildNavigation } from '../slidewright/canvas/App.js';
import { components, staticTokens } from '../decks/v0-reference/registry.js';
import { DeckMetaContext } from './Slide.jsx';
import type { HostState } from '../slidewright/canvas/host.js';
import type { StandaloneHost } from './standalone-host.js';

function Preview({ slide, label, build, width, height }: { slide: ReactElement; label: string; build?: PresentationBuild | null; width: number; height: number }) {
  const initial = useMemo(() => new PresentationBuild(), []);
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(.25);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const resize = new ResizeObserver(() => setScale(node.clientWidth / width));
    resize.observe(node); setScale(node.clientWidth / width);
    return () => resize.disconnect();
  }, [width]);
  return <div><h2>{label}</h2><div ref={frame} style={{ position: 'relative', aspectRatio: `${width} / ${height}`, overflow: 'hidden', border: '1px solid #bbb', pointerEvents: 'none' }}>
    <div inert className="sw-presenter-preview-canvas" style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}><PresentationContext.Provider value={{ build: build ?? initial, preview: true }}>{prepareSlide(slide)}</PresentationContext.Provider></div>
  </div></div>;
}

export function PresenterView({ host, index, popup, build, navigation }: { host: StandaloneHost; index: number; popup: Window; build: PresentationBuild | null; navigation: BuildNavigation | null }) {
  const [state, setState] = useState<HostState | null>(null);
  const [started, setStarted] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => host.subscribe(setState), [host]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const deck = useMemo(() => state ? loadDeck({ source: state.source, file: state.fileName, components, scope: { bindings: { ...staticTokens, ...state.assets } }, buildIndices: new Map([[navigation?.slideIndex ?? index, navigation?.buildIndex ?? 0]]) }) : null, [state, navigation?.slideIndex, navigation?.buildIndex, index]);
  const active = Math.max(0, Math.min(navigation?.slideIndex ?? index, (deck?.slides.length ?? 1) - 1));
  const buildIndex = navigation?.buildIndex ?? 0;
  const buildCount = navigation?.buildCount ?? 1;
  const nextIsBuild = buildIndex + 1 < buildCount;
  const nextIndex = nextIsBuild ? active : active + 1;
  const nextDeck = useMemo(() => state ? loadDeck({ source: state.source, file: state.fileName, components,
    scope: { bindings: { ...staticTokens, ...state.assets } },
    buildIndices: new Map([[nextIndex, nextIsBuild ? buildIndex + 1 : 0]]) }) : null,
  [state, nextIndex, nextIsBuild, buildIndex]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || ((event.target as HTMLElement | null)?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement | null)?.tagName ?? ''))) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); navigation?.advance(1); }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); navigation?.advance(-1); }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); navigation?.reset(); }
    }
    popup.addEventListener('keydown', key);
    return () => popup.removeEventListener('keydown', key);
  }, [popup, navigation]);
  if (!deck) return null;
  const note = deck.slidesData[active]?.comp.fills.find(fill => fill.name === 'notes')?.value;
  const label = deck.slidesData[active]?.comp.fills.find(fill => fill.name === 'label')?.value;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  return createPortal(<DeckMetaContext.Provider value={{ ...deck.meta, total: deck.slides.length }}>
    <main className="sw-presenter-console">
      <header><h1>Presenter view</h1><span aria-label="Presenter slide">Slide {active + 1} of {deck.slides.length}{label?.kind === 'string' ? ` · ${label.value}` : ''}</span>
        <span aria-label="Presenter build">Build {buildIndex + 1} of {buildCount}</span>
        <span aria-label="Elapsed time">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</span>
        <button type="button" onClick={() => { const time = Date.now(); setStarted(time); setNow(time); }}>Reset timer</button>
        <button type="button" disabled={!navigation} onClick={() => navigation?.advance(-1)}>Previous slide</button>
        <button type="button" disabled={!navigation} onClick={() => navigation?.advance(1)}>Next slide</button>
      </header>
      <div className="sw-presenter-previews">
        {deck.slides[active] && <Preview width={deck.meta.width} height={deck.meta.height} key={`${active}:${buildIndex}`} slide={deck.slides[active]!} label="Current slide overview" build={build} />}
        {nextDeck?.slides[nextIndex] ? <Preview width={deck.meta.width} height={deck.meta.height} key={`${nextIndex}:${nextIsBuild ? buildIndex + 1 : 0}`} slide={nextDeck.slides[nextIndex]!} label="Next slide overview" /> : <p>End of deck</p>}
      </div>
      <section aria-label="Speaker notes"><h2>Speaker notes</h2><div className="sw-presenter-notes">{note?.kind === 'string' && note.value ? note.value : 'No speaker notes.'}</div></section>
      <p className="sw-presenter-help">Arrow keys advance or reverse builds, then navigate slides. R resets the current build. The current preview follows the audience; the next preview shows the next authored build, or the next slide’s initial build. Previous slide and Next slide buttons follow the same build sequence.</p>
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
    css.textContent = '.sw-presenter-console{font:16px system-ui,sans-serif;padding:20px;color:#111;background:#f5f5f5;min-height:100vh;box-sizing:border-box}.sw-presenter-console header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sw-presenter-console h1{font-size:24px}.sw-presenter-console h2{font-size:18px;margin:12px 0 8px}.sw-presenter-previews{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.sw-presenter-notes{white-space:pre-wrap;background:white;padding:20px;line-height:1.5;max-height:35vh;overflow:auto}.sw-presenter-help{font-size:13px;color:#555}.sw-presenter-preview-canvas>div{width:100%;height:100%}.sw-presenter-preview-canvas section.slide{width:100%;height:100%}';
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
