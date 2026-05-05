# Slidewright handoff

You're picking up Slidewright development. **v0.0 is implemented** (read-only viewer); v0.1 (VS Code extension with read-only canvas) is the next milestone. This document is your entry point.

## What Slidewright is

A projectional editor for code-based slide decks, intended for human/AI co-authoring of richly designed, animated, structured slides. The substrate is a typed component tree expressed in a custom DSL with TypeScript/React for component internals. The editor presents direct manipulation over the rendered tree; edits round-trip back to source.

The bet: bidirectional projectional editing of a typed component tree, with stable round-tripping, works.

## Where things live

- **`SLIDEWRIGHT.md`** (repo root) — design doc. Source of truth for design commitments. Read this first.
- **`design/sketches/`** — worked DSL examples with commentary.
- **`decks/ne-agents-day-2026/`** — the existing React+JSX slide deck (NOT Slidewright source). Reference target we want to be able to recreate in Slidewright.
- **`decks/v0-reference/`** — the v0.0 demo deck, written in Slidewright DSL with custom components. `deck.sw` + `index.tsx` + `components/`.
- **`src/`** — the existing slide-template scaffold (`Presentation.jsx`, `Slide.jsx`, `CodeBlock.jsx`). Slidewright integrates with this scaffold rather than reinventing slide-runtime concerns. Currently `App.jsx` loads the v0.0 demo deck; swap the import to load a different deck.
- **`slidewright/`** — the Slidewright package itself.
  - `grammar/grammar.js` — brace-block grammar in tree-sitter's declarative form. Used as a precise specification of the syntax the runtime parser tracks; tree-sitter itself is not in the build (see "Tree-sitter investigation" below).
  - `runtime/parser.ts` — hand-rolled recursive-descent parser. The committed approach per `SLIDEWRIGHT.md / Mediation layer / Parser`.
  - `runtime/lexer.ts`, `ast.ts`, `diagnostics.ts`, `cells.ts`, `contract.ts`, `scope.ts`, `loader.ts` — supporting modules.
  - `runtime/__test__/` — smoke tests (parser, loader, SSR).
  - `cli/validate.ts` — `slidewright validate` CLI.

## v0.0 status: implemented

What works:

- DSL parsing for the brace-block surface syntax (component invocations, slot fills, lists, capitalization disambiguation, triple-quoted strings with dedent, adjacent simple-string concatenation, line+block comments, implicit children).
- Slide-component contract loading and slot-schema validation.
- Cell runtime with `resolve(handle, context): T` interface; `(handle, context)`-keyed cache; literal layer only (no computed defaults yet).
- React rendering: walks the AST, dispatches each component to its default React export with `{slots, params}`, drops into the existing `<Presentation>` runtime.
- The reference deck `decks/v0-reference/deck.sw` renders end-to-end (verified via SSR + smoke tests).
- `slidewright validate` CLI with `--parse-only`, `--check-refs`, `--json` flags.

How to run:

```sh
npm run dev          # vite dev server; v0.0 demo deck is wired into App.jsx
npm test             # typecheck + parser + loader + SSR smoke tests
npm run slidewright -- decks/v0-reference/deck.sw     # validate a deck
```

### Tree-sitter investigation

Slidewright ships a hand-rolled recursive-descent parser. Tree-sitter was investigated as the alternative; the investigation is captured here so the next agent doesn't re-litigate without context.

What tree-sitter would have given us:
- Declarative grammar (low maintenance for many-grammar projects).
- Automatic error recovery via the GLR machinery.
- Incremental parsing.
- A round-trippable CST with positions and trivia.

