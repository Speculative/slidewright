// esbuild driver for the Slidewright VS Code extension.
//
// Two bundle targets:
//   1. dist/extension.js — extension host. CJS, Node, `vscode` external.
//      This is what package.json's `main` field references.
//   2. dist/webview.js   — webview iframe. IIFE, browser, no externals.
//      Loaded by canvas.ts via webview.asWebviewUri.
//
// Usage:
//   node extension/esbuild.mjs           # one-shot build of both
//   node extension/esbuild.mjs --watch   # watch mode for dev iteration

import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const targets = [
  {
    name: 'extension',
    options: {
      entryPoints: [resolve(here, 'src/extension.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      external: ['vscode'],
      outfile: resolve(here, 'dist/extension.js'),
      sourcemap: true,
      logLevel: 'info',
    },
  },
  {
    name: 'webview',
    options: {
      entryPoints: [resolve(here, 'src/webview/index.ts')],
      bundle: true,
      platform: 'browser',
      target: 'es2022',
      format: 'iife',
      outfile: resolve(here, 'dist/webview.js'),
      sourcemap: true,
      logLevel: 'info',
    },
  },
];

const isWatch = process.argv.includes('--watch');
if (isWatch) {
  await Promise.all(
    targets.map(async (t) => {
      const ctx = await context(t.options);
      await ctx.watch();
    }),
  );
  console.log('esbuild watching extension/src… (extension + webview)');
} else {
  await Promise.all(targets.map((t) => build(t.options)));
}
