// v0 reference deck — entry point for the existing src/App.jsx +
// Presentation runtime. Imports the .sw source as raw text (Vite
// `?raw`), wires it through the loader, and exports {meta, slides,
// notes} for the scaffold to consume.
//
// The component registry and static color tokens live in
// ./registry.ts so they can be shared with the standalone canvas
// host (which doesn't go through this file's Vite-specific imports).

import deckSource from './deck.sw?raw';
import headshotImg from './headshot.jpg';

import { loadDeck } from '../../slidewright/runtime/loader.js';
import { formatDiagnostic } from '../../slidewright/runtime/diagnostics.js';

import { components, staticTokens } from './registry.js';

const scope = {
  bindings: {
    headshotImg,
    ...staticTokens,
  },
};

const result = loadDeck({
  source: deckSource,
  file: 'decks/v0-reference/deck.sw',
  components,
  scope,
});

if (result.diagnostics.some((d) => d.severity === 'error')) {
  // Surface diagnostics during dev; HMR re-runs this on edits.
  // eslint-disable-next-line no-console
  console.error(
    'Slidewright diagnostics:\n' +
      result.diagnostics.map(formatDiagnostic).join('\n'),
  );
}

export const meta = result.meta;
export const slides = result.slides;
// Speaker notes for the existing notes-popout bridge. The Slide.jsx
// scaffold reads `notes` off each <Slide> element, but extractNotes()
// expects an array; we already have one through the loader.
export const notes = slides.map(
  (slide) => (slide.props as { notes?: string }).notes ?? '',
);
