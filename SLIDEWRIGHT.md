# Slidewright

A projectional editor for code-based slide decks, designed for human/AI co-authoring of richly designed, animated, and structured slides.

## Status

Early design. This document started as a snapshot of an initial design conversation; it has since been updated with decisions from a follow-up design pass that worked through DSL shape, layout primitives, text values, the cell-with-override model for all values, diagrams and constraints, and the implications of each. **Many decisions are still tentative.** Sections marked **OPEN** have multiple options on the table; sections marked **TENTATIVE** have a leading candidate but are not locked in; sections marked **DECIDED** represent stronger commitments but may still be revisited.

The agent reading this should treat the design as input to v0 implementation and as a living document to be updated as implementation reveals what works. Before v0 implementation begins, four big topics need a dedicated design pass: see "Pre-v0 design topics" below.

---

## Vision

Slidewright is a slide editor whose underlying representation is a tree of typed components written in a constrained DSL, with TypeScript/React for component internals. The editor presents direct manipulation (click, drag, resize, edit text) over the rendered tree, and edits round-trip back to the source code. AI coding assistants can author components and modify slide source; humans can manipulate the result visually. Both modes share the same source of truth.

The target use case is **impressive, structured slides**: rich animations, complex diagrams, sequenced builds — the kinds of slides that today require either painstaking manual work in Keynote/PowerPoint or pure-code tools (Slidev, reveal.js) that lack visual authoring.

Slidewright is **not** trying to be a general visual editor (Figma, Framer) or a UI codegen tool (v0, Tempo). The slide constraints — bounded canvas, linear sequencing, no scrolling/interactivity — are features that make ambitious capabilities (rich builds, structured diagrams, AI co-authoring) tractable.

## Pre-v0 design topics

Before any v0 code gets written, four topics need a design pass deep enough to commit to an architecture. These are not v0 features — they are the design commitments v0 has to be built against.

1. **The slide-component contract.** ~~Pre-v0 design pass complete~~ — see "Slide-component contract" below for the v0-light shape. Thin by design (props + typed slots + typed params + reserved `protocols` namespace) on the principle that the React escape hatch is always available, so the contract stays minimal and grows only when accumulated escape-hatch evidence shows what it's missing. Iterate freely until external consumers exist.

2. **Animations and builds — the value-model implications.** ~~Pre-v0 design pass complete~~ — see Animations and builds. Three categories surfaced (enter/exit, cell-value transitions, motion graphics); discrete states as primary; implicit-by-ID-match defaults with explicit customization layer. The v0 architectural commitment is that cells are addressable handles, resolution takes a context (`resolve(handle, context): T`), caches and dependency-graph nodes are `(handle, context)`-keyed, and the cell type reserves space for a `valuesByState` layer. Everything else (DSL syntax, timeline UI, interpolation algorithms, transition declarations) is deferred as feature work.

3. **Round-trip mechanics.** ~~Pre-v0 design pass complete~~ — see Mediation layer. Canonical re-emit on editor write (structure preserved, comments preserved, formatting normalized); per-slide type-prefixed counter IDs (Figma convention); leading/trailing comment attachment; gestures committed via VS Code's TextEdit API. Round-trip invariant softened from "formatting preserved" to "structure preserved." Hybrid emit and snapshot-fold undo are noted as long-term upgrades.

4. **AI authoring posture.** ~~Pre-v0 design pass complete~~ — see AI authoring. The strict-vs-permissive binary is dissolved by the agent-external framing: Slidewright doesn't ship first-party agentic AI; agents are external (Claude Code, Cursor, etc.) interacting with a typed codebase. Parser is permissive (tree-sitter, error-recovering), validator is strict (CLI tool agents call), editor renders permissively with markers. We provide types, CLI tooling, structured diagnostics, and project docs aimed at agents.

## Architecture overview

Five layers, from bottom to top:

1. **DSL and component framework**: a small grammar for slide content, plus a set of primitive components (Text, Box, layout primitives, Slide, Deck) and a contract that custom components implement.
2. **Mediation layer**: parser, emitter, and edit protocol that translate between source code and the editor's runtime tree, in both directions.
3. **Editor (VS Code extension + webview)**: renders the live tree, handles selection/manipulation/text editing, surfaces a component library, manages projects.
4. **AI authoring integration**: invocation, context assembly, output handling, validation against the contract.
5. **Presentation runtime**: a separate render path for delivering slides without editor chrome.

Each layer should be designed to know as little as possible about the layers above it. The DSL and mediation should be domain-agnostic in principle (general "structured visual document" substrate) even though slide-specific primitives live on top.

---

## DSL design

### Form **TENTATIVE (semantics + surface syntax both committed for v0)**

The DSL is parsed with a tree-sitter grammar (per Mediation layer) and only permits a constrained subset:

- Slidewright primitives only at the layout level (no raw HTML/SVG)
- Imported components from TS files as leaves
- Values are literals, token references, named bindings, or constrained "solve"/anchor-reference forms (see "Cell model for values" below) — no free-form expressions
- Stable IDs required on every primitive
- No conditional rendering or loops at the DSL level (use components like `<Repeat>` instead)
- **Components declare typed named slots; the DSL fills slots, it does not just nest children positionally.** This is the most important commitment about the DSL's shape: the slot schema makes templates projectional-editor-friendly because the editor knows what content is allowed where, can show empty slots as obvious "fields to fill in," and can render slot-aware suggestions in the component library.

#### Surface syntax: brace-block form

After working through indented-colon, NestedText, JSX-with-named-slots, and brace-block forms (see `design/sketches/three-obstacles.md` for the comparison), the v0 commitment is **brace-block syntax** in the spirit of HCL / Rust struct literals. The shape:

- **Component invocation**: `Name { body }`. Always braces.
- **Slot fill**: `name: value`. The `value` is a literal, another component, or a list.
- **Capitalization disambiguates**: capitalized identifiers are component types; lowercase identifiers are slot or param names. Grammar uses this purely; schema validates.
- **Inside a brace block**: items are separated by newline OR comma. Newline is the multi-line default; comma is the inline form.
- **Lists** use `[...]` with newline-or-comma separator, parallel to `{...}` for component bodies.
- **Indentation is purely cosmetic.** Canonical formatting indents one level per brace depth; the parser doesn't care about it.
- **Multi-line strings**: triple-quoted `"""..."""` with Python-style dedent rules.
- **Adjacent string literals concatenate at parse time** (Python convention) — useful for wrapping long single-line prose without taking on multi-line semantics. Triple-quoted strings do not adjacency-join.
- **Markdown allowed inside text-typed slots** via the slot type — `text` for plain text, `text-markdown` for slots whose content is parsed as Markdown and resolved into `(string | Span)+` runs. Opt-in per slot in the component schema.
- **Implicit children**: when a brace block contains *only* capitalized component invocations (no other slots filled in that invocation), they are treated as filling the containing component's `children` slot directly. If the invocation also fills any other slot, children must be expressed as an explicit `children: [...]` slot fill. **Per-invocation rule, not per-schema.** May be revisited.

Working sketch:

```
ContentSlide {
  eyebrow: "Three obstacles"
  title:   "Behavior is hidden by default."
  intro:   "Programs do a lot, and most of it is invisible by default. "
           "To observe behavior, you have to solve three problems."

  body: VStack {
    spacing: 32
    children: [
      CardRow {
        color:   purple
        eyebrow: "Representation"
        heading: "Code isn't behavior."
        body:    "Code shows what could happen, not what did."
      }
      CardRow { color: cyan,    eyebrow: "Attention", heading: "It's mostly noise.",     body: "..." }
      CardRow { color: magenta, eyebrow: "Volume",    heading: "There's too much stuff.", body: "..." }
    ]
  }

  notes: """
    - Behavior isn't a thing you can just look at.
    - First, attention — programs do a lot, where do you point your eyes?
    - **Second**, volume — even when you know where to look, there's a *firehose*.
  """
}
```

Implicit-children example (no other slots filled):

