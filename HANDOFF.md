# Slidewright handoff

You're picking up Slidewright development. **v0.0 (read-only viewer), v0.1 (VS Code extension + standalone web app + selection sync), and v0.2 (interactive gestures + round-trip emit) are implemented.** v0.2.j (multi-select) is the next milestone.

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
  - `components/` — `TitleSlide.tsx`, `ContentSlide.tsx`, `CardRow.tsx`, `VStack.tsx`, `Freeform.tsx`, `Box.tsx`, `TextBox.tsx`, `Arrow.tsx`. Each `Box` / `TextBox` / `Arrow` exports a `canvas: ShapeAdapter` alongside its `slidewright` metadata — declares its drag / resize / handle behavior. See **`slidewright/canvas/shape-adapter.ts`**.
- **`src/`** — Vite-served apps + the existing slide scaffold.
  - `Presentation.jsx`, `Slide.jsx`, `CodeBlock.jsx` — the existing scaffold (kbd nav, popout notes, scaling, print).
  - `App.jsx` — wires `decks/v0-reference/index.tsx` into the `Presentation` runtime (the v0.0 demo).
  - `canvas-standalone.tsx` — entry for the standalone Slidewright canvas at `/canvas.html`.
  - `standalone-host.ts` — `Host` adapter for the standalone path. Honors `?fixture=<name>` for e2e test fixtures (compile-imported via `import.meta.glob` from `tests/fixtures/`).
- **`canvas.html`** — entry HTML for `/canvas.html`.
- **`extension/`** — VS Code extension package. Same shape as v0.1; see `src/canvas.ts`, `src/webview/`, `esbuild.mjs`.
- **`slidewright/`** — the Slidewright package.
  - `grammar/grammar.js` — brace-block grammar in tree-sitter's declarative form. Spec-only; not in build.
  - `runtime/parser.ts`, `lexer.ts`, `ast.ts`, `emitter.ts`, `loader.ts`, `diagnostics.ts`, `cells.ts`, `contract.ts`, `scope.ts` — runtime layer. The `LoadedComponent` type gained an opaque `canvas?: unknown` field in v0.2 for shape adapters; runtime stays canvas-agnostic.
  - `runtime/__test__/` — smoke tests (parser, loader, SSR, round-trip property tests).
  - `cli/validate.ts` — `slidewright validate` CLI.
  - **`canvas/`** — host-agnostic canvas UI.
    - `host.ts` — `Host` interface.
    - `App.tsx` — top-level canvas component. State + effects for source / selection / gestures / nav / layout. After v0.2's three refactors, App is a thin dispatcher: looks up the relevant `ShapeAdapter` by `data-sw-component` and plumbs gesture lifecycle into the adapter's `GestureHandle`.
    - `ScaledCanvas.tsx` — 1920x1080 design surface auto-fitted via CSS transform; pointerdown dispatch (selectable / draggable / create-tool); double-click → text-edit or selection-sync.
    - `shape-adapter.ts` — per-shape canvas-behavior contract (`bounds`, `startBodyDrag`, `renderHandles`). Each shape's component file co-locates its adapter. App is the framework; adapters do per-shape work.
    - `ast-edits.ts` — pure AST helpers (locators, constructors, mutators) plus `commitSourceEdit` (the parse → mutate → emit → reparse → setSource pipeline) plus `computeArrowGeometry`. No React.
    - `SlideStrip.tsx`, `EditorPane.tsx`, `ResizeHandle.tsx`, `DiagnosticsPanel.tsx`, `ToolPalette.tsx` — supporting UI.
    - `canvas.css` — chrome.
- **`tests/`** — Playwright e2e tests for canvas gestures.
  - `fixtures/*.sw` — minimal `.sw` fixtures, one shape per file. Compile-imported into `StandaloneHost`.
  - `gestures.spec.ts` — gesture cases (drag body, resize, endpoint move, create, delete) per shape. Run via `npm run test:e2e`.

## How to run

