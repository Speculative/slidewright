// Round-trip property tests for the v0.2.a text-edit gesture.
//
// For any deck source S and any sequence of single-string text edits
// (the same source-replacement that App's text-edit handler does),
// we assert:
//   1. Each edit produces source that re-parses with no errors.
//   2. The resulting AST's structural shape (component tree, slot
//      names, list shape, value kinds) is preserved — only string
//      values change.
//
// Hand-rolled rather than reaching for fast-check because the
// generator surface here is narrow and a deterministic LCG suffices
// for reproducibility. v0.2.c (canonical re-emit) will extend the
// property to "parse → emit → parse → equal" once the emitter exists.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  Component,
  ListLit,
  Node,
  SlotFill,
  SourceFile,
  StringLit,
  Value,
} from '../ast.js';
import { formatDiagnostic } from '../diagnostics.js';
import { emit } from '../emitter.js';
import { parse } from '../parser.js';

const ITERATIONS = 200;
const SEEDS = [1, 2, 3, 42, 1729];

// Linear congruential RNG. Same parameters as glibc's rand(). Returns
// 0 ≤ x < 1. Deterministic given a seed.
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return (state >>> 16) / 0xffff;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randomString(rng: () => number): string {
  // Length 0–24, drawn from a pool that includes characters with
  // special handling: quotes, backslashes, braces, newlines,
  // non-ASCII. JSON.stringify is responsible for escaping; the
  // property test confirms the parser then accepts the encoded form.
  const POOL = 'abcdefghijklmnopqrstuvwxyz ABC0123!?,.-"\\\n{}[]·…';
  const len = Math.floor(rng() * 25);
  let out = '';
  for (let i = 0; i < len; i++) out += pick(rng, POOL.split(''));
  return out;
}

// Walk an AST and collect every StringLit that the gesture would
// allow editing (i.e., not triple-quoted). Multiline is skipped to
// match wrapEditableString in loader.ts.
function collectEditableStrings(node: Node | Value): StringLit[] {
  const out: StringLit[] = [];
  visit(node, (n) => {
    if (n.kind === 'string' && !n.multiline) out.push(n);
  });
  return out;
}

function visit(node: Node | Value, fn: (n: Node | Value) => void): void {
  fn(node);
  switch (node.kind) {
    case 'source_file':
      for (const c of node.items) visit(c, fn);
      return;
    case 'component':
      for (const f of node.fills) visit(f, fn);
      for (const c of node.implicitChildren) visit(c, fn);
      return;
    case 'slot_fill':
      visit(node.value, fn);
      return;
    case 'list':
      for (const v of node.items) visit(v, fn);
      return;
    default:
      return;
  }
}

// Normalized structural shape — spans and string values stripped.
// Two ASTs with the same shape differ only in string contents and
// in how long each string took up in source. Used to assert that
// text-edit gestures don't perturb the broader tree.
type Shape =
  | { kind: 'source_file'; items: Shape[] }
  | { kind: 'component'; name: string; fills: Shape[]; implicit: Shape[] }
  | { kind: 'slot_fill'; name: string; value: Shape }
  | { kind: 'string'; multiline: boolean }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'list'; items: Shape[] }
  | { kind: 'name_ref'; name: string };

function shapeOf(node: Node | Value): Shape {
  switch (node.kind) {
    case 'source_file':
      return { kind: 'source_file', items: node.items.map(shapeOf) as Shape[] };
    case 'component':
      return {
        kind: 'component',
        name: node.name,
        fills: node.fills.map(shapeOf) as Shape[],
        implicit: node.implicitChildren.map(shapeOf) as Shape[],
      };
    case 'slot_fill':
      return { kind: 'slot_fill', name: node.name, value: shapeOf(node.value) };
    case 'string':
      return { kind: 'string', multiline: node.multiline };
    case 'number':
      return { kind: 'number', value: node.value };
    case 'boolean':
      return { kind: 'boolean', value: node.value };
    case 'null':
      return { kind: 'null' };
    case 'list':
      return { kind: 'list', items: node.items.map(shapeOf) as Shape[] };
    case 'name_ref':
      return { kind: 'name_ref', name: node.name };
  }
}

function shapesEqual(a: Shape, b: Shape): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface Failure {
  iteration: number;
  reason: string;
  details: string;
}