```
body: Freeform {
  Box   { x: 100, y: 200, width: 200, height: 100 }
  Arrow { from: #boxA.right, to: #boxB.left }
  Text  { x: 350, y: 250, content: "step 1" }
}
```

**Worked examples** of representative slides live in `design/sketches/` — markdown files with code blocks plus commentary. They are not authoritative (this doc is) but they make decisions concrete and provide a corpus the round-trip test harness can exercise once v0 lands.

**Why tree-sitter for this grammar:** delimiter-based brace grammars are tree-sitter's sweet spot. Error recovery is automatic; the CST round-trips through the canonical formatter cleanly. The diagnostics translator on top of the CST is where Slidewright-specific error messages live.

**Why a custom grammar, not TSX**: the hard part isn't parsing TSX (ts-morph and recast handle it), it's specifying the round-trippable subset. Designing a grammar that only permits what we support is cleaner than parsing all of TSX and validating against a subset. **OPEN: revisit if early implementation suggests the parser cost outweighs the validation cost.**

### Three component layers **DECIDED (in shape)**

Components live at three layers. Conflating them produces unease (e.g., "is `Label` a primitive or a typography role?").

1. **Generic primitives** — `Box`, `Text`, layout containers. Domain-agnostic. The substrate.
2. **Deck-level typography vocabulary** — named text roles like `Eyebrow`, `Title`, `Body`, `Caption`. These are *not* universal primitives; they are vocabulary defined per deck/theme. They appear in the component library and are retitleable from the deck theme.
3. **Composite components** — `Card` (with color variants), `ContentSlide`, `TitleSlide`, `BinaryTree`, `Table`, etc. Built from layers 1 and 2 (or written directly in TS via FFI). May ship in a small built-in library; many are deck-specific.

Implications:
- Card's colored accent is a panel-edited param of the composite, not a primitive concern.
- Title and image slides are parameterized custom components (layer 3 via FFI), not primitive compositions.
- "Build a component for it" is the preferred answer for hard-to-express slides; primitives don't have to scale to all cases.

**OPEN:** exact boundary between layer-2 (theme-defined) and layer-3 (composite). Some components straddle (e.g., `Card` could be either, depending on whether color variants are theme-defined or composite-defined).

### Primitives **TENTATIVE → near-DECIDED in shape**

Initial primitive set:

- `Text` — text content (text values are *runs*, see "Text values" below)
- `Box` — generic container with size/position
- Layout primitives — `HStack`, `VStack`, `ZStack`, `Grid`, `Freeform` (absolute positioning). SwiftUI/Flutter-style stacks rather than direct CSS flex/grid translation. Mental model: stacks have axis + spacing + alignment, children claim a fixed `frame(width:)` or `flex(1)`. Direct manipulation has clean mappings (drag a divider → spacing; drag a child → reorder; drag a frame edge → fixed width). `Grid` is for cases where intrinsic-content alignment across rows matters (e.g., the three-cards-with-shared-title-column case dissolves into one `Grid` rather than three independent rows). `Freeform` (absolute positioning) is a peer mode for diagrams and freeform regions, not bolted on later.
- `Slide` — a single slide
- `Deck` — top-level deck container

Generated/custom components live outside the DSL in TS files and are imported. The DSL never embeds raw JSX or HTML elements at the layout level.

**Why stacks, not CSS flex/grid directly:** simpler mental model, fewer footguns, gestures map cleanly. `gridTemplateColumns: '35rem 1fr'` becomes `HStack { Box.frame(35rem); Box.flex(1) }` — same expressiveness, more obvious where the knob is. CSS grid-template-area magic is mostly unneeded for slide-shaped layouts; slides are rarely deeper than 2-3 stacks.

**Diagrams are not built from layout primitives.** Sequence diagrams, binary trees, request/response, etc. are *structural components* that emit positioned primitives internally. The slide-level layout vocabulary doesn't have to handle them. See "Composition and coordination" below.

### Styling **DECIDED**

Slidewright owns the styling vocabulary. Components accept a constrained set of style props built on design tokens (spacing scale, color tokens, typography tokens) plus raw escape values (`16px`, `#fff`) where necessary. **OPEN: exact token system and prop shapes.**

Generated components inside leaf primitives can use whatever CSS they want internally; the slide-level visual language is Slidewright's.

### IDs **DECIDED**

Every primitive has an explicit, stable ID written in source. IDs are generated automatically on insert, surface in the source for transparency, and survive refactors and out-of-band edits.

### Variables and scopes **TENTATIVE**

Three scopes:

- **Deck scope**: theme tokens, imported data modules, deck-wide computed values. Visible everywhere.
- **Slide scope**: values declared at the top of a slide. Visible within that slide.
- **Template scope**: iteration variables inside `<Repeat>`-like components. Visible within that template.

No nested scopes beyond this, no closures, no shadowing. Names are flat identifiers; structured values are destructured at the binding site rather than accessed via dotted paths.

Type system is small and structural: primitives (`string`, `number`, `boolean`, `color`, `spacing`, `length`, `url`), references (`componentRef`, `slideRef`, sub-anchor refs like `#boxA.right.midpoint`), containers (`array<T>`, `record<K,V>`), opaque (`js<T>` for values from TS).

**Variables are cells, not just storage.** A variable declaration can be a literal, a computed default expressed as a constraint over the rendered tree, or a manual override over a computed default with "reset to computed" as a real action. See "Cell model for values" below.

**No free-form expressions in the DSL.** Prop values are literals, names, or constrained "solve"/anchor-reference forms with a specific shape (e.g., `solve.minFitWidth(...)`, `#boxA.right`). Open-ended computations live in TS modules.

### Text values **TENTATIVE**

A `text` slot accepts either a string or a sequence of `string | Span` runs. Spans carry style props from the deck typography vocabulary (color tokens, font tokens, weight, italic). Common case is one string with no nesting; styled cases nest:

```
title:
  "Vibe Debugging with "
  Span color=accent font=mono: "autopsy-report"
```

The slot type is `text = (string | Span)+`. The editor's text-edit gesture acts on a run: clicking an unstyled run gives plain text editing; clicking a Span shows its style props in the inspector. This keeps text values structured (no inline-markup string parsing) while letting common cases stay simple strings.

### FFI to TypeScript **TENTATIVE**

Custom components are written in TS/React and exported from `.tsx` files. The DSL imports them by name. A `SlideComponent<Props>` type defines the contract a component must satisfy to be usable (this contract is itself one of the pre-v0 design topics; see above). A resolver scans the project for conforming components and surfaces them in the editor's component library.

**Templates are first-class, not just an escape hatch.** Many slides are not "compose primitives" but "fill in a template's params." Title slides and image slides are the canonical examples — a `TitleSlide` component authored in TS/CSS exposes a slot/param schema (title, subtitle, presenter, headshot, venue) and the DSL just fills it. These templates are reusable across decks. Most decks will use a small set of template-shaped slides plus a handful of bespoke composed-from-primitives slides.

Props passed to imported components:

1. **JSON-ish literals** — strings, numbers, booleans, arrays/objects of those.
2. **Named references** — to deck/slide/template-scope bindings, including imports from TS data modules.
3. **OPEN: inline TS expressions** as an escape hatch (e.g., `<Chart data={js: [1,2,3]} />`). These would be opaque to the editor (no visual manipulation) but round-trippable as captured strings. **Currently leaning toward allowing this as the escape hatch for one-off values.**

---

## Cell model for values

**The single most cross-cutting design commitment from the design pass.** Every value in a Slidewright deck is a cell with up to three layers:

1. **Literal** — a directly written value (`35rem`, `#ff8800`, `(120, 80)`).
2. **Computed default** — a constraint over the rendered tree that produces a value automatically (`solve.minFitWidth(...)`, `#boxA.right.midpoint`, "max content width across grid rows", "auto-router output for this arrow's path").
3. **Manual override** — a user-supplied value that shadows the computed default. The override stores the *override*, not the computed value, so "reset to computed" is a real action.