```sh
# Inside the carthage container:
npm run dev                # Vite dev server on :5173
                           #   /              → multi-slide v0.0 demo (Presentation)
                           #   /canvas.html   → v0.1+ standalone Slidewright canvas
                           #   /canvas.html?fixture=<name>  → load a tests/fixtures/*.sw file
npm test                   # typecheck + parser + loader + SSR + round-trip property tests
npm run test:e2e           # Playwright gestures suite (Chromium, ~5.5s)
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
- Cell runtime with `resolve(handle, context): T` interface; literal layer only (no computed defaults yet).
- React rendering: walks the AST, dispatches each component to its default React export with `{slots, params}`.
- The reference deck `decks/v0-reference/deck.sw` renders end-to-end (verified via SSR smoke test).
- `slidewright validate` CLI with `--parse-only`, `--check-refs`, `--json` flags.

## v0.1 status: implemented

- VS Code extension at `extension/`. F5 inside code-server (or desktop VS Code) launches the Extension Development Host.
- "Slidewright: Open Canvas" command opens a webview panel beside the active `.sw` editor.
- Selection sync (both directions) via `data-sw-span-*` instrumentation on every component invocation.
- Multi-slide navigation with vertical thumbnail strip, keyboard nav, persistent strip width.
- Standalone web app at `/canvas.html` with bottom-mounted source editor.

## v0.2 status: implemented

v0.2 was sequenced into ten sub-milestones (a–i). All landed.

- **v0.2.a–b**: Canonical emitter (`slidewright/runtime/emitter.ts`); in-place text editing via `contentEditable` on the rendered span; round-trip property tests with deterministic LCG-driven edit sequences.
- **v0.2.c–d**: Comment preservation through canonical emit (lexer emits comments as tokens; parser attaches as `leadingComments` / `trailingComments` on each node).
- **v0.2.e**: `Freeform` layout primitive; `Box` shape with x / y / width / height / fill slot fills; drag-to-move gesture committing through the AST → emit → setSource pipeline.
- **v0.2.f**: Tool palette UI (`select` / `box` / `textbox` / `arrow`); Box drawing gesture (drag on empty Freeform appends a new Box).
- **v0.2.g**: `TextBox` (HTML-rectangle with text content, drag and click-to-edit) and `Arrow` (SVG line + polygon arrowhead, x1/y1/x2/y2 endpoints) primitives + their drawing tools.
- **v0.2.h**: Single-shape selection model (click to select, dashed outline, Escape / click-background to clear, Delete / Backspace removes, selection persists across activeIdx changes within the same source).
- **v0.2.i.1**: Box / TextBox drag-to-resize via 8 corner / edge handles. Selection preservation across the emit cycle (find shape's child index in pre-emit AST, look it up by index in post-emit AST, stash new span in `pendingSelectionRef`).
- **v0.2.i.2**: Arrow body drag (translates both endpoints), endpoint handles (drag one endpoint while the other stays fixed), wider invisible hit-area `<line>` for thin arrows.

After the milestones, three refactors landed:

1. **AST helpers extracted to `slidewright/canvas/ast-edits.ts`** (`findStringAt`, `findComponentAtSpan`, `findShapeChildIdx`, `findShapeAtChildIdx`, `findActiveSlideFreeform`, `findNumericSlot`, `makeBoxNode` / `TextBoxNode` / `ArrowNode`, `appendShapeToFreeform`, `removeShapeAtSpan`, `computeArrowGeometry`). Pure functions, unit-testable, no React.
2. **`commitSourceEdit` helper** centralizes the parse → mutate → emit → reparse-for-selection → setSource pipeline. Called from every gesture's commit point.
3. **`ShapeAdapter` contract** (`slidewright/canvas/shape-adapter.ts`). Each shape primitive exports a `canvas: ShapeAdapter` alongside its `slidewright` metadata. App.tsx looks up the adapter via `data-sw-component` and dispatches gesture events to it. Per-shape gesture branching is gone — Box, TextBox, Arrow each own their drag / resize / handle implementation in their own component file.

Net: App.tsx 1706 → 805 lines across the three refactors. Behavior unchanged (verified by the e2e suite).

End-to-end Playwright tests at `tests/gestures.spec.ts` cover drag-body / resize / endpoint-move / create / delete for each shape (9 cases, ~5.5s). They survive refactors as black-box behavior validation. Workers fixed at 1 because Vite's dev server is single-threaded.

## Where to start: v0.2.j (multi-select)

Multi-select is the next milestone. Scope (modulo group resize, deferred):

1. **Selection state** becomes `selected: SourceRange[]` (ordered; could be `Set` but array is simpler for `.map`).
2. **Shift-click to toggle**: ScaledCanvas's `onSelectShape` callback grows a `modifiers: { shift: boolean }` arg; App's handler decides replace vs toggle.
3. **Marquee selection**: pointerdown on empty canvas in select mode → drag → on release, set selection to all shapes whose bounding box intersects the marquee. New `onMarqueeStart` callback from ScaledCanvas.
4. **Group body-drag**: any selected shape's body drag moves all selected shapes together. The `activeGesture` slot grows to hold an array of `GestureHandle`s; each frame iterates and dispatches the same delta.
5. **`commitSourceEdit` extension** to accept multiple `preserveSelection`s (current single-selection version becomes a wrapper that builds a one-element array).
6. **Group delete**: keyboard handler iterates and removes each selected shape.
7. **Selection rendering**: dashed outline per selected shape (so the user can see which shapes are in the group) plus a minimum-bounding-box around the group when 2+ are selected. Body-drag responds anywhere on the group bounding box.
8. **Handles only render when exactly one shape is selected.** Group resize handles on the group bounding box are deferred to a follow-up commit.

**Scope of multi-select, by intent:**
- **Within one layout context only.** Two Boxes on the same Freeform: yes. Box on Freeform + Card in CardRow: no (cross-context multi-select is forbidden — different coordinate systems make group operations ill-defined). When outside-Freeform adapters land, multi-select scopes per layout context.
- **No group resize in this milestone.** That's a follow-up that adds a new adapter method, `applyTransform`, which subsumes `onMove` for proportional gestures (translate-only for body drag, translate+scale for corner resize). Both single-shape and group resize dispatch through it. Bespoke handles (Arrow endpoint, future shadow-offset, etc.) keep their own `GestureHandle` since they aren't proportional.

After multi-select: source-edit / cursor-sync e2e tests (currently uncovered — extend `tests/` to drive the editor pane and assert the canvas catches up). Then v0.3 territory.

## Tree-sitter investigation (deferred)

Slidewright ships a hand-rolled recursive-descent parser. Tree-sitter was investigated and deferred. Triggers for re-opening: recovery code becomes a maintenance burden across new gestures; we want syntax highlighting in environments outside our own editor; we add a second grammar dialect. Until then `slidewright/grammar/grammar.js` is preserved as a precise specification.

The full tree-sitter rationale lived in this file at v0.1 and is preserved in git history (commit `0790967` and earlier). The short version: every primary-language toolchain that prioritizes IDE-grade diagnostics is hand-rolled (rustc, Roslyn, TypeScript, Clang, Swift). Tree-sitter's strength is many-grammar plumbing; we have one grammar.

## Conventions worth knowing

- **Built-in `Slide`** wraps each slide; mapped to `src/Slide.jsx`.
- **Selection sync on double-click**: single click is for navigation. Double-click on rendered content jumps the editor cursor.
- **Color tokens as scope bindings**: `accent`, `purple`, etc. mapped to themselves in `decks/v0-reference/registry.ts:staticTokens`; renderer turns them into `var(--<token>)`. A real theme system replaces this in v1+.
- **Asset URIs**: per-host. `VSCodeHost` via `webview.asWebviewUri()`; `StandaloneHost` via Vite's static-asset imports.
- **Hardcoded for v0-reference**: the canvas imports `decks/v0-reference/registry`. v0.2 generalizes via an esbuild-as-a-service pipeline that scans whatever deck the user opens — deferred until needed.
- **`pendingSelectionRef`** carries selection across the gesture-commit emit cycle. Spans shift on every emit; gestures stash the post-emit span in this ref before calling `setSource`, and the subscribe handler picks it up on the round-trip. Set to null = clear selection (default external-edit behavior).
- **Gesture mutex** is enforced by sharing a single `activeGesture` state slot. Body-drag (from ScaledCanvas) and handle-drag (from adapter `renderHandles`) both feed it; both stopPropagation so only one can land per pointerdown.

## Architecture quick reference: the gesture lifecycle

```
ScaledCanvas pointerdown (or adapter handle pointerdown)
      ↓
