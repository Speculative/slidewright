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

import { cloneElement, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { loadDeck } from '../runtime/loader.js';
import type { Diagnostic } from '../runtime/diagnostics.js';
import { components, staticTokens } from '../../decks/v0-reference/registry.js';
import { DeckMetaContext } from '../../src/Slide.jsx';

import type { Host } from './host.js';
import { ScaledCanvas } from './ScaledCanvas.js';
import { DiagnosticsPanel } from './DiagnosticsPanel.js';

interface DeckMeta {
  name: string;
  subtitle: string;
}

interface RenderState {
  slides: ReactElement[];
  diagnostics: Diagnostic[];
  fileName: string;
  meta: DeckMeta;
}

// Pre-Section slides in the existing scaffold show "Setup" in the
// chrome's act position (Presentation.jsx:67 — `let actLabel =
// setupLabel`, default "Setup"). v0.1's canvas doesn't yet model
// Section dividers / acts, so all slides land in the pre-Section
// "Setup" act. v0.2+ will track acts when navigation lands.
const DEFAULT_ACT_LABEL = 'Setup';

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
        meta: { name: result.meta.name, subtitle: result.meta.subtitle },
      });
    });
  }, [host]);

  if (!state) {
    return <div className="sw-canvas-status">waiting for source…</div>;
  }

  const errors = state.diagnostics.filter((d) => d.severity === 'error');
  const slide = state.slides[0];
  const total = state.slides.length;

  // Inject the props that Presentation.jsx normally adds: active=true
  // (so styles.css's `.slide.active` visibility rule kicks in) and
  // actLabel (so the chrome's third crumb segment isn't blank).
  // cloneElement merges with existing props from the loader (idx,
  // notes, label).
  const preparedSlide = slide
    ? cloneElement(slide, {
        active: true,
        actLabel: DEFAULT_ACT_LABEL,
      } as Record<string, unknown>)
    : null;

  return (
    <>
      <div className="sw-canvas-status">
        {state.fileName.split('/').pop()} · slide 1 of {total}
      </div>
      <DiagnosticsPanel diagnostics={errors} />
      {preparedSlide ? (
        <DeckMetaContext.Provider
          value={{
            name: state.meta.name,
            subtitle: state.meta.subtitle,
            total,
          }}
        >
          <ScaledCanvas>{preparedSlide}</ScaledCanvas>
        </DeckMetaContext.Provider>
      ) : null}
    </>
  );
}