This is the spreadsheet model — formula + overridable cell value — applied uniformly to spatial values, layout values, style values, and content values. It is what stops the editor from feeling like fighting auto-layout: every auto-computation is locally overridable without breaking the underlying intent.

**Where it shows up:**

- **35rem column width** across cards: `solve.minFitWidth(allTitlesIn(./body))` with optional literal override (or, often better, just collapse three rows into one `Grid` and let intrinsic-content alignment handle it — a reminder that the right container choice often dissolves the need for a constraint).
- **Arrow endpoints**: bound to a shape's anchor by default (`#boxA.right.midpoint`); pinnable to a specific anchor or a literal coordinate.
- **Arrow paths**: auto-router output by default; overridable with waypoints.
- **Text auto-wrap**: computed wrap width with optional manual line breaks.
- **Table column widths**: max content width by default; overridable with dragged width.
- **Auto-font-size to fit a region**: solver output; overridable with a literal.
- **Per-element positions in semi-structured components** (binary tree node positions, etc.): layout-function output by default; overridable with pins.

**Variables and component params are the same machinery at different scopes.** A slide-scope `let titleCol = ...` is a named cell. A component param exposed for inspector editing is a named cell with a panel schema attached. Pins on a structural component's emitted children are anonymous cells keyed by element ID.

**UX implications:**
- Editor must visibly distinguish "this value is computed" from "this value is overridden" from "this value is literal."
- "Reset to computed" must be a discoverable, easy action wherever a computed default exists.
- Drag-to-override is the natural gesture; the editor decides what kind of override to write based on container/component context (see "Direct manipulation" below).
- Computed defaults must be *visible* — no spooky-action-at-a-distance. See "Editor must visualize active relations" under "Composition and coordination."

**OPEN:** the inventory of computed-default forms (`solve.*`, anchor expressions, auto-router types, etc.) and their declaration syntax. Not all values need a computed default; the model is opt-in per value.

**Time-varying cells (resolved by recent design pass).** Animations extend cells with an optional fourth layer: `valuesByState` — a map from state ID to value. Most cells leave this unset (no animation); animated cells specify per-state values. Resolution is state-aware: `resolve(handle, context): T` where `context` carries `currentState` (and `currentSlide` for cross-slide cases). v0 ships with empty context; the resolution interface and any caches/dependency-graph nodes are `(handle, context)`-keyed throughout, including in v0 where context is unused. This is the architectural commitment that lets animations grow additively without refactoring v0. See Animations and builds for the full design.

---

## Wrapper / contract design

### Slide-component contract **TENTATIVE (v0-light)**

The contract is **what the editor needs to know about a component, not constraints on what the component can do.** Internally, a component is arbitrary React; the editor only cares about what's promised to expose. The React escape hatch is always available — anything the DSL can't express can fall back to "write a React component with some slots and put the missing behavior in JS." That makes the contract minimum genuinely small.

**The most important feedback signal during early Slidewright is: "when do authors reach for the escape hatch?"** Each reach is evidence of a DSL pattern we should consider promoting. The contract stays thin and deliberately under-featured; it gets enriched only when accumulated escape-hatch evidence justifies it.

#### v0 contract shape

Every Slidewright component is a `.tsx` file exporting:

- A `slidewright` metadata object describing the component to the editor.
- A default React component that takes `{ slots, params }` as props.

```typescript
export const slidewright = {
  produces: "slide",                      // type this component produces
  slots: {
    title:     { type: "text",  required: true },
    subtitle:  { type: "text",  required: false },
    headshot:  { type: "image", required: true },
    /* ... */
  },
  params: {
    accentColor: { type: "color-token", default: "accent" },
  },
  protocols: {},                          // reserved; empty in v0
};

export default function TitleSlide({ slots, params }) {
  /* arbitrary React internals */
}
```

The editor reads `slidewright.slots` to validate DSL slot-fillings and render slot placeholders; reads `slidewright.params` to render the inspector panel; uses `produces` to know which slots can accept this component as a value. It calls the default export with resolved data. Everything else — DOM, hooks, refs, internal animations, third-party libraries — is opaque and unrestricted.

A fuller worked example showing the existing deck's title slide as a Slidewright component is in `design/sketches/title-slide.md`.

#### Slot types and `produces` share one vocabulary

A component's `produces` value is drawn from the same vocabulary as slot types. Component placement is just type-checking — same machinery as filling any other slot. No separate "kind" concept.

The v0 vocabulary:

- **Content types**: `text` (string or `(string | Span)+` runs), `block` (a tree of layout primitives or composite components), `image` (image reference), `slide` (top-level slide content).
- **Scalar types**: `string`, `number`, `boolean`.
- **Token types**: `color-token`, `spacing-token`, `font-token` — drawn from the deck theme.
- **Containers**: `array<T>`.

Examples: `TitleSlide.produces = "slide"`. `Card.produces = "block"`. `Eyebrow.produces = "text"`. A `Deck`'s slide-list slot accepts type `slide`. A `body` slot of type `block` accepts anything producing `block`. A `text` slot accepts strings or anything producing `text`.

The vocabulary is extensible later; v0 ships this fixed set and gates additions on escape-hatch evidence.

#### Variables and computed defaults in slot fillings

Handled by the DSL value system, not the contract. Anywhere a value of type `T` is expected, the DSL accepts a literal, a variable reference resolving to `T`, or a computed default producing `T` (per the cell model). The slot only type-checks. The contract doesn't need to know about variables; it just declares slot types.

Practical implication: the type vocabulary must be runtime-inspectable, so the inspector can surface compatible in-scope variables when editing a slot.

#### Resolved values at the React boundary

The editor resolves DSL values to React-friendly forms before passing them to the component:

- `text` slots arrive as React nodes (strings or fragments with `Span` styling already applied) — the component author treats them as opaque renderable values, not as run arrays.
- `block` slots arrive as resolved React children (the sub-tree is already rendered against the runtime).
- `image` slots arrive as strings (URL or asset path) ready for `<img src={...}>`.
- Scalar and token types arrive as their resolved values (numbers, strings, resolved CSS variable references).

This keeps component authors writing ordinary React, not Slidewright-runtime traversal code.

#### React interop

v0 uses **props-only**: the editor passes `{ slots, params }` as props to the default-exported component. Components are testable in isolation (just call with props) and the API is intuitive React.

A `useSlidewrightContext()` hook is reserved as a planned extension for editor-mediated state (selection state, edit mode, geometry callbacks, eventually protocol participation). Not implemented in v0; documented so we don't preclude it:

```tsx
export default function TitleSlide({ slots, params }) {
  // v0: just slots + params
  // future: const { selected, isEditing } = useSlidewrightContext();
  return <div>...</div>;
}
```

#### What's deliberately not in v0

- **Protocol implementations** — geometry exposure, anchor publishing, obstacle awareness, pin acceptance, selection forwarding. `protocols: {}` reserves the namespace; populating it later is non-breaking.
- **Custom panel widgets** — built-in widgets only. Reach for the React escape hatch and hand-rolled UI if you need something exotic.
- **Animation/build participation** — pre-v0 design topic; the contract may need to grow here once the value model decides on time-varying cells.
- **Imperative APIs** — refs/measurement callbacks for editor-side measurement. Add when needed.
- **Slot constraints beyond type** — e.g., "this slide can only appear in the first position." Not needed for v0; add a `constraints:` field if needed later.

#### Why thin (and why we can iterate)

The contract is the only Slidewright architectural piece with external consumers — user-authored components, eventually AI-generated components, eventually shared component libraries across decks. Once those exist, contract changes can't be unilateral. **In the early phase, iterate freely; commit to stability only when external consumers exist.** v0 is small enough that we are the only consumers; the contract can change as we learn. What's locked in now is the minimum needed to build — not a stable public API. The most important post-v0 signal is escape-hatch frequency: when authors keep dropping into raw React for a recurring pattern, that pattern is the priority for promotion into the DSL or the protocols.

### Coordination protocols **TENTATIVE**