App looks up the shape's ShapeAdapter
      ↓
adapter.startBodyDrag(ctx) returns a GestureHandle      [body drag]
   OR
adapter's handle pointerdown calls ctx.startHandleDrag( [handle drag]
   GestureHandle, event)
      ↓
App sets activeGesture state with the handle
      ↓
useEffect attaches document.pointermove / pointerup
      ↓
on pointermove: scale-convert delta, call handle.onMove(designDx, designDy)
on pointerup:   commitSourceEdit(source, label, ast => handle.onCommit(ast, dx, dy))
      ↓
host.setSource(newSource) — round-trips back through Host.subscribe
      ↓
React re-renders with new source; pendingSelectionRef restores selection
```

The framework owns: pointer event lifecycle, gesture mutex, scale conversion (clientX/Y → designDx/Dy before invoking the adapter), source round-trip, tool-mode policy.

The adapter owns: per-frame imperative DOM updates, AST mutation on commit, handle rendering and placement.

## Running tests

`npm test` — typecheck + parser + loader + SSR + round-trip property tests (~10s).
`npm run test:e2e` — Playwright gestures suite against the standalone canvas (~5.5s, single worker).
Both should pass before any commit that touches gesture code.

## Build process

Per `SLIDEWRIGHT.md / Build process and decision-making`:

1. Build narrowly. Don't generalize beyond what the current phase needs, but don't bake in assumptions that preclude later generalization.
2. Test the round-trip property aggressively — done for emit, growing for gestures.
3. Document decisions in `SLIDEWRIGHT.md` as they get made; reflect implementation reality in this file.
4. Resist scope creep. Animations, AI, structured diagrams are all exciting and tempting. Don't.
5. Revisit decisions when implementation reveals new information.

## Asymmetries worth holding in mind

- **The contract is the only architectural piece with external consumers** (user-authored components, eventually AI, eventually shared component libraries). Iterate freely on internal architecture; commit to contract stability only when external consumers exist. v0 has no external consumers yet.
- **Slidewright is an application that ships a bundler** (Vite or equivalent). Deck authors write `.tsx` components; that requires compilation. The standalone `/canvas.html` is the model for what users experience.
- **VS Code is the primary editor we test against**, but it's not the architectural center. The Host abstraction means selection sync and gestures must work in any editor that saves files. Smoke-test desktop VS Code before any external release; otherwise iterate in code-server or the standalone web app.
- **The `ShapeAdapter` contract is internal-only.** Per-shape canvas behavior is co-located with shape components but the contract isn't part of any external API. Iterate freely as the multi-select / group-resize / outside-Freeform extensions land.
