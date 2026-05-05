# Slidewright handoff

You're picking up Slidewright development. **v0.0 (read-only viewer) and v0.1 (VS Code extension + standalone web app + selection sync) are implemented.** v0.2 (first interactive gesture + round-trip emit) is the next milestone.

## What Slidewright is

A projectional editor for code-based slide decks, intended for human/AI co-authoring of richly designed, animated, structured slides. The substrate is a typed component tree expressed in a custom DSL with TypeScript/React for component internals. The editor presents direct manipulation over the rendered tree; edits round-trip back to source.

The bet: bidirectional projectional editing of a typed component tree, with stable round-tripping, works.

## Where things live

- **`SLIDEWRIGHT.md`** (repo root) — design doc. Source of truth for design commitments. Read this first.
- **`design/sketches/`** — worked DSL examples with commentary.
- **`decks/ne-agents-day-2026/`** — the existing React+JSX slide deck (NOT Slidewright source). Reference target for full-deck v0.5.
- **`decks/v0-reference/`** — the Slidewright demo deck.
  - `deck.sw` — DSL source.
  - `index.tsx` — entry for the Vite-served `Presentation` app at `/` (existing v0.0 demo).
  - `registry.ts` — host-agnostic component registry + static color tokens; imported by both `index.tsx` and the canvas.
  - `components/` — `TitleSlide.tsx`, `ContentSlide.tsx`, `CardRow.tsx`, `VStack.tsx`.
- **`src/`** — Vite-served apps + the existing slide scaffold.
  - `Presentation.jsx`, `Slide.jsx`, `CodeBlock.jsx` — the existing scaffold (kbd nav, popout notes, scaling, print). Used by the multi-slide presentation app at `/`.
  - `App.jsx` — wires `decks/v0-reference/index.tsx` into the `Presentation` runtime (the v0.0 demo).
  - `canvas-standalone.tsx` — entry for the standalone Slidewright canvas at `/canvas.html` (the v0.1+ host-agnostic canvas + bottom-mounted source editor).
  - `standalone-host.ts` — `Host` adapter for the standalone path. Exposes Vite HMR hooks for `.sw` source changes.
- **`canvas.html`** — entry HTML for `/canvas.html`.
- **`extension/`** — VS Code extension package.
  - `package.json` — manifest. `main` points at `dist/extension.js`. Activation events: `onLanguage:slidewright` + `workspaceContains:**/*.sw`.
  - `src/extension.ts` — extension host entry point (activate, command registration, doc-change watcher).
  - `src/canvas.ts` — `SlidewrightCanvasPanel` class (webview lifecycle, message protocol, source/cursor pushes, source-range reveal).
  - `src/webview/index.tsx` — webview bundle entry; mounts `App` from `slidewright/canvas/` against `VSCodeHost`.
  - `src/webview/vscode-host.ts` — `Host` adapter for the webview side.
  - `esbuild.mjs` — two-target build: extension host (CJS, `vscode` external) + webview (browser IIFE, JSX automatic).
- **`slidewright/`** — the Slidewright package.
  - `grammar/grammar.js` — brace-block grammar in tree-sitter's declarative form. Spec-only; tree-sitter is not in the build (see "Tree-sitter investigation" below). Treat divergences with `parser.ts` as bugs in either depending on which is "right" for the case.
  - `runtime/parser.ts` — hand-rolled recursive-descent parser.
  - `runtime/lexer.ts`, `ast.ts`, `diagnostics.ts`, `cells.ts`, `contract.ts`, `scope.ts`, `loader.ts` — supporting modules.
  - `runtime/__test__/` — smoke tests (parser, loader, SSR, headless render).
  - `cli/validate.ts` — `slidewright validate` CLI.
  - **`canvas/`** — host-agnostic canvas UI (v0.1).
    - `host.ts` — `Host` interface (subscribe, sendSelection, onCursorChange?, plus optional editor-pane methods setSource/onSelection/setCursor).
    - `App.tsx` — top-level canvas component (state, keyboard nav, layout, click → source via Host).
    - `ScaledCanvas.tsx` — 1920x1080 design surface auto-fitted to viewport via CSS transform; double-click → host.sendSelection.
    - `SlideStrip.tsx` — vertical thumbnail column; CSS-driven sizing, ResizeObserver-driven scale.
    - `EditorPane.tsx` — `<textarea>` source editor (used by standalone host via `App` siblings; not used by the webview, where VS Code IS the editor).
    - `ResizeHandle.tsx` — generic drag handle for resizing siblings (axis 'x'/'y', invertable).
    - `DiagnosticsPanel.tsx` — error rendering.
    - `canvas.css` — chrome around the slide; the slide content itself uses `src/styles.css`.