Components don't directly know about each other. They opt into protocols that the editor mediates:

- **Geometry exposure**: emit children with stable IDs and known positions; other components can query "where is X?". Almost free for any layout-emitting component.
- **Anchor publishing**: declare named anchors that other components can attach to. The default for any shape is the standard 8 compass-point anchors plus center; structural components can declare semantic anchors (e.g., a binary tree publishes `node-7.right`). Arrows attaching to anchors is the most common consumer.
- **Obstacle awareness**: accept a list of rects to lay out around. Opt-in for components whose layout can be parametric.
- **Selection forwarding**: when the user clicks a sub-part, the editor selects the component and tells it which sub-part.
- **Pin acceptance**: a structural component declares which of its emitted children's positions/sizes accept pin overrides. This is the cell-with-override pattern applied to spatial values from a layout function.
- **Constraint participation**: a container can opt into evaluating constraint declarations over its children (alignment, equal-size). Lower priority than the others; defer until needed.

These protocols solve the magnifier-on-a-diagram problem (see "Composition and coordination" below) and the diagram-with-arrows problem. They are opt-in: simple components implement none, rich components implement several. **OPEN: exact API shapes — part of the pre-v0 component-contract design.**

**Constraints ladder for spatial relations**, in priority order:
1. **Arrow attachment to shape anchors** — non-negotiable for diagrams.
2. **Anchor publishing** — generalizes (1); lets structural components export semantic anchors.
3. **Persistent alignment relations** — `A.centerX = B.centerX` stored in source. Detect from gesture, offer "make persistent."
4. **Equal-size constraints** — `A.width = B.width`.
5. **General constraint solving** (Cassowary, Penrose-style) — defer indefinitely; the first four cover the bulk.

**Arrows specifically** have three independently-overridable layers, each riding the cell model: endpoint binding (auto = closest edge to bound shape; override = pinned anchor or literal), path (auto = router output; override = waypoints), style (always literal). TLDraw's failure mode — bound endpoints with non-overridable routing — comes from missing the second layer. **OPEN:** which auto-router(s) to ship (straight, orthogonal-with-rounded-corners; obstacle-avoiding deferred).

**TikZ is worth a look** as a source for "what specification features are necessary for academic-style diagrams" — anchors, named coordinates, bend control. Latex source from papers/books gives a usable corpus to study.

---

## Mediation layer

### What it does **DECIDED**

Translates between source files (the DSL) and the editor's runtime tree, in both directions:

- Source → tree: parse, resolve imports, build the in-memory representation, normalize (auto-assign missing IDs).
- Tree → source: emit canonical formatting from the AST when the editor structurally modifies the tree.

External edits (a human typing in the code panel, an AI rewriting a file) are detected via VS Code's document-change events and re-parsed. The editor keeps selection stable across re-parses by keying on IDs. In-progress gesture state is dropped when an external edit lands; the external edit takes precedence.

### Parser **TENTATIVE (tree-sitter as v0 default)**

The parser is **error-recovering**: malformed source produces a partial CST with explicit error nodes rather than a parse failure. The editor renders what's parseable; broken regions show error markers and do not block rendering of their siblings. This is the IDE-grade default, not a special accommodation for AI — humans typing in the source panel get the same recovery.

**v0 implementation: tree-sitter.** Purpose-built for IDE error recovery; declarative grammar; produces an incremental CST; JS bindings via WASM (`web-tree-sitter`) so the same parser works in the editor and in CLI tooling. The serious alternative is hand-rolled recursive descent (TS compiler / Roslyn / rustc) — higher ceiling on diagnostics quality, much more upfront work, recovery hard to get right. Defer hand-rolled until tree-sitter's diagnostics ceiling becomes painful.

**Diagnostics layer is ours.** Tree-sitter's built-in error messages are structural ("expected X, got Y"); user-friendly Slidewright-specific diagnostics (slot-type mismatches, missing-required-slot hints, "did you mean …") live in a translator layer over the CST. This is where the polish goes — error quality is one of our priorities and the diagnostics layer is small and fully under our control.

**Slide-level is the error-boundary floor.** Each slide is a top-level construct in source; the parser's recovery anchors on slide boundaries. Damage to one slide never causes loss of a sibling slide. Finer-grained recovery (a malformed slot inside an otherwise-fine slide) is automatic to the extent tree-sitter supports it; we don't have to engineer it specially.

### Round-trip discipline **DECIDED (softened from initial framing)**

The mediation layer must round-trip cleanly: source → tree → mutated tree → source must produce a file that re-parses to **the same mutated tree** (structure preserved). This is the foundational invariant. Test it relentlessly with property-based tests: random sequences of edit operations applied to a corpus of source files should produce sources that re-parse to the expected trees.

**Formatting is canonical on emit, not preserved.** When the editor writes back, it uses a deterministic formatter over the AST — it does not splice the original source. Comments are preserved (the formatter is comment-aware), but author whitespace and alignment are normalized.

This is a softening of the original "formatting preserved" framing. Rationale: recast-style emitters that preserve original formatting have a long tail of subtle bugs (whitespace context shifts, comment-attachment edge cases, trivia ownership) that take years to polish out. Our DSL is constrained enough that canonical re-emit produces nice output, and authors will be using a projectional editor — much of the source-level alignment work happens automatically, so canonical formatting on editor write is acceptable.

**Hybrid is a maybe-someday upgrade**, not a v0 commitment: canonical-on-editor-write, leave-alone on regions the editor doesn't structurally touch. Cuts the worst of both — no whitespace churn in idle regions, no infinite-recast complexity. Worth keeping in mind if author churn from canonical re-emit becomes painful in practice.

### Comments **DECIDED**

Standard leading/trailing comment attachment (Babel/recast/libCST/Roslyn convention). Each AST node carries leading-comments and trailing-comments arrays, attached at parse time by adjacency:

- Comments above a node are leading comments of that node.
- Comments on the same line after a node are trailing comments of that node.
- Comments after the last child of a parent are trailing comments of the parent.

Comments move with their attached node under structural edits. Edge cases (comment between siblings; comment above a deleted node) are heuristic-driven; canonical re-emit places the comment in approximately the right position but makes no perfect guarantee.

### IDs in source **DECIDED**

Per-slide unique, type-prefixed counter IDs. Format: `<type>-<n>` (e.g., `box-3`, `card-1`, `arrow-2`) — the Figma convention. Implementation rules:

- **Scope**: per-slide. Slide-scope references work; deck-wide cross-slide references use compound `<slide-id>.<element-id>` form.
- **Generation**: counter advances monotonically per type per slide. Inserting a new box picks the next-available number for "box" in that slide.
- **No renumbering on delete**: if `box-2` is deleted, the next inserted box gets `box-3`, not reused `box-2`. Stable under undo/redo and structural moves.
- **Renames are honored**: an author can rename `box-3` to `intro-card` for readability or to make it referenceable; the editor preserves the rename. The counter continues picking numeric `box-N`; author-named IDs don't enter the counter.
- **Normalization on parse**: if the parser sees a primitive without an ID, it auto-assigns one. The next save writes it back. ID-less DSL source is a valid input the editor normalizes; once normalized, round-trip is exact.

### VS Code integration **TENTATIVE**

The editor commits gesture changes via VS Code's TextEdit API rather than writing files directly. This:

- Routes changes through VS Code's text buffer (so the source panel stays live and consistent).
- Integrates with VS Code's file-save flow and dirty-state tracking.
- Avoids the "extension wrote a file vs. editor watched a file change" race that direct disk writes would create.
- Adds gestures to VS Code's text-buffer undo stack, one entry per gesture.

**Granularity**: each gesture commit is one TextEdit. v0 can replace the entire file as that TextEdit; future versions can compute minimal-diff TextEdits if file size makes whole-file replacement painful. Both are valid; granularity is an optimization, not a correctness concern.

### Concurrency and out-of-band edits **TENTATIVE**

