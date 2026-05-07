# Slidewright handoff

You're picking up Slidewright development. **v0.0 (read-only viewer), v0.1 (VS Code extension + standalone web app + selection sync), v0.2 (interactive gestures + round-trip emit), v0.2.j (multi-select), and v0.3 are implemented**: React-native gesture refactor, external-edit reconciliation, canvas gesture undo / redo, inspector panel (hierarchy + read-write properties), and group resize via TransformDelta. **v0.4 is in progress** — the opaque-delta refactor and the tight cut (HStack / VStack as selectable + inspectable layouts inside Freeforms) have landed; reorder is the immediate next; gap-drag / slot-targeted insertion / empty-slot placeholders are the wider cut. See the **v0.4 status** section below for what's done and the **Deferred features / future work** section near the end for what's next.

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
  - `components/` — `TitleSlide.tsx`, `ContentSlide.tsx`, `CardRow.tsx`, `VStack.tsx`, `HStack.tsx`, `Freeform.tsx`, `Box.tsx`, `TextBox.tsx`, `Arrow.tsx`. Each `Box` / `TextBox` / `Arrow` exports a `canvas: ShapeAdapter` (drag / resize / handle behavior — see **`slidewright/canvas/shape-adapter.ts`**). `VStack` / `HStack` export `canvas: LayoutAdapter` (selectable + inspectable today; gesture-related methods optional — see **`slidewright/canvas/layout-adapter.ts`**).
- **`src/`** — Vite-served apps + the existing slide scaffold.
  - `Presentation.jsx`, `Slide.jsx`, `CodeBlock.jsx` — the existing scaffold (kbd nav, popout notes, scaling, print).
  - `App.jsx` — wires `decks/v0-reference/index.tsx` into the `Presentation` runtime (the v0.0 demo).
  - `canvas-standalone.tsx` — entry for the standalone Slidewright canvas at `/canvas.html`.
  - `standalone-host.ts` — `Host` adapter for the standalone path. Honors `?fixture=<name>` for e2e test fixtures (compile-imported via `import.meta.glob` from `tests/fixtures/`).
- **`canvas.html`** — entry HTML for `/canvas.html`.
- **`extension/`** — VS Code extension package. Same shape as v0.1; see `src/canvas.ts`, `src/webview/`, `esbuild.mjs`.
- **`slidewright/`** — the Slidewright package.
  - `grammar/grammar.js` — brace-block grammar in tree-sitter's declarative form. Spec-only; not in build.
  - `runtime/parser.ts`, `lexer.ts`, `ast.ts`, `emitter.ts`, `loader.ts`, `diagnostics.ts`, `cells.ts`, `contract.ts`, `scope.ts` — runtime layer. The `LoadedComponent` type gained an opaque `canvas?: unknown` field in v0.2 for shape adapters; runtime stays canvas-agnostic. `loader.ts` accepts a `wrapShape` callback (canvas-side passes `ShapeProjection`) and returns a `shapes: Map<spanKey, ShapeData>` registry alongside the rendered slides.
  - `runtime/__test__/` — smoke tests (parser, loader, SSR, round-trip property tests).
  - `cli/validate.ts` — `slidewright validate` CLI.
  - **`canvas/`** — host-agnostic canvas UI.
    - `host.ts` — `Host` interface.
    - `App.tsx` — top-level canvas component. State + effects for source / selection / gestures / nav / layout. After the v0.3 refactor, gesture state is React-driven: per-pointermove `setGesture` updates dx/dy; the loader's `ShapeProjection` wrapper consumes a gesture context and re-renders shapes with adjusted params; selection visuals are React components portaled into the active Freeform.
    - `shape-adapter.ts` — declarative ShapeAdapter contract: `calculateBounds`, `applyGesture`, `Handles` (React component), `commit`, plus opaque-delta plumbing (`buildGestureState` runs once at gesture start to capture stable state; `combineGestureState` runs per pointermove to derive the per-frame delta). `ShapeDelta` has three arms — `translate` and `transform` are framework-known universals; `opaque` carries the adapter's bespoke payload (`unknown` to the framework). Pure functions / React components. No imperative DOM hooks.
    - `gesture-context.tsx` — React context channel carrying the per-shape delta map (`Map<spanKey, ShapeDelta>`) from App down to `ShapeProjection`s deep in the slide tree.
    - `shape-projection.tsx` — the loader's `wrapShape` callback. Each component invocation gets rendered through a `ShapeProjection` that consumes the gesture context, calls `adapter.applyGesture(params, delta)`, then renders the shape's React component with adjusted params. The result: shape position is a pure function of `(source params + active delta)`.
    - `selection-layer.tsx` — React component that renders all selection visuals (per-shape outlines, group bbox, handles). Iterates the loader's shape registry. Branches per item: shapes use `adapter.calculateBounds` from gesture-adjusted params; layouts (HStack / VStack) DOM-measure bounds via the loader's wrapper. Portals into the active Freeform's positioned div.
    - `layout-adapter.ts` — `LayoutAdapter` contract for non-shape selectable components (HStack / VStack today). `kind: 'layout'` discriminator is required; all gesture-related methods (`interceptChildDrag`, `Handles`, `buildGestureState` / `combineGestureState`, `applyGesture`, `commit`, `GestureOverlay`) are optional, so a layout adapter can opt into reorder / gap-drag / future insertion gestures piecewise. `isLayoutAdapter` type guard for use-site discrimination.
    - `rect-adapter.ts` — `makeRectAdapter({ width, height })` factory shared by Box, TextBox, and any future HTML-rectangle shape.
    - `ScaledCanvas.tsx` — 1920x1080 design surface auto-fitted via CSS transform; pointerdown dispatch (selectable / draggable / create-tool); double-click → text-edit or selection-sync.
    - `ast-edits.ts` — pure AST helpers (locators, constructors, mutators) plus `commitSourceEdit` (the parse → mutate → emit → reparse → setSource pipeline) plus `computeArrowGeometry`. No React.
    - `SlideStrip.tsx`, `EditorPane.tsx`, `ResizeHandle.tsx`, `DiagnosticsPanel.tsx`, `ToolPalette.tsx` — supporting UI.
    - `canvas.css` — chrome.