## How to run

```sh
# Inside the carthage container:
npm run dev                # Vite dev server on :5173
                           #   /              → multi-slide v0.0 demo (Presentation)
                           #   /canvas.html   → v0.1+ standalone Slidewright canvas
npm test                   # typecheck + parser + loader + SSR smoke tests
npm run code-server        # browser VS Code on :8080 (host-only)
                           #   F5 inside it → Extension Development Host
                           #   Cmd+Shift+P → "Slidewright: Open Canvas"
npm run slidewright -- decks/v0-reference/deck.sw   # validate a deck
npm run extension:build    # build the extension dist/ (run via F5 preLaunchTask too)
npm run extension:watch    # esbuild watch mode for extension dev
```

## v0.0 status: implemented

- DSL parsing for the brace-block surface syntax (component invocations, slot fills, lists, capitalization disambiguation, triple-quoted strings with dedent, adjacent simple-string concatenation, line+block comments, implicit children).
- Slide-component contract loading and slot-schema validation.
- Cell runtime with `resolve(handle, context): T` interface; `(handle, context)`-keyed cache; literal layer only (no computed defaults yet).
- React rendering: walks the AST, dispatches each component to its default React export with `{slots, params}`, drops into the existing `<Presentation>` runtime.
- The reference deck `decks/v0-reference/deck.sw` renders end-to-end (verified via SSR + smoke tests).
- `slidewright validate` CLI with `--parse-only`, `--check-refs`, `--json` flags.

## v0.1 status: implemented

- VS Code extension at `extension/`. F5 inside code-server (or desktop VS Code) launches the Extension Development Host with `/workspace` open and the Slidewright extension active. Activation: `onLanguage:slidewright` + `workspaceContains:**/*.sw`.
- "Slidewright: Open Canvas" command opens a webview panel beside the active `.sw` editor; one panel per document URI, ready-handshake before initial source push, file-watcher → re-render.
- **Selection sync** (both directions). Each component invocation in the rendered tree is wrapped in a `<div data-sw-span-start data-sw-span-end style="display:contents">` (and `Span` runs get the data attrs directly on their `<span>`); double-click anywhere walks up to the nearest data-sw-span ancestor and posts the range. Extension reveals + selects in editor with focus preserved on the canvas. Reverse direction: extension subscribes to `onDidChangeTextEditorSelection`, posts cursor offset, canvas walks the slide list and updates active slide.
- **Multi-slide navigation**. Vertical thumbnail strip with all slides rendered at scale (no virtualization yet). Resizable column (drag handle, persists to `localStorage`). Keyboard nav `←/→/PgUp/PgDn/Home/End/digits`.
- **Standalone web app at `/canvas.html`**. Same canvas UI as the webview, mounted against `StandaloneHost` instead of `VSCodeHost`. Bottom-mounted, height-resizable `<textarea>` source editor pane closes the round-trip loop without VS Code: type → canvas re-renders, double-click rendered element → editor jumps + scrolls (start near top), cursor in editor → canvas active slide tracks. Vite HMR refreshes the canvas when `decks/v0-reference/deck.sw` changes on disk.

The architectural shape that emerged:

- **Host abstraction** is the integration boundary between canvas and editor surface. v0.1 ships two implementations (`VSCodeHost`, `StandaloneHost`); future hosts (Vim plugin, JetBrains, hosted web) plug in by implementing `Host`. Canvas is editor-agnostic; only the host knows about its environment.
- **`data-sw-span-*` instrumentation** is the rendered-tree → AST mapping. Click → closest('[data-sw-span-start]') → source range. v0.2's gestures will reuse the same instrumentation; no separate side-channel needed.
- **`prepareSlide(wrappedSlide)`** unwraps the data-sw-span div, clones the inner SlideFrame with chrome props (active/actLabel), rewraps. Used wherever slides are rendered into the Presentation-style chrome (main canvas, strip thumbnails).
- **Standalone is a peer integration, not a derivative.** The Vite-served standalone canvas at `/canvas.html` is structurally the same as the VS Code path with a different host adapter. Slidewright is a filesystem-integrated tool; any editor that saves a file is a valid host.

