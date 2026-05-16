// Server-side render smoke test. Walks the v0 reference deck through
// the Slidewright loader and renders each slide to HTML via
// react-dom/server, then asserts on content the deck author actually
// types — slide labels and slide text — rather than CSS classes or
// other implementation details.
//
// Keyed by slide label (the `label:` fill on each Slide) rather than
// array index so adding new slides to the demo deck doesn't shift
// every expectation. Unknown labels in the deck are not failures —
// the deck is a showcase that grows over time; this test only
// asserts that the slides it cares about still render correctly.
// Conversely, a label declared in `expected` but missing from the
// deck IS a failure (the demo deck dropped a feature this test
// pins).
//
// What this is for: catching React render errors (a component
// throws during render, a missing prop, etc.) and rendered-output
// regressions on the full loader→render path — without a browser.
// Specific layout / CSS / pointer behavior belongs in Playwright.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { loadDeck, type SlideAstData } from '../loader.js';
import { buildRegistry } from '../contract.js';
import { formatDiagnostic } from '../diagnostics.js';

import * as TitleSlide from '../../../decks/v0-reference/components/TitleSlide.js';
import * as ContentSlide from '../../../decks/v0-reference/components/ContentSlide.js';
import * as CardRow from '../../../decks/v0-reference/components/CardRow.js';
import * as VStack from '../../../decks/v0-reference/components/VStack.js';
import * as HStack from '../../../decks/v0-reference/components/HStack.js';
import * as Freeform from '../../../decks/v0-reference/components/Freeform.js';
import * as Box from '../../../decks/v0-reference/components/Box.js';
import * as TextBox from '../../../decks/v0-reference/components/TextBox.js';
import * as Arrow from '../../../decks/v0-reference/components/Arrow.js';

const deckPath = resolve(process.cwd(), 'decks/v0-reference/deck.sw');
const source = readFileSync(deckPath, 'utf8');

const components = buildRegistry({
  TitleSlide,
  ContentSlide,
  CardRow,
  VStack,
  HStack,
  Freeform,
  Box,
  TextBox,
  Arrow,
});
const scope = {
  bindings: {
    headshotImg: '/decks/v0-reference/headshot.jpg',
    accent: 'accent',
    purple: 'purple',
    cyan: 'cyan',
    magenta: 'magenta',
    amber: 'amber',
    mono: 'mono',
  },
};

const result = loadDeck({
  source,
  file: 'decks/v0-reference/deck.sw',
  components,
  scope,
});

const errs = result.diagnostics.filter((d) => d.severity === 'error');
if (errs.length > 0) {
  console.log(`FAIL: ${errs.length} diagnostic(s):`);
  for (const e of errs) console.log('  ', formatDiagnostic(e));
  process.exit(1);
}

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`OK   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

// Per-slide expectations, keyed by the slide's `label:` fill (which
// the deck author maintains as a human-readable identifier). Each
// needle should be a substring the deck author *wrote* — slide text,
// shape positions/colors that are pinned by source — rather than
// CSS class names or other downstream implementation details that
// can change under a component refactor.
const expected: Record<string, string[]> = {
  Title: [
    'Vibe Debugging with',
    'autopsy-report',
    'Jeffrey Tao',
    'Penn HCI Lab',
    '/decks/v0-reference/headshot.jpg',
    'or: towards comprehending agent-written code',
    'SLIDEWRIGHT · v0.0',
  ],
  'Freeform demo': [
    // Boxes are absolutely positioned; SSR output includes their
    // inline coordinate styles (React serializes style without
    // spaces around colons).
    'left:200px',
    'top:220px',
    'left:760px',
    'left:1240px',
    // First box uses `fill: brand` where `brand` is source-declared
    // (`Deck.tokens`) — name_ref → ctx.colorTokens resolution.
    'oklch(0.55 0.18 285)',
    // Second box uses `fill: cyan` — registry token → var(--name).
    'var(--cyan)',
    // Third box uses a direct color_oklch literal.
    'oklch(0.62 0.22 25)',
  ],
  'Three obstacles': [
    'Three obstacles',
    'Behavior is hidden by default',
    'Programs do a lot, and most of it is invisible by default',
    'Representation',
    "Code isn",
    'Attention',
    'mostly noise',
    'Volume',
    'too much stuff',
  ],
  'Stacks demo': [
    'Children flow vertically',
    'Spacing',
    'Drives the flex gap',
  ],
};

// Build the deck-side index: label → rendered HTML.
const renderedByLabel = new Map<string, string>();
result.slides.forEach((slide, i) => {
  const label = slideLabel(result.slidesData[i]);
  if (label === null) {
    // Slides without a label render but can't be addressed by this
    // test. Skip — a labelless slide isn't a failure; it just can't
    // be pinned to expectations.
    return;
  }
  const html = renderToStaticMarkup(createElement(() => slide, {}));
  renderedByLabel.set(label, html);
});

for (const [label, needles] of Object.entries(expected)) {
  const html = renderedByLabel.get(label);
  if (!html) {
    check(`slide labeled "${label}" exists in deck`, false);
    continue;
  }
  for (const needle of needles) {
    check(
      `slide "${label}" contains ${JSON.stringify(needle)}`,
      html.includes(needle),
    );
  }
}

function slideLabel(s: SlideAstData | undefined): string | null {
  if (!s) return null;
  const fill = s.comp.fills.find((f) => f.name === 'label');
  if (!fill || fill.value.kind !== 'string') return null;
  return fill.value.value;
}

if (failures > 0) {
  console.log(`\n${failures} failing assertion(s).`);
  process.exit(1);
}
console.log('\nall ssr assertions passed.');