- **`tests/`** — Playwright e2e tests for canvas gestures.
  - `fixtures/*.sw` — minimal `.sw` fixtures, one shape per file. Compile-imported into `StandaloneHost`.
  - `gestures.spec.ts` — gesture cases (drag body, resize, endpoint move, create, delete, multi-select, group drag, group resize) per shape.
  - `editor-sync.spec.ts` — bidirectional source ↔ canvas sync (typing, double-click, cursor sync, slide nav, external-edit reconciliation, undo / redo).
  - `inspector.spec.ts` — hierarchy tree + property panel (selection sync, double-click → caret, read-write commits, Escape cancel, undo). Run all via `npm run test:e2e`.

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

## v0.2.j status: implemented

Multi-select shipped. shift-click toggle, marquee selection (drag from empty Freeform space → select intersecting shapes; shift held = additive), group body-drag (any selected shape's drag moves all), group delete, per-shape selection outlines + minimum-bounding-box overlay when 2+ shapes are selected. `commitSourceEdit` extended to multi-preserve so selection survives the source round-trip. Scope: within one Freeform; cross-context multi-select is forbidden by intent.

## v0.3 status: implemented

The original v0.3 scope was slot-aware editing + inspector + external-edit reconciliation. The React-native gesture refactor (originally planned as later polish) was promoted ahead of those after v0.2.j to eliminate the recurring "visual didn't update during drag" bug class. Then the rest of the v0.3 list landed on top, plus group resize.

What landed:

- **React-native gesture refactor**. Imperative-during-drag is gone. Gesture state lives in React; `setGesture` per pointermove drives re-renders; the loader's `ShapeProjection` consumes a gesture context and re-renders shapes with `adapter.applyGesture(params, delta)`-adjusted params. Selection visuals (outline, group bbox, marquee preview, create preview) are React components portaled into the active Freeform. Adapter contract is fully declarative: `calculateBounds`, `applyGesture`, `Handles`, `commit`. Box and TextBox share `makeRectAdapter({ width, height })`. Per-frame setState verified to sustain 60fps at 5000 shapes (perf sweep at `tests/perf-stress.spec.ts`, opt-in via `npm run test:perf`).

- **External-edit reconciliation**. Source changes from outside the canvas (typing in the editor pane, file reload) cancel any in-progress gesture, clear the canvas-side undo stacks (external edits are barriers in v0), and preserve selection by `(slideIdx, childIdx, componentName)` across the round-trip. Falls over for restructuring edits (insertions / deletions / reorders) — known limitation; stable IDs in source are the long-term answer.

- **Canvas gesture undo / redo**. Cmd-Z / Cmd-Shift-Z. Each commit pushes the pre-commit source plus the slide it was made on; pop restores both source and active slide so the user sees the change being applied / reverted. External edits clear the stacks. Editor-focus stickiness fix (canvas pointerdown blurs any focused text input) ensures Cmd-Z routes to the canvas handler rather than the textarea's native (typically empty) undo. VS Code extension gets editor-native undo for free via `WorkspaceEdit`; standalone uses the canvas-side stack.

- **Inspector panel** (three-stage rollout). Bottom strip layout `[hierarchy | properties | bottomExtra]` lives in App; the standalone provides EditorPane via `bottomExtra`, VS Code leaves it null. `HierarchyPanel` renders the active slide's shapes ordered by source position with two-way selection sync (tree click ↔ canvas selection; double-click → editor caret). `PropertiesPanel` renders one editable row per slot fill — string / number / boolean / name_ref render text inputs, nested components / lists / null are read-only display. Edits commit via `commitToHost` so they enter the canvas-side undo stack.

- **Group resize** via axis-aligned `TransformDelta`. When 2+ shapes are selected, the group bbox renders 8 corner / edge handles. Dragging dispatches a `group-resize` HandleGestureInit; the framework derives one transform per frame (`sx, sy, tx, ty` with the opposite corner / edge as anchor) and replicates it to every member. Adapters gain a `transform` arm: `rect-adapter` applies `x'=sx*x+tx, y'=sy*y+ty, w'*=sx, h'*=sy`; Arrow applies the matrix to both endpoints.

Two items from the original v0.3 list were deferred to v0.4: **click into named slots** and **empty-slot placeholders**. Both turned out to depend on canvas gestures for non-Freeform components — today only Freeform's children (Box / TextBox / Arrow) participate in gestures, and Freeform's `children` is a list-valued slot, not the typed named slots those features were aimed at. The slotted layouts in the registry (TitleSlide, ContentSlide, CardRow, VStack) have named slots, but they're render-only on the canvas. Pulling them into the gesture / inspector story is the natural v0.4 milestone; see **Deferred features / future work**.

## v0.4 status: in progress

v0.4 has been delivered in successive cuts:

- **Tight cut (landed).** HStack / VStack as selectable + inspectable layout primitives. Click a stack → outline + spacing param in the inspector. Selection-layer DOM-measures their bounds (layouts are flow-laid; params don't determine bounds).
- **Reorder + gap-drag (landed).** `slidewright/canvas/stack-adapter.ts:makeStackAdapter({ axis })` is the shared factory both stacks use. **Reorder**: drag a child → insertion-line indicator at the target gap; on release, the parent's `children` slot is rewritten. **Gap-drag**: per-gap grips render between adjacent children when the layout is selected; drag a grip → live preview of the new spacing; on release, the `spacing` slot is updated (added if missing). Both run through the opaque-delta channel — no App.tsx edits required to add either. Framework dispatch: `ScaledCanvas` walks up to find a child + parent component pair on pointerdown and calls `onChildDragStart`; App's handler routes to the parent's `interceptChildDrag` and dispatches via the existing opaque-arm `startGesture`. New `gesture-overlay-layer.tsx` mounts a layout's `GestureOverlay` during its gesture (insertion line for reorder).
- **Wider cut (deferred).** Slot-targeted insertion gestures (drag-from-toolbar, click-empty-slot-then-pick). Empty-slot placeholders. Click-into-named-slots typed selection. Component toolbar overhaul.

**Known limitation: stacks at slide-level (outside any Freeform) don't render selection visuals.** The reference deck's existing `body: VStack { ... }` (inside ContentSlide on slide 3) is one of these — it appears in the hierarchy panel and its params are inspectable, but clicking it on the canvas finds no Freeform ancestor for `useFreeformDiv` and the SelectionLayer renders nothing. The fix is generalizing the portal target (per SLIDEWRIGHT.md / Outside-Freeform generalization — DOM-measure bounds against the slide's `.presentation-canvas` rather than the Freeform's inner div). The "Stacks demo" slide in `decks/v0-reference/deck.sw` wraps its VStack in a Freeform as a temporary bridge for the same reason; that wrapping isn't conceptually right (Freeform is positional, VStack is flow-laid) and should drop once the portal generalization lands.

## Watch for: ResizeObserver-driven layout measurement

LayoutAdapter's bounds (and gap-drag's grip positions) are DOM-measured rather than computed from params, because layouts are flow-laid by their parent — params don't determine bounds. We bandage this with `useLayoutEffect`-deferred measurement plus dep lists that have to enumerate every state input that could affect layout (selection, shapes, gestureDeltas, portalTarget). See SLIDEWRIGHT.md / Known design concerns / "DOM-measured bounds break the 'pure function of state' invariant" for the full discussion.

We've already shipped two regressions from this root: stale pre-commit DOM in render-time measurement (fixed by `useLayoutEffect`) and a missing `gestureDeltas` dep that caused gap-drag to skip re-measurement (fixed by adding the dep). **Trigger**: a third regression from this same pattern. The mechanical refactor is to drop the manual dep plumbing and have the framework subscribe via `ResizeObserver` to each registered layout's bounds; consumers pull the latest. Decouples bounds-tracking from React's state graph at the cost of an additional subscription model. Until that third strike, status quo + discipline (audit a new gesture's deps when it lands).