## Where to start: v0.2

v0.2 is the first interactive gesture + round-trip emit. From `SLIDEWRIGHT.md / v0 sequencing`:

- Canonical re-emit pipeline (AST → source via the formatter).
- VS Code TextEdit API integration for canvas → source writes; `Host.setSource` already exists for standalone.
- Drag-to-move gesture on `Freeform`-positioned elements (the simplest gesture that exercises the full edit → emit → re-parse loop).
- Cell model with literal overrides (drag writes a literal x/y).
- Initial round-trip property test on a small corpus.

The architecture is ready: gestures attach to the data-sw-span wrappers, mutate the AST, run the canonical emitter, and `Host.setSource(newSource)` handles the rest. Both the standalone path (in-memory) and VS Code path (TextEdit API on the document) flow through the same `setSource` API.

## Tree-sitter investigation (deferred)

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

Until then: `slidewright/grammar/grammar.js` is preserved as a precise specification of the brace-block grammar in tree-sitter's standard form, useful documentation regardless of the runtime path.

## Conventions worth knowing

- **Built-in `Slide`**: the deck author wraps each slide in `Slide { content: ... }`, mapped to the existing `src/Slide.jsx`. Keeps the contract uniform — no hidden "frame slot" magic.
- **Selection sync on double-click**: single click is for navigation (changing active slide). Double-click on rendered content jumps the editor cursor.
- **Color tokens as scope bindings**: `accent`, `purple`, etc. are mapped to themselves in `decks/v0-reference/registry.ts:staticTokens`; the renderer turns them into `var(--<token>)`. A real theme system replaces this in v1+.
- **Asset URIs**: per-host. `VSCodeHost` computes them via `webview.asWebviewUri()`; `StandaloneHost` uses Vite's static-asset imports. The DSL author writes `headshotImg` as a name reference; the host injects the resolved URL into the deck scope.
- **Hardcoded for v0-reference**: the canvas imports `decks/v0-reference/registry` and the extension hardcodes its asset list. v0.2 generalizes via an esbuild-as-a-service pipeline that scans whatever deck the user opens.

## Running tests

`npm test` runs (in order): `tsc --noEmit` + parser smoke + loader smoke + SSR smoke. The SSR smoke renders the v0-reference deck through `react-dom/server` and asserts on the output structure — catches React-side regressions without needing a browser. A headless chromium smoke test (`slidewright/runtime/__test__/render.smoke.ts`) exists for the canvas; needs `npx playwright install chromium` after each `carthage build` since playwright binaries live outside persistent mounts.

## Build process

Per `SLIDEWRIGHT.md / Build process and decision-making`:

1. Build narrowly. Don't generalize beyond what the current phase needs, but don't bake in assumptions that preclude later generalization.
2. Test the round-trip property aggressively once v0.2+ lands. Property-based testing.
3. Document decisions in SLIDEWRIGHT.md as they get made.
4. Resist scope creep. Animations, AI, structured diagrams are all exciting and tempting. Don't.
5. Revisit decisions when implementation reveals new information.

## Asymmetries worth holding in mind

- **The contract is the only architectural piece with external consumers** (user-authored components, eventually AI-generated components, eventually shared component libraries). Iterate freely on internal architecture; commit to contract stability only when external consumers exist. v0 has no external consumers yet.
- **Slidewright is an application that ships a bundler** (Vite or equivalent) — the same way Slidev, Astro, SvelteKit do. Deck authors write `.tsx` components; that requires compilation. The standalone `/canvas.html` is the model for what users experience; the bundler runs locally on their machine, no hosting.
- **VS Code is the primary editor we test against**, but it's not the architectural center. The Host abstraction means selection sync and gestures must work in any editor that saves files. Smoke-test desktop VS Code before any external release; otherwise iterate in code-server or the standalone web app.
