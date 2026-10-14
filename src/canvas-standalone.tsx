// Standalone Slidewright canvas — runs in a normal browser via Vite.
//
// Mirrors the VS Code webview entry but uses StandaloneHost instead.
// Same App component, same canvas UI; the host adapter is the only
// thing that changes between contexts. The standalone provides an
// EditorPane via App's `bottomExtra` slot — App owns the bottom
// strip layout (hierarchy + properties + bottomExtra), so the
// standalone is a thin wrapper around App.

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import '../decks/plateau-2026/presentation.css';
import '../slidewright/canvas/canvas.css';

import { App } from '../slidewright/canvas/App.js';
import { EditorPane } from '../slidewright/canvas/EditorPane.js';
import { PresenterView, usePresenterWindow } from './PresenterView.js';
import { StandaloneControls } from './StandaloneControls.js';
import { StandaloneHost } from './standalone-host.js';

function Standalone(): ReactElement {
  const [activeSlide, setActiveSlide] = useState(0);
  const presenter = usePresenterWindow();
  const [presenting, setPresenting] = useState(false);
  const audience = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === audience.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError('');
    const node = audience.current;
    if (!node?.requestFullscreen) {
      setFullscreenError('Fullscreen is unavailable in this browser.'); return;
    }
    try {
      if (document.fullscreenElement === node) await document.exitFullscreen();
      else await node.requestFullscreen();
      node.focus({ preventScroll: true });
    } catch {
      setFullscreenError('Could not change fullscreen. Use your browser fullscreen command or Escape to leave it.');
    }
  }
  const host = useMemo(() => new StandaloneHost(), []);

  // Test hook. Exposes the canvas's host on window so e2e tests can
  // invoke host.setCursor / sendSelection / setSource directly,
  // bypassing the React event-system intricacies of programmatic
  // source-editor events. The host's *contract* is what we want to test
  // (canvas responds to host.setCursor → active slide updates);
  // whether Playwright can fake React's synthetic onSelect is a
  // separate concern.
  //
  // Lives in this useEffect (not the StandaloneHost constructor)
  // because StrictMode dev double-invokes useMemo init — two host
  // instances get constructed; useMemo keeps one and discards the
  // other. The constructor-level assignment overwrote the kept one
  // with the discarded one, leaving the test inspecting a host
  // with no subscribers. useEffect doesn't suffer from that —
  // it runs once per mounted component, after StrictMode settles.
  useEffect(() => {
    (window as unknown as { __slidewrightHost: StandaloneHost }).__slidewrightHost = host;
  }, [host]);

  return (
    <div ref={audience} tabIndex={-1} className={`sw-standalone${presenting ? ' sw-presenting' : ''}`} onKeyDownCapture={event => {
      if (presenting && (['Delete', 'Backspace'].includes(event.key) || (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase()))) {
        event.preventDefault(); event.stopPropagation();
      }
    }}>
    <StandaloneControls host={host} presenterError={fullscreenError || presenter.error} onFullscreen={() => void toggleFullscreen()} onPresenter={() => { setFullscreenError(''); presenter.open(); setPresenting(true); }} presenting={presenting} onPresent={() => { setFullscreenError(''); setPresenting(value => !value); }} />
    {fullscreen && <button type="button" className="sw-audience-exit-fullscreen" onClick={() => void toggleFullscreen()}>Exit fullscreen</button>}
    <App
      host={host}
      onActiveSlideChange={setActiveSlide}
      bottomExtra={(projection) => (
        <EditorPane host={host} projection={projection} />
      )}
    />
    {presenter.popup && <PresenterView host={host} index={activeSlide} popup={presenter.popup} />}
    </div>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Slidewright canvas: #root not found.');
}
createRoot(rootEl).render(
  <StrictMode>
    <Standalone />
  </StrictMode>,
);
