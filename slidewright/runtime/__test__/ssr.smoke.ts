// Server-side render smoke test. Walks the v0 reference deck through
// the Slidewright loader and renders each slide to HTML via
// react-dom/server, then asserts on structural shape.
//
// This isn't a substitute for a real browser visual check, but it
// catches React-side bugs (bad children, undefined props, missing
// elements) without needing a chromium binary.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { loadDeck } from '../loader.js';
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

const expected: Array<{ label: string; needles: string[] }> = [
  {
    label: 'slide 1: title',
    needles: [
      'Vibe Debugging with',
      'autopsy-report',
      'Jeffrey Tao',
      'Penn HCI Lab',
      '/decks/v0-reference/headshot.jpg',
      'or: towards comprehending agent-written code',
      'SLIDEWRIGHT · v0.0',
    ],
  },
  {
    label: 'slide 2: freeform demo',
    needles: [
      // Boxes are positioned absolutely; the SSR output should
      // include their inline styles with the expected coordinates.
      // React serializes style without spaces around colons.
      'left:200px',
      'top:220px',
      'left:760px',
      'left:1240px',
      'var(--amber)',
      'var(--cyan)',
      'var(--magenta)',
    ],
  },
  {
    label: 'slide 3: three obstacles',
    needles: [
      'Three obstacles',
      "Behavior is hidden by default",
      'Programs do a lot, and most of it is invisible by default',
      'Representation',
      'Code isn',
      'Attention',
      'mostly noise',
      'Volume',
      'too much stuff',
      'card purple',
      'card cyan',
      'card magenta',
    ],
  },
  {
    label: 'slide 4: stacks demo',
    needles: [
      'VStack',
      'Children flow vertically',
      'Spacing',
      'Drives the flex gap',
      'card purple',
      'card cyan',
    ],
  },
];

result.slides.forEach((slide, i) => {
  const html = renderToStaticMarkup(createElement(() => slide, {}));
  const exp = expected[i];
  if (!exp) {
    check(`slide ${i + 1}: unexpected extra slide`, false);
    return;
  }
  for (const needle of exp.needles) {
    check(`${exp.label} contains ${JSON.stringify(needle)}`, html.includes(needle));
  }
});

if (result.slides.length !== expected.length) {
  check(
    `slide count: expected ${expected.length}, got ${result.slides.length}`,
    false,
  );
}

if (failures > 0) {
  console.log(`\n${failures} failing assertion(s).`);
  process.exit(1);
}
console.log('\nall ssr assertions passed.');
