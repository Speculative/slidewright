// esbuild driver for the Slidewright VS Code extension.
//
// VS Code extensions ship as CommonJS bundles with `vscode` left
// external (provided by the extension host). The bundle is the file
// referenced from extension/package.json's `main`.
//
// Usage:
//   node extension/esbuild.mjs           # one-shot build
//   node extension/esbuild.mjs --watch   # watch mode for dev iteration

import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const buildOptions = {
  entryPoints: [resolve(here, 'src/extension.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode'],
  outfile: resolve(here, 'dist/extension.js'),
  sourcemap: true,
  logLevel: 'info',
};

const isWatch = process.argv.includes('--watch');
if (isWatch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  // Keep the process alive — ctx.watch() returns immediately once the
  // watcher is registered.
  console.log('esbuild watching extension/src…');
} else {
  await build(buildOptions);
}