For v0, AI and human edits are **serialized**: at any moment, exactly one of them is editing. Concurrent editing is deferred. This may need revisiting if/when "background AI" use cases (AI working on other slides while the human works on the current one) become a priority.

External edits to source (typed in the code panel, applied by an AI agent) are detected via VS Code's document-change events. On change:

1. Re-parse the document.
2. Update the editor's in-memory AST.
3. Restore selection if the previously selected element's ID still exists in the new tree; clear selection otherwise.
4. **Cancel any in-progress gesture** — the external edit takes precedence; the gesture's pending changes are dropped and don't enter the undo stack.

Selection-restoration depends on ID stability across the round-trip — another reason IDs are required and round-tripped through both editor edits and external edits.

### Undo/redo **TENTATIVE (v0) / OPEN (long-term)**

Two undo stacks coexist:

1. **Canvas gesture stack**: gesture-level semantic undo for direct-manipulation edits ("undo the resize," "un-edit that text").
2. **VS Code text-buffer stack**: standard text-level undo accessible from the source panel.

Each canvas gesture pushes onto both stacks at once: one semantic entry on the canvas stack, one TextEdit on VS Code's stack. They stay aligned 1:1 for canvas-originated edits.

External edits (code-panel typing, AI applying changes) push onto VS Code's stack only — not the canvas stack. **For v0, the canvas stack treats them as barriers**: canvas-undo unwinds gestures up to the most recent external edit and stops there. The user can still undo past the barrier from the source panel (Cmd-Z in the text editor), but not from the canvas.

**Barriers are a v0 concession, not the ideal end state.** Walls in the undo history are a bad user experience; users expect Cmd-Z to keep working. The better long-term design folds external code/agent edits into a single unified canvas undo stack with a snapshot of DSL contents taken just before each external edit applies. Canvas-undo through an external-edit boundary restores the pre-edit snapshot, then continues unwinding gestures from before. Nothing is frozen behind a wall. This is genuinely harder to implement (snapshots, snapshot diffing, gesture rebasing across snapshot boundaries) and we don't need it for v0, but it's the design we should grow toward — captured in the open-questions list as a real follow-up, not a hand-wave.

**Edge cases for v0:**
- Canvas-undo target invalidated by an external edit (the Box you were going to un-drag has been deleted): fail soft — show "this gesture's target no longer exists; can't undo." Surprising but correct.
- Mid-gesture external edit: gesture cancelled per the Concurrency rules above; the cancelled gesture does not enter the undo stack.

---

## Editor

### VS Code extension **DECIDED**

Slidewright runs as a VS Code extension with a webview rendering the live slide tree. The extension surfaces:

- A canvas view (the rendered slide with selection/handles/gestures)
- A slide navigator (thumbnails, list view)
- A component library (custom components in the project, drag-to-insert)
- An inspector panel (selected component's parameters)
- A presentation mode toggle

### Direct manipulation **TENTATIVE → near-DECIDED in shape**

Standard interactions: click to select, drag to move, handles to resize, double-click to edit text. Multi-select with shift/marquee. Z-order controls. Layers panel. Group operations (align, distribute).

**Gestures dispatch to the container; the container interprets them.** This is the unifying principle — the editor doesn't have heavy "modes." A gesture maps to the appropriate edit based on the container the gesture acts on.

- Drag in `HStack`/`VStack`: reorders siblings (along the axis) or sets/changes spacing (between siblings).
- Drag in `Grid`: resizes a column/row, or moves a cell.
- Drag in `Freeform`: sets x/y on the dragged element (literal cell value).
- Drag a shape inside a structural component that supports pins: writes/updates a pin override (cell model).
- Drag a frame edge on a child with a fixed `frame(width:)`: changes the literal width.
- Drag an arrow endpoint onto a shape: rebinds the endpoint to that shape's nearest anchor.
- Drag along an arrow's path: creates/updates a waypoint (cell-override on the path).

The dispatch shape needs to anticipate `Freeform` and pin-supporting components from day one even though v0 only ships stack containers. Generic dispatch, not hardcoded handlers.

**Gestures over invalid regions** fall into three categories, derived from the cell-model dependency graph:

- **Repairing gestures** — the gesture directly writes a value that resolves the validation error (e.g., inspector dropdown overwrites a number slot's invalid expression). *Always allowed*, including over invalid regions, since they fix the broken state.
- **Unrelated gestures** — the gesture acts on an element that doesn't depend on the broken one. *Always allowed*.
- **Dependent gestures** — the gesture's outcome depends on the broken region's resolved value (dragging an arrow whose target slot has an invalid reference; resizing a Box whose width is bound to a broken cell). *Blocked* until the dependency resolves.

Invalid regions render with error markers in place; sibling slides and unrelated elements continue to render normally. Slide-level is the error-boundary floor — a malformed slide does not take down its neighbors.

### Direct manipulation of structured component output **TENTATIVE → leaning DECIDED**

When a user wants to nudge an element inside a structured diagram, the primary mechanism is **pins**: drag writes a per-element override on position/size, stored alongside the structural component's data, applied after the layout function. This is the cell-with-override pattern from "Cell model for values" applied to spatial values from a layout function. "Reset this pin" returns the element to auto-layout.

Pins must have a visible indicator on the element (so the user knows "this is overridden" and can find their way back to auto). They are deliberate, marked operations.

Two adjacent mechanisms, lower priority:
- **Constraint-style** (the user marks an obstacle and the diagram reflows around it): worth supporting opportunistically when overlap is detected ("make the diagram avoid this annotation?"), via the obstacle-awareness protocol. Lower priority than pins.
- **Demote to freeform**: an explicit "explode" operation converts the structured component to a `Freeform` of its emitted primitives. Total control, total loss of structure. Escape hatch, not a default.

### Component library **DECIDED**

A panel listing all custom components in the project, populated by the resolver. Each entry shows the component's name, a preview/thumbnail, and its panel schema (so the user knows what parameters it has).

### Panel system **TENTATIVE**

Each component declares a panel schema as data:

```ts
export const meta = {
  name: "ConstrainedPair",
  params: [
    { name: "gap", type: "spacing", default: 16 },
    { name: "axis", type: "enum", options: ["horizontal", "vertical"] },
    { name: "anchor", type: "componentRef" },
  ]
}
```

The editor renders forms generically based on the schema: number fields, color pickers, spacing pickers, dropdowns, reference pickers. Each parameter input has two modes: literal value or bind-to-name (drops down in-scope names of compatible type).

**OPEN: parameter types beyond the basics, conditional visibility, parameter groups, validation, custom widgets.** Starting flat and simple; extending deliberately.

**OPEN: custom panel widgets** (components that ship their own React panel UIs for advanced cases). Powerful but complex; deferred until built-in widgets are clearly insufficient.

---

## Composition and coordination

A central design problem: how do components compose without knowing about each other? Example: a magnifier overlaying a request-response diagram. The magnifier needs to know the diagram's geometry; the diagram needs to know there's an obstacle.

**Resolution:** components don't bundle structure, layout, rendering, and interaction into one opaque unit. Instead:

- A structural component holds data and emits a sub-tree of layout primitives with stable IDs.
- The editor sees the emitted sub-tree as part of the slide's layout model.
- Other components reference emitted IDs through normal component-reference mechanisms (`#boxA.right`, etc.).
- Direct manipulation on emitted children modifies the structural component's data (or writes pin overrides via the cell model), not the children directly.
- Cross-component coordination happens through opt-in protocols (geometry, anchors, obstacles, pins, selection forwarding).

This means a request-response diagram is a function from structured data (participants, messages) to a tree of `<Box>`/`<Arrow>`/`<Text>` primitives with positions. The magnifier reads geometry from the editor's layout model and optionally tells the diagram "this region is an obstacle." Neither knows about the other.

### Three modes of diagram authoring

1. **Data-driven** — give the component data, it emits a deterministic layout (sequence diagram from message list, binary tree from `{value, left, right}`, table from rows/cols). Direct manipulation = edit the data via inspector or by clicking emitted children with selection forwarding back to the component.
2. **Pure freeform** — the diagram *is* its layout. A `Freeform` container whose data is a flat list of positioned shapes. Direct manipulation = Figma-style canvas tools (drag, multi-select, marquee, align/distribute, group, snap). The layout function is the identity.
3. **Hybrid (semi-structured)** — structured data + per-element pin overrides. Binary tree component lays things out automatically, but you can drag a node to pin its position; pins are stored alongside the data and applied last. "Reset this pin" returns to auto-layout.

v0 doesn't need to ship freeform or hybrid. The architecture must support both via the same machinery (positioned primitives with stable IDs, pin protocol, generic gesture dispatch).

### "Build a component for it" beats "fight freeform"

For things that are notoriously hard in Figma (binary trees, mock data tables, before/after diagrams), the answer is usually "have a component for it" rather than "have better freeform tools." A `BinaryTree` component running Reingold–Tilford internally beats dragging circles. A `Table` component with rows/cols/cell-style beats fighting cell auto-layout. The component wins because it knows the structure; Figma loses because it doesn't.

This implies Slidewright should:
- Ship a small built-in library of these structured composites (table, tree, sequence diagram, request/response, before/after, etc.).
- Make it fast for AI authoring to spin up new structured composites for bespoke cases.
- Treat custom components as first-class, not as the FFI escape hatch.

### Editor must visualize active relations

Constraints, bindings, and computed-default cells that aren't visible in the editor become bugs ("I moved A and B mysteriously moved with it"). The editor must surface active relations on selection: dashed lines for alignment relations, ghost handles for arrows attached to a shape, badges for size-equality groups, distinct visual treatment for computed cells vs. literal vs. overridden. This is discipline, not novel tech, but it's the most common failure mode of constraint-based design tools (Inkscape, Figma both struggle here). Don't replicate the antipattern.

### Mixing structured and freeform within a diagram

Real academic diagrams sometimes mix a well-formed sub-diagram (a sequence diagram, a flowchart) with freeform annotations (a curly arrow off to the side with a hand-written label). The clean answer is composition: two components inside a `ZStack`, one structured, one freeform. Whether this is ergonomic enough in practice is unknown until built. Worth flagging — not worth solving in advance.

---

## AI authoring

**Slidewright does not ship first-party agentic AI features.** No in-editor chat panel, no built-in invocation UX, no orchestrator competing with the user's existing coding assistant. Agents are Claude Code, Copilot, Cursor, and similar tools the user already uses; they interact with a Slidewright project as a typed codebase, the same way they would with any other project. This is a much smaller scope than the original framing of this section, and a deliberate one — building agentic UX is not in our core competency, and the user's existing tools are continually improving on their own axis.

What we *do* ship are affordances that make a Slidewright project tractable for agents. Each is also useful for human developers; nothing here is AI-specific.

### Strong TypeScript types **TENTATIVE**

The `slidewright` metadata object on a component is a typed const, and the slot/param schemas produce a derived `Props` type via TS inference. A component author writes `function TitleSlide({ slots, params })` and gets type errors if `slots.title` is misused — using TypeScript's normal type-checking as the first line of feedback. No Slidewright-specific magic; just well-typed schemas and good inference. Agents writing components see TS errors directly in their existing tooling.

### CLI tooling **TENTATIVE**

Programs an agent (or human, or CI) can invoke directly. All output structured (file:line:col with error kind) so agents can parse and iterate. Standard tool-call loop: write code → run tool → read errors → fix → repeat.

- `slidewright validate <path>` — parse + slot-schema validation + cross-file slot-fill type-check; nonzero exit on failure.
- `slidewright query slide <N>` — structured representation of slide N's parsed tree.
- `slidewright query contract <ComponentName>` — the `slidewright` metadata schema for a custom component, in a format agents can ingest without reading source.
- `slidewright list slides` / `slidewright list components` — discoverability without grep.
- (Future) `slidewright query refs <slide>` — references and IDs in scope, for figuring out what to bind to.

Structured queries spare agents the grep-the-codebase pattern and reduce the chance of agents hallucinating component shapes. They are faster, more accurate, and more token-efficient than text search.

### Project documentation aimed at agents **TENTATIVE**

A Slidewright project ships with an `AGENTS.md`-style file explaining: project layout, DSL syntax, slot model, cell model, how to write a custom component, when and how to run the validator. The agent reads it on entry and treats it as the rule set. Where agentic interfaces support skill/rule mechanisms (Claude Code skills, Cursor rules, etc.), the doc is also surfaceable in those formats.

### Error messages structured for LLM consumption **TENTATIVE**

Beyond "syntax error": every diagnostic carries an error kind (`parse` / `slot-type-mismatch` / `missing-required` / `unknown-reference` / etc.), a location, expected and actual values, and where applicable a hint ("the slot expects `text` but received a `block`; if you meant a styled run, wrap in `Span`"). Agents act on hints; humans benefit too. This is the same diagnostics layer described under Mediation layer / Parser.

### What we deliberately don't do

- No in-editor agent panel.
- No first-party prompting, context assembly, or context-window optimization — the agent owns its context.
- No first-party review/diff/accept flow — review happens in the agent's interface, or in the user's existing accept-edits posture (e.g., Claude Code's diff approval, git review).
- No concurrency machinery beyond the external-edit handling already in the Mediation layer — agents are just another source of out-of-band edits.

### Posture decision **DECIDED**

The original "AI authoring posture" pre-v0 question (strict-rejecting vs. permissive-with-repair) is dissolved by the agent-external framing:

- **Parser is permissive** (tree-sitter, error-recovering) — humans and agents both benefit from partial-tree feedback.
- **Validator is strict** — `slidewright validate` returns nonzero on schema violations, missing required slots, type mismatches, and unresolved references. Agents iterate against this.
- **Editor renders permissively** — broken regions show error markers; siblings render normally; gesture rules block dependent gestures and allow repairing/unrelated ones (see Editor / Direct manipulation).

There is no separate "AI ingestion path" with its own posture. The same parsing and validation serve humans editing source, agents writing source, and the editor itself.

---

## Presentation mode

A separate render path that:

- Strips editor chrome and gesture handlers.
- Navigates with arrow keys, click-to-advance, fullscreen.
- Renders builds and animations (see below).

**OPEN: how speaker notes, presenter view, transitions, and timed advancement are modeled.** Likely as components or as metadata on slides; defer until basic presentation works.

---

## Animations and builds

A core differentiator and an area where existing tools are weakest. **TENTATIVE (v0 architectural commitment) / DEFERRED (feature).** Slidewright treats animation as a property of cells, not a separate subsystem — a cell can have per-state values, and resolution is state-aware. v0 ships no animation features; the v0 architectural commitment is to structure the cell model so animations grow additively.

### Three categories of animation

The "animation" word covers genuinely different things, and the data model has to handle each cleanly:

1. **Enter/exit builds** — elements appearing or disappearing as the deck advances. The PowerPoint custom-animations / reveal.js fragments / Slidev v-click case. Most academic-presentation animation falls here. Modeled as a per-element existence schedule across build states.
2. **Cell-value transitions** — an element stays in place but some of its cells (position, size, color, opacity, value) change between states. Keynote Magic Move and PowerPoint Morph fall here. Modeled as per-state values on cells, with default interpolation between adjacent states for interpolatable types.
3. **Motion graphics** — Manim / After Effects / Motion Canvas-style continuous-time animations within a state. Far less common in slides; a power feature. Modeled as cells whose value is a function of continuous time progress within a state. Deferred indefinitely; not core to slide-shaped use cases.

### Discrete states as the primary model

Slidewright builds use discrete states (numbered build steps), like Keynote/PowerPoint/reveal.js. The deck advances through states with click/key. Transitions between adjacent states animate cell values automatically. Continuous-time motion graphics (category 3) are a future extension on top of discrete states (a state with a duration > 0 that interpolates internally), not an alternative primary model.

### Cells with per-state values

A cell currently has up to three layers (literal / computed default / manual override). Animations add an optional fourth layer:

- **`valuesByState`**: a map from state ID to literal/computed/override value. Most cells leave this unset; animated cells specify per-state values where they animate. Resolution at state S consults `valuesByState[S]` if present, falling through to the existing layers otherwise.

This is the DAW-automation pattern: a parameter has a static value; an automation lane optionally overrides per time/state. The static-only case stays uncluttered; animation is opt-in per cell.

### Implicit-by-default, explicit-when-needed

Most animations don't require declarations. Two layers:

- **Implicit (default).** Same ID across states with different cell values → the cells animate between states. No declaration needed. The dependency graph propagates: if `arrow.endpoint = box.right` and `box.x` has per-state values, the arrow's endpoint inherits the animation automatically.
- **Explicit (customization).** When the default doesn't suffice — custom interpolation curves or timing, declared entrance/exit effects, morphs across different IDs, structural transitions like split/join — explicit declarations supplement or override the default behavior.

The explicit form is needed for cases the implicit can't express:
- An element with a different ID in the next slide that should morph into something here (different IDs = no implicit match).
- A specific entrance or exit effect distinct from cell-value interpolation.
- Custom timing or curves on a per-element basis.

The pure-implicit-vs-pure-explicit binary is wrong. The default-implicit-with-explicit-customization model gives the common case (the box moved) for free while keeping rich cases (cross-ID morph) expressible.

### Cross-slide animations

Same machinery as within-slide builds, just operating across slide boundaries. Two cases:

- **Same ID across slides.** Implicit Magic-Move-style transition at the slide-transition boundary; engine identifies the pair automatically and interpolates resolved positions.
- **Different IDs, same content.** Explicit morph declaration links the IDs. The author writes "morph from `box-3.text` to `slide-2.title`" and the engine animates between the source's resolved end-state and the target's resolved start-state.

Within-slide builds and cross-slide transitions probably share one underlying mechanism with two surface affordances: builds are configured per-slide on a per-state basis; slide transitions are configured at deck level or per-slide-pair.

### Resolution machinery requirements

The animation engine queries cells at multiple states simultaneously: state N for "where am I now," state N+1 for "where am I going," with progress between them. This pins down the cell-resolution interface for the entire system:

- **Resolution takes a context.** `resolve(handle, context): T` where `context` carries `currentState` (and, for cross-slide animations, `currentSlide`).
- **Caches and dependency-graph nodes are keyed on `(handle, context)`**, not handle alone. The engine asks for the same cell's value at multiple contexts simultaneously; caches must keep both live.
- **Resolution must be safe at arbitrary contexts**, not just "the current state." Even v0, which only ever queries at the empty context, must be implemented this way — retrofitting state-keyed caches into a single-state-cached implementation is painful.

This last point is the load-bearing v0 commitment. Without it, the cell model could be implemented with single-state caching as a v0 simplification, and adding animations later would require ripping out the cache layer.

### v0 architectural commitment

v0 ships no animation features. The architectural commitment is just enough to keep the door open:

- Cells are addressable handles, not eagerly-resolved values.
- `resolve(handle, context): T` is the resolution interface; context is `{}` in v0.
- Caches and dependency graph are `(handle, context)`-keyed.
- The cell type definition reserves space for the `valuesByState` layer (e.g., as an optional field, undefined in v0).

That's it. The DSL surface syntax for per-state values, the timeline UI, the transition declaration form, the interpolation algorithms — all deferred.

### What's deferred

- DSL surface syntax for per-state values (the cell model represents them; the surface form is a future grammar addition).
- Surface syntax for explicit transitions, morphs, and entrance/exit effects.
- Timeline UI in the editor.
- Per-type default interpolation algorithms (numeric blend, color blend in HSL, position blend in 2D, etc.).
- Custom interpolation curves and easing functions.
- Continuous-time motion graphics within a state (category 3).
- Slide-to-slide transition primitives (fade, slide, etc.) distinct from element-level morphs.
- The `protocols.animation` slot on the slide-component contract — reserved space in v0; populating it is non-breaking.

Worked examples of how each animation category looks in candidate source live in `design/sketches/animations.md`.

---

## v0 scope

The pre-v0 design pass is **complete**. All four big topics have committed v0 architectural shapes (see "Pre-v0 design topics" above and section cross-references). Implementation can begin.

### What v0 must prove

The fundamental bet: **bidirectional projectional editing of a typed component tree, with stable round-tripping, works.** Everything else is scope.

### v0 sequencing **TENTATIVE**

v0 is broken into incremental milestones. Each ends in a runnable demo of the substrate at that level — we don't wait for full v0 before exercising the system. The split was made deliberately: direct manipulation is meaningful work that depends on a working parser+renderer, so the first cut (v0.0) defers all canvas/gesture concerns to validate the foundation in isolation.

**v0.0 — Read-only viewer.** Parser + renderer + minimal cell runtime. No canvas, no editing.
- Tree-sitter grammar for the brace-block DSL.
- Diagnostics translator over the CST (Slidewright-friendly errors on top of tree-sitter's structural errors).
- Cell-resolution runtime (`resolve(handle, context): T` interface; `(handle, context)`-keyed cache; v0 context is empty; literals only — no computed defaults yet).
- Slide-component contract consumer: load `.tsx` files with `slidewright` metadata, validate slot fillings, dispatch to default React export with resolved `{ slots, params }`.
- Render via the existing slide-template scaffold (`Presentation` runtime in `src/`); Slidewright produces React elements; scaffold handles navigation, scaling, notes, print.
- Tiny reference deck: title slide + one content slide written in the DSL with one or two custom components.
- CLI: `slidewright validate` (parse + slot-schema validation; structured diagnostic output).
- **Demo**: author hand-writes a `.sw` file, runs `vite`, sees the slide rendered. Edits to source hot-reload.

**v0.1 — VS Code extension with read-only canvas.**
- VS Code extension scaffolding; webview integration.
- Side-by-side: source panel + canvas.
- Selection sync: click an element in canvas → highlight in source; cursor in source → highlight in canvas.
- File-watcher → re-parse → re-render. No editing gestures yet.
- **Demo**: open a `.sw` file in VS Code, see it rendered live in a side panel; edits in source reflect instantly; selection round-trips between panes.

**v0.2 — First interactive gesture: drag-to-move + round-trip emit.**
- Canonical re-emit pipeline (AST → source via the formatter).
- VS Code TextEdit API integration for canvas → source writes.
- Drag-to-move gesture on `Freeform`-positioned elements (the simplest gesture that exercises the full edit → emit → re-parse loop).
- Cell model with literal overrides (drag writes a literal x/y).
- Initial round-trip property test on a small corpus.
- **Demo**: drag a Box, see its `x` and `y` update in source; source change re-renders the canvas.

**v0.3 — Text editing + resize + selection model.**
- Double-click to edit text on text-typed slots.
- Resize handles on Box-like elements.
- Single-selection model (multi-select deferred).
- Inspector panel (read-only — shows resolved cell values for the current selection).
- **Demo**: edit text and resize boxes through canvas; inspector reflects current state.

**v0.4 — Slot-aware editing + external-edit reconciliation.**
- Click into named slots (typed slot selection in canvas).
- Empty-slot placeholders.
- Inspector panel becomes editable for params.
- External-edit detection (typing in source while canvas is open): re-parse, restore selection by ID, cancel mid-gesture.
- Canvas gesture undo stack with VS Code text-buffer integration; external-edit barriers.
- **Demo**: edit slides via canvas AND via source, with selection preserved across external edits and proper undo behavior.

**v0.5 — Reference deck + round-trip harness + first polish.**
- Re-create the existing `decks/ne-agents-day-2026/` deck (or a meaningful subset) in Slidewright DSL with custom components.
- Round-trip property test harness on the full reference deck plus a corpus of synthesized edit sequences.
- Diagnostics layer polish; better error rendering with slide-level error boundaries.
- Markdown rendering in `text-markdown`-typed slots.
- **Demo**: the reference deck runs end-to-end in Slidewright; edits via canvas and source work together; round-trip property tests pass at high volume.

v0.5 is the demoable v0 — it satisfies the success criteria below.

### What v0 includes (cumulative across phases)

- The DSL: brace-block grammar with the slot model, cell model, layout primitives (`HStack`, `VStack`, `ZStack`, `Grid`, `Freeform`), basic primitives (`Box`, `Text`, `Image`).
- The slide-component contract: `{ produces, slots, params, protocols: {} }` plus default React component.
- Custom components: TitleSlide, ImageSlide, ContentSlide, plus a few composites (Card, CardRow) authored against the contract.
- Stable IDs in source (per-slide, type-prefixed counter).
- Parser and canonical-emit that round-trip structure cleanly. Comments preserved.
- VS Code extension with side-by-side source + canvas.
- Selection, drag-to-move, resize-with-handles, double-click-to-edit-text.
- Gesture changes write back to source via TextEdit API; source changes re-render the canvas.
- External-edit reconciliation, gesture undo with external-edit barriers.
- A test harness for the round-trip property exercised at scale.

### What v0 explicitly excludes

- Multi-select, group operations, alignment, distribution.
- Inline TS expressions in DSL (`{js: ...}`) — deferred.
- AI integration as a first-party feature (per AI authoring section, Slidewright doesn't ship agent UX; agents are external).
- Presentation-mode UI beyond what the existing scaffold already provides.
- Animations and builds (per Animations and builds — value model is reserved space; no surface or runtime).
- Computed defaults and the "solve" expression form on cells (literals only in v0).
- Structured diagrams, magnifiers, coordination protocols beyond what's reserved (`protocols: {}` empty).
- Theme system (per Styling — minimal tokens only).

### v0 success criteria

A user can:

1. Open a Slidewright project in VS Code.
2. See multiple slides rendered in the webview.
3. Click a Box, drag it to a new position; the source file updates with the new position.
4. Resize a Box with handles; the source updates.
5. Edit text in a Text element; the source updates.
6. Edit the source file directly; the canvas re-renders to match; selection survives the edit if its element still exists.
7. Undo their canvas gestures via Cmd-Z, with external edits acting as barriers (per Mediation layer / Undo/redo).
8. Run the round-trip test harness on the reference deck plus synthesized edit sequences with zero failures.

If those work reliably, the architecture is proven and we can scope v1.

---

## Build process and decision-making

This is a research-flavored project with many open questions. The intended process:

0. **Pre-v0 design pass on the four big topics** (component contract, animations/builds value-model implications, round-trip mechanics, AI authoring posture). These are the architectural commitments v0 has to be built against; ducking them produces a v0 that can't grow.
1. **Build v0 narrowly.** Don't generalize the architecture beyond what v0 needs, but don't bake in assumptions that preclude later generalization.
2. **Test the round-trip property aggressively.** Property-based testing is appropriate. Build the test harness early.
3. **Document decisions as they get made.** When an OPEN question gets resolved, update this doc with the decision and the reasoning. When a TENTATIVE choice gets validated by experience, promote it to DECIDED.
4. **Resist scope creep.** Many features in this doc (animations, AI, structured diagrams) are exciting and will be tempting to start early. Don't. v0 is about proving the substrate.
5. **Revisit decisions when implementation reveals new information.** The DSL syntax, the contract shape, and the gesture semantics are all things that will benefit from a few weeks of using the v0 editor before being finalized.

---

## Open questions, consolidated

For ease of reference, the major unresolved questions:

**Pre-v0 design topics:** all four resolved. See Pre-v0 design topics above for cross-references.

**Resolved by recent design pass:**
- ~~Slide-component contract shape~~ → v0-light shape committed: `{ produces, slots, params, protocols: {} }` plus default React component taking `{ slots, params }` props. See Wrapper / contract design.
- ~~Round-trip mechanism~~ → canonical re-emit on editor write; structure preserved, comments preserved, formatting normalized; per-slide type-prefixed counter IDs; tree-sitter parser with error recovery. See Mediation layer.
- ~~Undo/redo reconciliation between Slidewright and VS Code~~ → canvas gesture stack + VS Code text-buffer stack, each canvas gesture pushes onto both 1:1; external edits are barriers in the canvas stack for v0. Long-term direction (snapshot+fold, no walls in history) noted but not v0. See Mediation layer / Undo/redo.
- ~~AI authoring posture~~ → dissolved by agent-external framing. No first-party agentic features; instead provide TS types, CLI tooling, structured diagnostics, and `AGENTS.md`-style docs. Parser permissive, validator strict, editor renders permissively. See AI authoring.
- ~~Animation/build value model~~ → cells gain optional `valuesByState` layer; resolution is `(handle, context)`-keyed throughout, including v0; three categories (enter/exit, cell-value transitions, motion graphics) surfaced; implicit-by-ID-match defaults with explicit customization for non-trivial cases; discrete states as primary, continuous-time motion graphics as future extension. See Animations and builds.
- ~~Layout primitive granularity~~ → stacks (HStack/VStack/ZStack) + Grid + Freeform.
- ~~Gesture semantics for layout-controlled positions~~ → gestures dispatch to container; container interprets. Gestures over invalid regions split into repairing / unrelated / dependent.
- ~~Direct manipulation inside structured components~~ → pins as primary mechanism; constraint-style and demote-to-freeform as adjuncts.
- ~~DSL slot model and surface syntax~~ → typed named slots in a brace-block surface syntax (HCL/Rust-flavored); capitalization-disambiguated component-vs-slot; newline-or-comma separators inside braces; lists in `[...]`; triple-quoted multi-line strings with adjacent-literal concatenation; Markdown allowed in `text-markdown`-typed slots; per-invocation implicit-children rule. See Form.

**Still open (lower priority, OK to defer):**
- Whether to allow inline TS expressions in DSL prop positions
- Token system specifics (spacing scale, color model, typography vocabulary)
- Coordination protocol APIs (full shape pinned by component-contract design)
- Panel schema extensions (conditional visibility, custom widgets)
- Presentation features (notes, transitions, timed advance)
- Reusability across decks (workspace structure, shared component packages)
- Inventory of computed-default forms in the cell model
- How structured + freeform compose within a single diagram
- Auto-router choice(s) for arrows (straight, orthogonal-with-rounded-corners, obstacle-avoiding)
- Full inventory of CLI query commands beyond the v0 set (`query refs`, etc.)
- **Long-term: snapshot-and-fold undo model** (post-v0; replaces external-edit barriers with a unified history)
- **Long-term: hybrid emit** (canonical-on-editor-write, leave-alone on idle regions; replaces pure canonical re-emit if author churn becomes painful)
- **Long-term: hand-rolled parser** (post-v0; replaces tree-sitter if its diagnostics ceiling becomes painful)

Most of these should not be answered before v0. Several can only be answered by living with v0 for a while.

---

## Reference: prior art and adjacent tools

For context, not as targets to imitate:

- **Projectional editors**: JetBrains MPS, Subtext, Lamdu — for the general problem of projectional editing over structured code.
- **Visual editors over React**: Plasmic, Framer (code components), Tempo, the older Playroom — for round-tripping between visual edits and JSX.
- **Slide tools**: Keynote, PowerPoint, Pitch, Tome, Gamma (GUI); Slidev, reveal.js, Marp (code).
- **Animation tools**: Manim, Motion Canvas, After Effects — for the temporal/build dimension.
- **Component+inspector models**: Unity, Unreal Blueprints, Houdini, Blender — for the panel-driven extensibility model.
- **Diagram tools**: Mermaid, D2, Penrose, tldraw — for structure-vs-layout in diagrams.
- **DSL/embedding**: MDX, Astro, Svelte — for embedding components from a host language into a custom syntax.

None of these solve Slidewright's exact problem. The bet is that the synthesis — projectional editing over a typed component DSL with TS/React FFI, AI co-authoring, slide-domain features — is novel and worth building.