What it would have cost:
- A WASM artifact in the repo (the JS API path requires compiled WASM via `web-tree-sitter`; tree-sitter doesn't have a pure-JS target).
- A `tree-sitter generate` + `tree-sitter build --wasm` step in the build process, which needs emscripten or Docker.
- A diagnostics ceiling that doesn't reach where we want to be ("expected X, got Y" structural errors vs the slot-type-aware hints SLIDEWRIGHT.md / AI authoring calls for).

What the actual SOTA looks like for diagnostics-quality-prioritizing single-language toolchains: hand-rolled recursive descent. Every primary language toolchain that prioritizes IDE-grade diagnostics is hand-rolled — rustc / rust-analyzer, Roslyn for C#, the TypeScript compiler, Clang, the Swift compiler. Tree-sitter's most-loved use cases (atom/zed/neovim/GitHub highlighter) are syntax highlighting and generic IDE plumbing across many languages, not primary toolchains.

For Slidewright specifically:
- We have one grammar to maintain — the declarative-grammar economy doesn't apply.
- Diagnostics quality is a stated priority.
- The grammar is small and the recovery synchronization points are well-defined (slide-level, brace-body-level, value-level), so recovery is bounded work, not open-ended risk.
- Incremental parsing isn't load-bearing — slide files are small and we re-parse at gesture-commit, not at mouse-move.
- The canonical emitter is our own work either way; tree-sitter's CST gives us trivia for free but doesn't write the emitter.

Triggers for re-opening the question:
- Recovery code becomes a maintenance burden across new gestures.
- We want syntax highlighting in environments outside our own editor (Vim, VS Code's TextMate grammars, GitHub) — they ingest tree-sitter grammars natively.
- We add a second grammar dialect.

Until then: `slidewright/grammar/grammar.js` is preserved as a precise specification of the brace-block grammar in tree-sitter's standard form, useful documentation regardless of the runtime path. Treat divergences between grammar.js and parser.ts as bugs in either, depending on which is more clearly "right" for the case.

### Built-in `Slide`

A v0.0-shaped decision: the deck author wraps each slide in a built-in `Slide { content: ... }` invocation that maps to the existing `src/Slide.jsx` React component. This keeps the contract uniform — no hidden "frame slot" magic — and gives the deck author explicit control over `label`, `notes`, `chromeless`. May be revisited if it feels boilerplatey in practice.

## Where to start: v0.1

v0.1 adds a VS Code extension with a read-only canvas: side-by-side source + rendered view, file-watcher → re-parse → re-render, selection sync between source and canvas. No editing gestures yet.

Concretely (from `SLIDEWRIGHT.md / v0 sequencing`):

1. VS Code extension scaffolding; webview integration.
2. Side-by-side: source panel + canvas.
3. Selection sync: click an element in canvas → highlight in source; cursor in source → highlight in canvas.
4. File-watcher → re-parse → re-render. No editing gestures yet.

The runtime is largely ready — the loader produces React elements with stable cell ids; the canvas just needs to host the existing `Presentation` and add selection sync on top.

## Open implementation decisions surfaced during v0.0

- **Asset import mechanism.** Currently the deck's `index.tsx` imports each asset and registers it in a `scope.bindings` map. Works fine. A future refinement: auto-import via a manifest or filename convention (so the DSL author doesn't have to also add a TS line per asset).
- **Color tokens as scope bindings.** v0.0 maps token names (`accent`, `purple`, `cyan`) to themselves in the scope, with the renderer turning the resolved string into `var(--<token>)`. This works but is structurally fuzzy: tokens aren't quite name-bindings, and a real theme system would resolve these differently. Captured in SLIDEWRIGHT.md / Styling **OPEN** section.
- **CLI scope vs. runtime scope.** `slidewright validate` runs without the deck's runtime scope (the deck's `index.tsx` isn't visible to a standalone CLI). Defaulted `--check-refs` off, with the flag to opt in. Long-term: have the CLI optionally `import()` the deck's `index.tsx` to extract the scope.
- **Notes string round-trip.** Triple-quoted strings dedent via Python rules at the lexer; the result is what the loader passes to `<Slide notes=...>`. Round-trip emit (v0.2) needs to preserve the original trip-quoted form, not re-emit a dedented form, so the lexer should attach the original raw content to the AST node. Reserved.

## What v0.0 does NOT do

Resist temptation to build any of these:

- Computed defaults / `solve.*` forms (v0.2+).
- Round-trip emit (v0.2 — read-only viewer doesn't need to write).
- Canvas / direct manipulation gestures (v0.2+).
- VS Code extension / webview integration (v0.1).
- External-edit reconciliation, undo stacks (v0.4).
- Markdown rendering in `text-markdown` slots (v0.5 polish).
- Animation features (post-v0).

## Key files to update as you go

- **`SLIDEWRIGHT.md`** — promote TENTATIVE → DECIDED as choices get validated by experience. Add new OPEN questions. Don't let it go stale.
- **`design/sketches/`** — when you validate a sketch by implementing against it, update the sketch's commentary with what you learned.
- **This file (`HANDOFF.md`)** — keep it terse. Update the "Status" section as phases complete.

## Build process

Per `SLIDEWRIGHT.md / Build process and decision-making`:

1. Build narrowly. Don't generalize beyond what the current phase needs, but don't bake in assumptions that preclude later generalization.
2. Test the round-trip property aggressively once v0.2+ lands. Property-based testing.
3. Document decisions in SLIDEWRIGHT.md as they get made.
4. Resist scope creep. Animations, AI, structured diagrams are all exciting and tempting. Don't.
5. Revisit decisions when implementation reveals new information. The DSL syntax, the contract shape, the gesture semantics, and the implicit-children rule are all things that may evolve once v0.0 + v0.1 are real.

## One asymmetry worth holding in mind

The contract is the only Slidewright architectural piece with external consumers (user-authored components, eventually AI-generated components, eventually shared component libraries across decks). Iterate freely on internal architecture; commit to contract stability only when external consumers exist. v0 has no external consumers yet.