## Tree-sitter investigation (deferred)

Slidewright ships a hand-rolled recursive-descent parser. Tree-sitter was investigated and deferred. Triggers for re-opening: recovery code becomes a maintenance burden across new gestures; we want syntax highlighting in environments outside our own editor; we add a second grammar dialect. Until then `slidewright/grammar/grammar.js` is preserved as a precise specification.

The full tree-sitter rationale lived in this file at v0.1 and is preserved in git history (commit `0790967` and earlier). The short version: every primary-language toolchain that prioritizes IDE-grade diagnostics is hand-rolled (rustc, Roslyn, TypeScript, Clang, Swift). Tree-sitter's strength is many-grammar plumbing; we have one grammar.

## Conventions worth knowing

- **Built-in `Slide`** wraps each slide; mapped to `src/Slide.jsx`.
- **Selection sync on double-click**: single click is for navigation. Double-click on rendered content jumps the editor cursor.
- **Color tokens as scope bindings**: `accent`, `purple`, etc. mapped to themselves in `decks/v0-reference/registry.ts:staticTokens`; renderer turns them into `var(--<token>)`. A real theme system replaces this in v1+.
- **Asset URIs**: per-host. `VSCodeHost` via `webview.asWebviewUri()`; `StandaloneHost` via Vite's static-asset imports.
- **Hardcoded for v0-reference**: the canvas imports `decks/v0-reference/registry`. v0.2 generalizes via an esbuild-as-a-service pipeline that scans whatever deck the user opens — deferred until needed.
- **`pendingSelectionRef`** carries selection across the gesture-commit emit cycle. Spans shift on every emit; gestures stash the post-emit spans (array — supports multi-select group commits) in this ref before calling `setSource`, and the subscribe handler picks it up on the round-trip. Set to null = clear selection (default external-edit behavior).
- **Gesture mutex** is enforced by sharing a single `gesture` state slot. Body drag (from ScaledCanvas's pointerdown dispatch) and handle drag (from `adapter.Handles`'s pointerdown via `startGesture`) both feed it; both stopPropagation so only one can land per pointerdown.

