// Slidewright canvas — host-agnostic React app.
//
// Receives source-of-truth from a Host (VSCodeHost in the extension,
// StandaloneHost in the standalone web app), runs the slidewright
// runtime against it, and renders the active slide via ScaledCanvas.
//
// The deck-specific bits (component registry, static color tokens) are
// imported from decks/v0-reference/registry. v0.2 will replace this
// with an on-the-fly deck loader; for v0.1 the canvas is hardcoded to
// v0-reference.

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { loadDeck } from '../runtime/loader.js';
import type { Diagnostic } from '../runtime/diagnostics.js';
import { components, staticTokens } from '../../decks/v0-reference/registry.js';

import type { Host } from './host.js';
import { ScaledCanvas } from './ScaledCanvas.js';
import { DiagnosticsPanel } from './DiagnosticsPanel.js';

interface RenderState {
  slides: ReactElement[];
  diagnostics: Diagnostic[];
  fileName: string;
}

export function App({ host }: { host: Host }): ReactElement {
  const [state, setState] = useState<RenderState | null>(null);

  useEffect(() => {
    return host.subscribe(({ source, fileName, assets }) => {
      const scope = {
        bindings: { ...staticTokens, ...assets },
      };
      const result = loadDeck({
        source,
        file: fileName,
        components,
        scope,
      });
      setState({
        slides: result.slides,
        diagnostics: result.diagnostics,
        fileName,
      });
    });
  }, [host]);

  if (!state) {
    return <div className="sw-canvas-status">waiting for source…</div>;
  }

  const errors = state.diagnostics.filter((d) => d.severity === 'error');
  const slide = state.slides[0];
  const slideExists = Boolean(slide);

  return (
    <>
      <div className="sw-canvas-status">
        {state.fileName.split('/').pop()} · slide 1 of {state.slides.length}
      </div>
      <DiagnosticsPanel diagnostics={errors} />
      {slideExists ? <ScaledCanvas>{slide}</ScaledCanvas> : null}
    </>
  );
}
