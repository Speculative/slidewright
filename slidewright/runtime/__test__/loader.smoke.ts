// Smoke-test the loader against the v0 reference deck source. Runs in
// Node — uses fs to read the deck.sw and a stub registry. This catches
// schema/validation issues without needing a browser.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDeck } from '../loader.js';
import { buildRegistry } from '../contract.js';
import { formatDiagnostic } from '../diagnostics.js';

import * as TitleSlide from '../../../decks/v0-reference/components/TitleSlide.js';
import * as ContentSlide from '../../../decks/v0-reference/components/ContentSlide.js';
import * as CardRow from '../../../decks/v0-reference/components/CardRow.js';
import * as VStack from '../../../decks/v0-reference/components/VStack.js';
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

console.log(`OK: deck loaded, ${result.slides.length} slide(s)`);
console.log(`   meta:`, result.meta);