## Architecture quick reference: the gesture lifecycle (post-v0.3)

```
ScaledCanvas pointerdown (or adapter Handles pointerdown)
      ↓
App builds a per-shape `GestureState` map. Three arms:
  - body drag → `{kind:'translate'}` (universal).
  - group resize → `{kind:'transform'}` per member (universal;
    group bbox + direction live on gestureMeta.groupResize).
  - per-shape Handles drag → `{kind:'opaque',payload}` where the
    payload was produced by adapter.buildGestureState(init) —
    opaque to the framework.
      ↓
App.setGesture({ states, pointerStart, scale, dx:0, dy:0, ... })
      ↓
useEffect attaches document.pointermove / pointerup
      ↓
pointermove: dx, dy = (clientX/Y - pointerStart) / scale; setGesture
react renders. gestureDeltas memo turns each gesture state into a
ShapeDelta — translate / transform are framework-derived; opaque
arms call adapter.combineGestureState(payload, dx, dy). The map
flows through the GestureProvider context. ShapeProjection wrappers
consume their delta and call adapter.applyGesture(params, delta).
React reconciles DOM. SelectionLayer reads the same data and renders
outlines / group bbox / handles at adjusted positions.
      ↓
pointerup: commitSourceEdit(source, label, ast => for each affected
shape: adapter.commit(ast, span, finalDelta, slideIdx))
      ↓
host.setSource(newSource) — round-trips back through Host.subscribe
      ↓
React re-renders with new source; pendingSelectionRef restores selection
```

