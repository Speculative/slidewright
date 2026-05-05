// Slidewright canvas — webview-side React app.
//
// v0.1c (this slice): React + slidewright runtime + the v0-reference
// deck's components are bundled in here. On each source-updated
// message we run loadDeck and render the first slide, scaled to fit
// the panel.
//
// HARDCODED FOR v0-REFERENCE: the component registry and the
// non-asset color tokens are baked into this bundle. The extension
// supplies asset URIs (headshotImg) via the message. Generalizing to
// "any deck the user opens" requires an on-the-fly deck-loading
// pipeline (esbuild-as-a-service from the extension); that's v0.2
// territory.

import { cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { loadDeck } from '../../../slidewright/runtime/loader.js';
import { buildRegistry } from '../../../slidewright/runtime/contract.js';
import {
  formatDiagnostic,
  type Diagnostic,
} from '../../../slidewright/runtime/diagnostics.js';

// v0-reference deck components, statically imported.
import * as TitleSlide from '../../../decks/v0-reference/components/TitleSlide.js';
import * as ContentSlide from '../../../decks/v0-reference/components/ContentSlide.js';
import * as CardRow from '../../../decks/v0-reference/components/CardRow.js';
import * as VStack from '../../../decks/v0-reference/components/VStack.js';

// ── Message protocol ───────────────────────────────────────────────────

interface SourceUpdatedMessage {
  type: 'source-updated';
  source: string;
  fileName: string;
  assets: Record<string, string>;
}

type ExtensionToWebview = SourceUpdatedMessage;

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const vscode = acquireVsCodeApi();

// ── Deck-specific configuration (v0-reference) ─────────────────────────

const components = buildRegistry({ TitleSlide, ContentSlide, CardRow, VStack });

// Color/font token names that the .sw uses as bare lower-cased
// references. The renderer turns them into `var(--<name>)` via the
// existing styles.css palette; we just need them resolvable in the
// scope.
const STATIC_TOKENS: Record<string, string> = {
  accent: 'accent',
  purple: 'purple',
  cyan: 'cyan',
  magenta: 'magenta',
  amber: 'amber',
  lime: 'lime',
  blue: 'blue',
  red: 'red',
  mono: 'mono',
  display: 'display',
  body: 'body',
};

// ── App ───────────────────────────────────────────────────────────────

interface RenderState {
  slides: ReactElement[];
  diagnostics: Diagnostic[];
  fileName: string;
}

function App(): ReactElement {
  const [state, setState] = useState<RenderState | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToWebview>) => {
      const message = event.data;
      if (message?.type !== 'source-updated') return;
      const scope = {
        bindings: { ...STATIC_TOKENS, ...message.assets },
      };
      const result = loadDeck({
        source: message.source,
        file: message.fileName,
        components,
        scope,
      });
      setState({
        slides: result.slides,
        diagnostics: result.diagnostics,
        fileName: message.fileName,
      });
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  if (!state) {
    return <div className="status">waiting for source…</div>;
  }

  const errors = state.diagnostics.filter((d) => d.severity === 'error');
  const slide = state.slides[0];
  const slideExists = Boolean(slide);

  return (
    <>
      <div className="status">
        {state.fileName.split('/').pop()} · slide 1 of {state.slides.length}
      </div>
      {errors.length > 0 ? <DiagnosticsPanel diagnostics={errors} /> : null}
      {slideExists ? <ScaledCanvas>{slide}</ScaledCanvas> : null}
    </>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostic[] }): ReactElement {
  return (
    <pre className="diagnostics" data-severity="error">
      {diagnostics.map(formatDiagnostic).join('\n')}
    </pre>
  );
}

// Auto-scaled canvas: a 1920x1080 design surface scaled to fit the
// available panel space. ResizeObserver-driven so the canvas re-fits
// as the user drags the VS Code panel divider. Mirrors the geometry
// logic in src/Presentation.jsx without its other concerns (popout
// notes, localStorage, document title).
const DESIGN_W = 1920;
const DESIGN_H = 1080;

function ScaledCanvas({ children }: { children: ReactNode }): ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const fit = () => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      if (w === 0 || h === 0) return;
      setScale(Math.min(w / DESIGN_W, h / DESIGN_H));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // Mirror the existing scaffold's structure so styles.css's
  // `.presentation`, `.presentation-canvas`, and `section.slide.active`
  // rules apply. The slide arrives unprepped (no `active` prop);
  // cloneElement adds it so the .active visibility rule kicks in.
  const slideEl = isReactElement(children)
    ? cloneElement(children, { active: true } as Record<string, unknown>)
    : children;

  return (
    <div className="presentation" ref={wrapperRef}>
      <div
        className="presentation-canvas"
        style={{
          width: `${DESIGN_W}px`,
          height: `${DESIGN_H}px`,
          transform: `scale(${scale})`,
          ['--deck-design-w' as string]: `${DESIGN_W}px`,
          ['--deck-design-h' as string]: `${DESIGN_H}px`,
        }}
      >
        {slideEl}
      </div>
    </div>
  );
}

function isReactElement(node: ReactNode): node is ReactElement {
  return (
    node !== null &&
    typeof node === 'object' &&
    'type' in (node as object) &&
    'props' in (node as object)
  );
}

// ── Mount ─────────────────────────────────────────────────────────────

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Slidewright canvas: #root not found.');
}
createRoot(rootEl).render(<App />);
