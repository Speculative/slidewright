// Standalone Slidewright canvas — runs in a normal browser via Vite.
//
// Mirrors the VS Code webview entry but uses StandaloneHost instead.
// Same App component, same canvas UI; the host adapter is the only
// thing that changes between contexts.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import '../slidewright/canvas/canvas.css';

import { App } from '../slidewright/canvas/App.js';
import { StandaloneHost } from './standalone-host.js';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Slidewright canvas: #root not found.');
}
createRoot(rootEl).render(
  <StrictMode>
    <App host={new StandaloneHost()} />
  </StrictMode>,
);
