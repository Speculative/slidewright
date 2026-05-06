// Standalone Slidewright canvas — runs in a normal browser via Vite.
//
// Mirrors the VS Code webview entry but uses StandaloneHost instead.
// Same App component, same canvas UI; the host adapter is the only
// thing that changes between contexts. The standalone provides an
// EditorPane via App's `bottomExtra` slot — App owns the bottom
// strip layout (hierarchy + properties + bottomExtra), so the
// standalone is a thin wrapper around App.

import { StrictMode, useEffect, useMemo } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import '../slidewright/canvas/canvas.css';

import { App } from '../slidewright/canvas/App.js';
import { EditorPane } from '../slidewright/canvas/EditorPane.js';
import { StandaloneHost } from './standalone-host.js';

function Standalone(): ReactElement {
  const host = useMemo(() => new StandaloneHost(), []);

  // Test hook. Exposes the canvas's host on window so e2e tests can
  // invoke host.setCursor / sendSelection / setSource directly,
  // bypassing the React event-system intricacies of programmatic
  // textarea events. The host's *contract* is what we want to test
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

  return <App host={host} bottomExtra={<EditorPane host={host} />} />;
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
