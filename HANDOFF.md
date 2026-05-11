# Slidewright handoff

You're picking up Slidewright development. **v0.0 (read-only viewer), v0.1 (VS Code extension + standalone web app + selection sync), v0.2 (interactive gestures + round-trip emit), v0.2.j (multi-select), and v0.3 are implemented**: React-native gesture refactor, external-edit reconciliation, canvas gesture undo / redo, inspector panel (hierarchy + read-write properties), and group resize via TransformDelta. **v0.4 is in progress** — the opaque-delta refactor, HStack / VStack as selectable + inspectable layouts (incl. reorder + gap-drag), click-into-named-slots, and empty-slot placeholders (Phase A + Phase B `omit` sigil) have landed; slot-targeted insertion gestures and a component-toolbar overhaul remain. See the **v0.4 status** section below for what's done and the **Deferred features / future work** section near the end for what's next.

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
    - `selection-layer.tsx` — React component that renders all selection visuals (per-shape outlines, group bbox, handles). Iterates the loader's shape registry. Branches per item: shapes use `adapter.calculateBounds` from gesture-adjusted params; layouts pull bounds from the ResizeObserver-driven `layout-measurement.ts`. Portals via `useSelectionPortal` (see `portal-target.ts`).
    - `portal-target.ts` — `findPortalAncestor(el)` non-hook helper + `useSelectionPortal` hook for finding the right portal target: closest Freeform's positioned div if there is one, slide stage (`.presentation-canvas`) otherwise. Looks up the wrapper by either component or slot span. Shared by `selection-layer.tsx`, `gesture-overlay-layer.tsx`, `stack-adapter.ts`.
    - `selection-target.ts` — `SelectionTarget = { kind: 'component', span } | { kind: 'slot', span, parentSpan, slotName }` discriminated union. Selection state in App.tsx is `SelectionTarget[]`. Helpers: `selectionTargetsEqual`, `findTargetIndex`, `componentTarget`.
    - `layout-measurement.ts` — ResizeObserver-driven layout measurement primitive. `measureLayoutSnapshot(span)` for one-shot reads (used by adapters' gesture-start handlers); `useLayoutMeasurement(span)` for reactive subscription (used by `selection-layer.tsx` for layout-bounds tracking and stack-adapter's gap-drag grip positions). Subscribes per layout to the layout, reference frame, canvas (scale), and children. Replaced the per-consumer `useLayoutEffect` + manual deps pattern that produced three regressions from the same root (timing, missing deps, identity loops).
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
- **Click-into-named-slots (landed).** Typed slot selection: clicking inside a component drills through the alternating component/slot chain on successive clicks (Figma-style). Loader instruments slot fills with `data-sw-slot-*` wrappers; ScaledCanvas builds the selectable chain from a click target and applies a drill rule against the current selection. Selectables are now registry-driven (any component with a `canvas` export — no hardcoded selector list); CardRow gains `canvas: { kind: 'layout' }` so it participates in the drill chain. New `selection-target.ts` carries the discriminated `SelectionTarget = component | slot | empty-slot` union; SelectionLayer renders slot outlines distinct from component outlines (teal dashed border + slot-name label badge). Inspector switches to a slot-aware view (`Slot: <name>` header + value editor for primitives, read-only display for complex).
- **Empty-slot placeholders (Phase A landed).** Renderable slots with no fill in source surface as dashed-teal placeholders the user can click to select (`kind: 'empty-slot'` SelectionTarget — identity is `(parentSpan, slotName)` since there's no own SlotFill span yet). Type-aware visuals: text slots get inline italic ghost text matching parent typography; block / slide / array slots get a 200×60 dashed box with slot-name label. Editable text spans also gain a `:empty` placeholder treatment in `canvas.css` so empty fills (post-materialize OR after a user deletes all text) keep a visible hit target with the surrounding line-box height (zero-width-space `::before` pseudo). **Inspector**: empty-slot panel with "Slot: <name> (empty)"; text slots get a "fill" input that materializes on Enter/blur, others show a deferred-insertion hint. **Dblclick on empty text placeholder**: materializes an empty `slotName: ""` fill and immediately enters contentEditable on the new span via a `pendingTextEditRef` baton drained by a post-commit useEffect. Cross-emit identity uses path-from-root (PathSegment[]) since the canonical formatter rewrites offsets — see `ast-edits.ts:pathToComponent` / `componentByPath`.
- **Empty-slot placeholders Phase B (landed).** New `omit` keyword: `slotName: omit` is parsed as `OmitLit` (a first-class Value kind, distinct from `null`). The loader treats it like "no fill" for rendering but suppresses the empty-slot placeholder — the user has acknowledged the slot is intentionally empty. Inspector adds a per-row "omit" toggle button. Toggle ON splices `omit` into the value span; toggle OFF splices `""` so the input becomes editable again (prior value isn't preserved — Cmd-Z gets it back). Toggle only renders for omit-eligible rows: fills naming a slot in `meta.slots` whose type is renderable (text / block / slide / array of those). Params (in `meta.params`) and non-renderable slots (image, scalars) hide the toggle entirely — they have defaults rather than placeholders, so `omit` would be source noise. Schema plumbing: `ShapeData` carries the component's `meta: ComponentMeta` (set at loader registration); `isRenderableSlotType` is now exported from the loader; `InspectorPanels.tsx:omitEligibleForFill` is the gating predicate. Custom-treatment-per-component (e.g., CardRow hiding its border on `omit`) is not yet wired — components currently treat the loader's "slot value undefined" path the same regardless of whether the cause was `omit` or no fill.
- **Slide as inspector root (landed).** The active slide now has a dedicated row at the top of the hierarchy (its own class `.sw-hierarchy-slide-row` — does NOT contribute to the existing `.sw-hierarchy-node` shape-row count) and is selectable as `SelectionTarget` kind `'slide'`. Slide selections never draw a canvas outline (the slide IS the canvas, not a thing within it) and the slide kind has no span — its identity is "the active slide", so external edits don't shift it. **Property panel default:** when nothing else is selected, falls through to the slide's properties (label / notes / content), so "no selection" becomes "I'm editing the slide". `BUILTIN_META.Slide` was added to `contract.ts` and `renderBuiltinSlide` switched to meta-based validation. Loader exposes `slidesData: SlideAstData[]` (parallel to `slides: ReactElement[]`); the inspector reads `slidesData[activeIdx]` to render the row + panel. Deck-level params (Deck.name, Deck.subtitle, Deck.width / height) remain not-yet-inspectable — that would be the next-deeper step if needed.
- **Wider cut (deferred).** Slot-targeted insertion gestures (drag-from-toolbar, click-empty-slot-then-pick). Component toolbar overhaul.

**Slide-level layouts (no Freeform ancestor) now work.** `slidewright/canvas/portal-target.ts` exposes `findPortalAncestor(el)` (non-hook helper) and `useSelectionPortal` (hook) that do a conditional lookup: prefer the closest Freeform's positioned div (preserves the existing coord system for shapes + layouts inside Freeforms), fall back to the slide stage (`.presentation-canvas`) for layouts at slide-level. Selection visuals + gesture overlays portal into whichever ancestor is appropriate. `layout-measurement.ts` uses the same fallback for measurement reference frames, so DOM measurements stay in the same frame as rendering. The `body: VStack { ... }` pattern (existing slide 3 in the reference deck) and the rebuilt "Stacks demo" slide both work now.

## Watch for: MutationObserver layer over ResizeObserver

`layout-measurement.ts` uses `ResizeObserver` to track layout sizes for selection bounds + gap-drag grip positions. It works as long as a tracked layout's DOM element keeps the same identity for the subscription's lifetime. When React replaces it with a new instance (same conceptual element, different identity), the observer keeps pointing at the detached old element and goes silent until the consumer's `useEffect` re-runs.

Known triggers for element-identity changes — must propagate to consumer-effect deps or force a remount via `key`:

- `selected` / `shapes` / `portalTarget` — already in the deps of `useMeasuredLayoutBounds` and `useLayoutMeasurement`. Cover selection changes and source commits.
- `activeIdx` — the standalone canvas only mounts the active slide; nav-away-then-back replaces a layout's DOM with a new instance. Handled via `key={activeIdx}` on `<SelectionLayer>` + `<GestureOverlayLayer>` in App.tsx.

We've shipped one regression from this expanded root (the slide-nav case above). **Trigger to refactor:** a fourth regression from element-identity changes that the discipline doesn't cover. The mechanical fix: add a `MutationObserver` on the slide stage in `layout-measurement.ts`. On any childList / subtree mutation, re-find the layout's element by span and re-attach the `ResizeObserver` if the reference changed. Generic; handles arbitrary remount scenarios without per-trigger discipline. Cost: another subscription model layered on top of ResizeObserver, plus per-mutation work.

**Discipline rule for new state:** when adding any state that could cause a tracked layout's DOM element to be replaced (new component instance with same span), audit whether the relevant consumer's effect deps would re-fire. If not, add the state as a dep, or `key` the consumer on it, before the regression hits.

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

### v0.4 remaining: wider cut

The v0.4 tight cut + reorder + gap-drag + click-into-named-slots + empty-slot placeholders (both phases) all landed (see "v0.4 status" above). What's left:

- **Custom per-component `omit` treatments** — Phase B's loader currently does one thing on `omit`: skip resolving the slot, skip the placeholder. Components see the slot value as undefined in both the `omit` and "no fill" cases. The Phase B design noted that components might want bespoke treatments (e.g., CardRow hiding its border entirely instead of rendering a borderless container, or a divider component collapsing to zero height). Needs (a) a way for the resolved slot map to distinguish "missing" from "omit-suppressed" — currently both arrive as undefined; (b) the component template reading that distinction. Smaller-scope follow-up than re-doing the loader.

- **Schema-aware un-omit defaults in the inspector** — toggle-OFF currently splices `""` (empty string) regardless of slot type. Works fine for text/string slots (the dominant case); for block / slide / array slots the user must hand-edit. Path forward: PropertyRow could read `meta.slots[fillName].type` (the schema is already on ShapeData per the omit gating) and pick a type-shaped default: `[]` for arrays, an empty stub like `Box { }` for `block`, etc.

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
