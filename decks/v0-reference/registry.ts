// v0-reference deck registry — host-agnostic.
//
// Both the VS Code webview and the standalone web app import this to
// get the deck's component registry and the static color/font tokens
// that live in the deck scope. This file deliberately avoids any
// Vite-specific imports (`?raw`, image-as-URL) so esbuild can bundle
// it for the webview cleanly. Asset URIs are supplied per-host.
//
// v0.2 will replace this hand-curated registry with an on-the-fly
// loader that scans the deck dir; this file is the simplest possible
// stand-in for that pipeline.

import { buildRegistry } from '../../slidewright/runtime/contract.js';

import * as TitleSlide from './components/TitleSlide.js';
import * as ContentSlide from './components/ContentSlide.js';
import * as CardRow from './components/CardRow.js';
import * as VStack from './components/VStack.js';
import * as Freeform from './components/Freeform.js';
import * as Box from './components/Box.js';
import * as TextBox from './components/TextBox.js';
import * as Arrow from './components/Arrow.js';

export const components = buildRegistry({
  TitleSlide,
  ContentSlide,
  CardRow,
  VStack,
  Freeform,
  Box,
  TextBox,
  Arrow,
});

// Color/font token names that the .sw uses as bare lower-cased
// references. The renderer turns them into `var(--<name>)` via the
// existing styles.css palette; we just need them resolvable in scope.
export const staticTokens: Record<string, string> = {
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
  fg: 'fg',
  bg: 'bg',
  muted: 'muted',
};
