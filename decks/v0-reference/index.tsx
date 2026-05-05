// v0 reference deck — entry point. Imports the .sw source as raw text
// (Vite built-in `?raw`), wires components and asset scope, runs the
// Slidewright loader, and exports {meta, slides, notes} for the
// existing scaffold's <Presentation> runtime.

import deckSource from './deck.sw?raw';
import headshotImg from './headshot.jpg';

import { loadDeck } from '../../slidewright/runtime/loader.js';
import { buildRegistry } from '../../slidewright/runtime/contract.js';
import { formatDiagnostic } from '../../slidewright/runtime/diagnostics.js';

import * as TitleSlide from './components/TitleSlide.js';
import * as ContentSlide from './components/ContentSlide.js';
import * as CardRow from './components/CardRow.js';
import * as VStack from './components/VStack.js';

const components = buildRegistry({
  TitleSlide,
  ContentSlide,
  CardRow,
  VStack,
});

const scope = {
  bindings: {
    headshotImg,
    // Color-token names — surface in the DSL as bare lowercase identifiers
    // (e.g., `color: purple`). v0.0 has no theme system; the renderer
    // converts these to `var(--<name>)` via the existing styles.css palette.
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
