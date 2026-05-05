#!/usr/bin/env -S npx tsx
// `slidewright validate <path>` — parse + slot-schema validate a deck.
// Per SLIDEWRIGHT.md / AI authoring: agents iterate against the validator;
// output is structured (file:line:col + error kind) so they can parse and
// fix without reading prose.
//
// v0.0 limitations:
//   - Components are loaded dynamically from `<deckdir>/components/*.tsx`
//     when present. The validator can also run against a parsed-only mode
//     when components aren't available.
//   - Asset references (name_refs that don't resolve) emit a soft warning
//     in --no-components mode and an error otherwise.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from '../runtime/parser.js';
import { loadDeck } from '../runtime/loader.js';
import { buildRegistry, type ComponentRegistry } from '../runtime/contract.js';
import { formatDiagnostic, type Diagnostic } from '../runtime/diagnostics.js';

interface Options {
  path: string;
  parseOnly: boolean;
  json: boolean;
  checkRefs: boolean;
}

function parseArgs(argv: string[]): Options {
  let parseOnly = false;
  let json = false;
  let checkRefs = false;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === '--parse-only') parseOnly = true;
    else if (arg === '--json') json = true;
    else if (arg === '--check-refs') checkRefs = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      console.error(`unknown option: ${arg}`);
      process.exit(2);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    printHelp();
    process.exit(2);
  }
  return { path: positional[0]!, parseOnly, json, checkRefs };
}

function printHelp(): void {
  console.log(`Usage: slidewright validate <path-to-deck.sw> [options]

Parse and validate a Slidewright deck file. Emits structured diagnostics
for parse errors, schema violations, and unresolved references.

Options:
  --parse-only   Skip schema validation; only check the source parses.
  --check-refs   Also report unresolved name references and missing assets.
                 Off by default — the deck's runtime scope (index.tsx)
                 supplies these and isn't visible to the standalone CLI.
  --json         Emit diagnostics as JSON (for agent consumption).
  -h, --help     Show this help.

Exit code: 0 if no errors; 1 if errors; 2 on usage problems.
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const file = resolve(opts.path);
  if (!existsSync(file)) {
    console.error(`not found: ${file}`);
    process.exit(2);
  }
  const source = readFileSync(file, 'utf8');

  let diagnostics: Diagnostic[] = [];

  if (opts.parseOnly) {
    const r = parse(source, opts.path);
    diagnostics = r.diagnostics;
  } else {
    const components = await tryLoadComponents(file);
    const r = loadDeck({
      source,
      file: opts.path,
      components,
      // Empty scope is the right default for the validator — name refs
      // that need a scope binding will surface as `unknown-reference`,
      // which is what we want.
      scope: { bindings: {} },
    });
    diagnostics = r.diagnostics;
  }

  if (!opts.checkRefs) {
    diagnostics = diagnostics.filter(
      (d) =>
        d.kind !== 'unknown-reference' &&
        d.kind !== 'asset-not-found',
    );
  }

  const errors = diagnostics.filter((d) => d.severity === 'error');

  if (opts.json) {
    process.stdout.write(JSON.stringify({ diagnostics }, null, 2) + '\n');
  } else {
    for (const d of diagnostics) console.log(formatDiagnostic(d));
    if (errors.length === 0) {
      console.log(`OK: ${opts.path} parses and validates`);
    } else {
      console.log(`\n${errors.length} error(s).`);
    }
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

async function tryLoadComponents(deckFile: string): Promise<ComponentRegistry> {
  const dir = dirname(deckFile);
  const componentsDir = join(dir, 'components');
  if (!existsSync(componentsDir)) return {};
  const modules: Record<string, { slidewright?: unknown; default?: unknown }> = {};
  for (const entry of readdirSync(componentsDir)) {
    if (!entry.endsWith('.tsx') && !entry.endsWith('.ts')) continue;
    const name = basename(entry).replace(/\.tsx?$/, '');
    const url = pathToFileURL(join(componentsDir, entry)).href;
    try {
      const mod = (await import(url)) as {
        slidewright?: unknown;
        default?: unknown;
      };
      modules[name] = mod;
    } catch (e) {
      // Component load failures show up as `unknown-component` errors
      // when the deck references them; keep the validator running.
      console.error(`warn: failed to load ${entry}: ${(e as Error).message}`);
    }
  }
  return buildRegistry(modules as Parameters<typeof buildRegistry>[0]);
}

main().catch((e) => {
  console.error(`slidewright validate: ${(e as Error).stack ?? e}`);
  process.exit(2);
});