The framework owns: pointer event lifecycle, gesture mutex, scale conversion (clientX/Y → designDx/Dy before invoking the adapter), source round-trip, tool-mode policy, selection visuals (outlines / group bbox), per-shape gesture-context distribution.

The adapter owns: pure functions (`applyGesture`, `calculateBounds`, `commit`) and a React `Handles` component. No imperative DOM mutation; no per-frame style writes; no closures-with-captured-original-state. Adding a new gesture-following visual is "render it as a React component reading the gesture context"; it never lags during drag because it can't — its position is a pure function of state.

## Deferred features / future work

Designed-or-discussed but not started. Not committed to dates; pulled in when scope or ergonomics warrant. Keep this list current — it's where memory-style "future work" notes live (don't put them in `~/.claude/.../memory/` — they belong here).

### v0.4 remaining: reorder + wider cut

The v0.4 tight cut landed (see "v0.4 status" above). What's left:

**Immediate next: reorder.** Drag a child within an HStack / VStack to a new index. This is when the shape-vs-layout-adapter design question gets answered — reorder needs:
- A parent-owned commit (the dragged child's source position is a list-position change in the parent's `children` slot, not a child-param mutation; today's `commit(ast, span, delta, slideIdx)` assumes the reverse).
- A drop-zone descriptor — visual indicator at each insertion gap, parent-rendered.
- A `ReorderDelta` (or its opaque-arm equivalent) carrying source / target index.

The architectural call landed in favor of `LayoutAdapter` (parallel to `ShapeAdapter`), with optional gesture methods so layouts can opt into reorder / gap-drag / future insertion piecewise. See `slidewright/canvas/layout-adapter.ts`.

**Wider cut: gestures + slot mechanics.** Picked up after reorder lands.

- **Slide-level layout selection** — generalize SelectionLayer's portal target from "closest Freeform" to "slide stage" so stacks at slide-level (the existing `body: VStack { ... }` pattern in the reference deck) render selection visuals. The fix is a small refactor of `useFreeformDiv` + the Freeform-relative coord conversion; a likely co-traveler with reorder since reorder also benefits from slide-stage portal target for drop-zone indicators outside any Freeform.

- **Click into named slots** — typed slot selection. Once a slotted layout is gesture-editable, clicking an empty slot or a slot's filled child should select the *slot* as the editing target, distinct from selecting the shape that fills it. Needed for operations like "insert into this slot" or "replace this slot's content."

- **Empty-slot placeholders** — affordances like "text…" inside an empty `TextBox.content`, or per-slot prompts inside an empty named slot, so users can see and click into slots that have no content yet. Independently shippable in principle, but the placeholder design will probably want to inherit from a slot-aware visual treatment that doesn't exist yet, which is why it's grouped here.

- **Component toolbar overhaul** — today's tool palette is four hardcoded buttons (`select` / `box` / `textbox` / `arrow`). Once slotted layouts and composites become first-class, the toolbar needs categorization, search, and slot-aware filtering (only surface components whose `produces` matches the targeted slot type). The registry needs to expose per-component metadata (icon, category) for the toolbar to consume. Effectively a prerequisite for the layout-DM story below — you can't add a layout via direct manipulation without a way to summon it.

- **Layout add / configure via direct manipulation** — adding a layout component into a slot, configuring its params, populating its children. Decomposes into:
  - **Insertion gestures** — drag-from-toolbar-into-slot, click-empty-slot-then-pick, etc. With the opaque-delta refactor in place, these live in the layout adapter's `buildGestureState` / `combineGestureState` / `applyGesture` / `commit` rather than touching App.tsx.
  - **Slot-typed acceptance** — only allow drops into slots whose type matches the inserted component's `produces`. Ties into empty-slot placeholders above.
  - **Param configuration via gesture** — drag the gap between two `VStack` children to adjust `spacing`; drag a divider to change a `Grid` column width; drag an `HStack`'s alignment guide. Gestures bound to specific layout params, not just spatial position. The inspector covers the same params from the keyboard side; the gesture surface is the direct-manipulation peer.

### Editor and source surface

- **Standalone code editor upgrade**. Replace the bare `<textarea class="sw-editor-pane">` with a real code editor component (CodeMirror 6 or Monaco). A real editor exposes a proper undo API to hook into rather than fighting the textarea's native behavior — partly motivates the unified-undo goal below.

- **Syntax highlighting for `.sw`**. A TextMate / Tree-sitter / Lezer grammar for the brace-block surface syntax, used by *both* hosts: VS Code extension highlights `.sw` files in the editor pane; standalone editor highlights inside the embedded code editor. Pick the editor component first since it constrains the highlighting integration story.

- **Unified undo stack** across all source-mutating sources: canvas gestures, in-app code editor, external edits. External edits enter as visible-but-unundoable barrier entries. Today the standalone has two parallel lanes — canvas-owned `undoStackRef` and the textarea's native input undo — that don't interleave. VS Code hides this via `WorkspaceEdit` populating editor undo, but the standalone shows the seam clearly.

### Inspector polish

- **Color palette / picker** for `fill`, `stroke`, and any color-valued name_ref param. The deck registry exposes a token palette (`amber`, `cyan`, `magenta`, etc. — see `decks/v0-reference/registry.ts:staticTokens`); the inspector should surface it as swatches with a free-form custom-color follow-up.

- **Drag-to-scrub on numeric inputs** — click-and-drag on the value (or a small grip / label) to change it, with shift = coarser, alt = finer. Matches Figma / Blender / DevTools layout-inspector ergonomics. Particularly useful for `x / y / width / height`.

### Gestures

- **Shift to lock aspect ratio** during single-shape and group resize. Constraint applied at `gestureStateToDelta` time: clamp `sy` to `sx` (or vice versa) per direction. Doesn't require the matrix generalization below.

- **Rotation** on single-shape and group selections. Forces `TransformDelta` to grow from axis-aligned `{sx, sy, tx, ty}` to a full 2x3 matrix `{a, b, c, d, tx, ty}` (`a = cos, b = -sin, c = sin, d = cos`). Adapter bounds — currently axis-aligned — would need to compute oriented bounding boxes or stop being axis-aligned.

- **Transform unification**. Translate and box-resize are mathematically special cases of `TransformDelta`. They're separate today only as conservative scoping for the group-resize task. Don't unify standalone — gate on rotation, which forces the matrix generalization and makes collapsing translate / box-resize onto transform nearly free at the same time. Three things to handle in the migration: direction-aware min-size clamping (today in `resizeRect` — would need to thread the anchor into transform commits), translate's narrow commit footprint (writes only `x, y` rather than all four slot fills), and intent preservation (translate vs resize) for undo labels and keyboard nudges. `arrow-endpoint` stays separate regardless — it's per-endpoint, not a rigid-body transform.

### Long-term: cells, constraints, and component relations

Far-out work — closer to v1 than to any near-term v0.x. The cell model (SLIDEWRIGHT.md / Cell model for values) reserves space for layered values — literal / computed-default / manual override / per-state — but v0 ships with literals only, and the surface for declaring computed defaults, variables, and inter-component relations is not yet designed. Includes:

- **Variable scopes** (deck / slide / template) with bind-to-name in inspector — the panel system already reserves space for this.
- **Computed defaults** via `solve.*` and anchor expressions (`#boxA.right.midpoint`, `solve.minFitWidth(...)`).
- **Constraints ladder** — anchor binding for arrows, persistent alignment relations (`A.centerX = B.centerX`), equal-size constraints; see SLIDEWRIGHT.md / Coordination protocols.
- **Visualizing active relations** — dashed alignment lines, ghost handles for arrows attached to a shape, badges for size-equality groups, distinct visual treatment for computed vs. literal vs. overridden cells; see SLIDEWRIGHT.md / Editor must visualize active relations.
- **"Reset to computed"** UX once overrides exist over computed defaults.

Architecturally pre-paid in v0 (cell resolution is `(handle, context)`-keyed; cells reserve a `valuesByState` layer). Deferred work is the surface forms, the gestures, the inspector affordances, and any constraint solver.

## Running tests

`npm test` — typecheck + parser + loader + SSR + round-trip property tests (~10s).
`npm run test:e2e` — Playwright suites against the standalone canvas (~20s, 53 cases across `gestures.spec.ts`, `editor-sync.spec.ts`, `inspector.spec.ts`; single worker — Vite dev server is single-threaded).
`npm run test:perf` — opt-in: per-frame setState scaling sweep at N=50/200/500/1000/2000/5000. Used to validate the React-native gesture refactor's perf assumption (60fps to N=1000, 57fps at 2000, falls off at 5000).

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
