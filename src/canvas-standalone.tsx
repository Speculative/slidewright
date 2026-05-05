// Standalone Slidewright canvas — runs in a normal browser via Vite.
//
// Mirrors the VS Code webview entry but uses StandaloneHost instead.
// Same App component, same canvas UI; the host adapter is the only
// thing that changes between contexts. Adds a bottom-mounted
// EditorPane (v0.1f) so the standalone is a complete demo target —
// no VS Code required for round-trip editing. The pane is
// height-resizable via a horizontal drag handle between it and the
// canvas; dragged height persists across reloads via localStorage.

import { StrictMode, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import '../slidewright/canvas/canvas.css';

import { App } from '../slidewright/canvas/App.js';
import { EditorPane } from '../slidewright/canvas/EditorPane.js';
import { ResizeHandle } from '../slidewright/canvas/ResizeHandle.js';
import { StandaloneHost } from './standalone-host.js';

const EDITOR_HEIGHT_KEY = 'slidewright.canvas.editorHeight';
const EDITOR_HEIGHT_DEFAULT = 280;
const EDITOR_HEIGHT_MIN = 80;
const EDITOR_HEIGHT_MAX = 800;

function readStoredEditorHeight(): number {
  try {
    const raw = localStorage.getItem(EDITOR_HEIGHT_KEY);
    if (raw == null) return EDITOR_HEIGHT_DEFAULT;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return EDITOR_HEIGHT_DEFAULT;
    return Math.max(EDITOR_HEIGHT_MIN, Math.min(EDITOR_HEIGHT_MAX, n));
  } catch {
    return EDITOR_HEIGHT_DEFAULT;
  }
}

function Standalone(): ReactElement {
  const host = useMemo(() => new StandaloneHost(), []);
  const [editorHeight, setEditorHeight] = useState<number>(readStoredEditorHeight);

  useEffect(() => {
    try {
      localStorage.setItem(EDITOR_HEIGHT_KEY, String(editorHeight));
    } catch {
      // Storage unavailable; fine to lose.
    }
  }, [editorHeight]);

  return (
    <div className="sw-standalone-layout">
      <div className="sw-standalone-canvas">
        <App host={host} />
      </div>
      <ResizeHandle
        axis="y"
        invert
        size={editorHeight}
        setSize={setEditorHeight}
        min={EDITOR_HEIGHT_MIN}
        max={EDITOR_HEIGHT_MAX}
      />
      <EditorPane host={host} height={editorHeight} />
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