function runProperty(label: string, source: string, seed: number): Failure | null {
  const rng = makeRng(seed);
  const initial = parse(source, `<rt:${label}:${seed}>`);
  if (initial.diagnostics.some((d) => d.severity === 'error')) {
    return {
      iteration: 0,
      reason: 'initial parse failed',
      details: initial.diagnostics.map(formatDiagnostic).join('\n'),
    };
  }
  // Reference shape: the structure we expect to be preserved across
  // all subsequent edits. Note this expects adjacency-merged strings
  // to stay merged (so the count of StringLit nodes is invariant).
  const initialShape = shapeOf(initial.ast);

  let current = source;
  let currentAst: SourceFile = initial.ast;

  for (let i = 0; i < ITERATIONS; i++) {
    const editable = collectEditableStrings(currentAst);
    if (editable.length === 0) break;

    const target = pick(rng, editable);
    const newValue = randomString(rng);
    const newSource =
      current.substring(0, target.span.start.offset) +
      JSON.stringify(newValue) +
      current.substring(target.span.end.offset);

    const result = parse(newSource, `<rt:${label}:${seed}:${i}>`);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      return {
        iteration: i,
        reason: 'parse error after edit',
        details:
          errors.map(formatDiagnostic).join('\n') +
          `\n--- new source ---\n${newSource}`,
      };
    }
    const newShape = shapeOf(result.ast);
    if (!shapesEqual(initialShape, newShape)) {
      return {
        iteration: i,
        reason: 'shape diverged after edit',
        details: `expected: ${JSON.stringify(initialShape)}\nactual:   ${JSON.stringify(newShape)}\nedit value: ${JSON.stringify(newValue)}`,
      };
    }

    current = newSource;
    currentAst = result.ast;
  }

  return null;
}

const cases: { label: string; source: string }[] = [
  {
    label: 'v0-reference',
    source: readFileSync(
      resolve(process.cwd(), 'decks/v0-reference/deck.sw'),
      'utf8',
    ),
  },
  {
    label: 'inline-comma',
    source: `Card { color: purple, eyebrow: "Representation", heading: "Code isn't behavior." }`,
  },
  {
    label: 'adjacent-strings',
    source: `Box { intro: "first part " "second part" "third part" }`,
  },
  {
    label: 'mixed-list',
    source: `Title { title: ["plain " Span { color: accent, content: "fancy" } " plain"] }`,
  },
  {
    label: 'comments',
    source:
      `// top of file comment\n` +
      `// continuation\n\n` +
      `Deck {\n` +
      `  // before name\n` +
      `  name: "x"\n` +
      `  // before slides\n` +
      `  slides: [\n` +
      `    Slide { content: TitleSlide { title: "y" } }\n` +
      `  ]\n` +
      `  // end-of-block\n` +
      `}\n`,
  },
];

let failures = 0;
for (const c of cases) {
  for (const seed of SEEDS) {
    const failure = runProperty(c.label, c.source, seed);
    if (failure) {
      failures += 1;
      console.log(`FAIL [edit] ${c.label} seed=${seed} iter=${failure.iteration}: ${failure.reason}`);
      console.log(failure.details);
      console.log('---');
    } else {
      console.log(`OK   [edit] ${c.label} seed=${seed} (${ITERATIONS} iterations)`);
    }
  }
}

// ── Emitter property: parse → emit → parse → shape-equal ──────────────
//
// For each test source, parse it to an AST, run the emitter to produce
// canonical source, re-parse, and assert the shape is unchanged. Also
// asserts emit(parse(emit(parse(s)))) === emit(parse(s)) — the emitter
// is idempotent: a second pass through canonicalization yields no
// further changes.
for (const c of cases) {
  const initial = parse(c.source, `<emit:${c.label}>`);
  const errs = initial.diagnostics.filter((d) => d.severity === 'error');
  if (errs.length > 0) {
    failures += 1;
    console.log(`FAIL [emit] ${c.label}: initial parse failed`);
    console.log(errs.map(formatDiagnostic).join('\n'));
    continue;
  }
  const initialShape = shapeOf(initial.ast);
  const emitted = emit(initial.ast);
  const reparsed = parse(emitted, `<emit:${c.label}:re>`);
  const reErrs = reparsed.diagnostics.filter((d) => d.severity === 'error');
  if (reErrs.length > 0) {
    failures += 1;
    console.log(`FAIL [emit] ${c.label}: re-parse of emitted source failed`);
    console.log(reErrs.map(formatDiagnostic).join('\n'));
    console.log(`--- emitted source ---\n${emitted}`);
    continue;
  }
  if (!shapesEqual(initialShape, shapeOf(reparsed.ast))) {
    failures += 1;
    console.log(`FAIL [emit] ${c.label}: shape diverged after parse → emit → parse`);
    console.log(`--- emitted source ---\n${emitted}`);
    continue;
  }
  // Idempotence check.
  const emitted2 = emit(reparsed.ast);
  if (emitted !== emitted2) {
    failures += 1;
    console.log(`FAIL [emit] ${c.label}: emitter not idempotent`);
    continue;
  }
  console.log(`OK   [emit] ${c.label} (parse → emit → parse equal; idempotent)`);
}

if (failures > 0) {
  console.log(`\n${failures} property failure(s).`);
  process.exit(1);
} else {
  console.log(
    `\nall ${cases.length * SEEDS.length + cases.length} property runs passed.`,
  );
}
