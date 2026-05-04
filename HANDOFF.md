# Slidewright handoff

You're picking up Slidewright development. The pre-v0 design pass is complete; implementation can begin. This document is your entry point.

## What Slidewright is

A projectional editor for code-based slide decks, intended for human/AI co-authoring of richly designed, animated, structured slides. The substrate is a typed component tree expressed in a custom DSL with TypeScript/React for component internals. The editor presents direct manipulation over the rendered tree; edits round-trip back to source.

The bet: bidirectional projectional editing of a typed component tree, with stable round-tripping, works.

## Where things live

- **`SLIDEWRIGHT.md`** (repo root) — design doc. Source of truth for design commitments. Read this first.
- **`design/sketches/`** — worked DSL examples with commentary. Three files: `three-obstacles.md` (motivating example, captures the syntax bake-off), `title-slide.md` (custom-component example), `animations.md` (per-state-value examples for the future animation system).
- **`decks/ne-agents-day-2026/`** — the existing React+JSX slide deck (NOT Slidewright source). This is the reference target we want to be able to recreate in Slidewright.
- **`src/`** — the existing slide-template scaffold (`Presentation.jsx`, `Slide.jsx`, `CodeBlock.jsx`). Slidewright integrates with this scaffold rather than reinventing slide-runtime concerns (navigation, scaling, notes, print).

## Status: pre-v0 design complete

The design pass resolved four big architectural topics. Each is captured in SLIDEWRIGHT.md with the v0 commitment plus notes on what's deferred:

1. **Slide-component contract** — `{ produces, slots, params, protocols: {} }` plus default React component taking `{ slots, params }` props. Thin by design; React escape hatch always available.
2. **Round-trip mechanism** — canonical re-emit on editor write (structure preserved, comments preserved, formatting normalized), per-slide type-prefixed counter IDs (Figma convention), tree-sitter parser with error recovery.
3. **AI authoring posture** — no first-party agentic features; agents are external (Claude Code, Cursor). We provide TypeScript types, CLI tooling, structured diagnostics, and `AGENTS.md`-style docs.
4. **Animations and builds** — cells gain optional `valuesByState` layer; resolution interface `resolve(handle, context): T` is `(handle, context)`-keyed throughout v0 even though context stays empty. Three animation categories surfaced (enter/exit, cell-value transitions, motion graphics); discrete states as primary; implicit-by-ID-match defaults with explicit-customization layer. v0 ships none of it; the architectural shape is what's committed.

Plus a fifth resolution from the syntax discussion:

5. **DSL surface syntax** — brace-block form (HCL/Rust struct literal flavor). Component invocations `Name { body }`; slot fills `name: value`; capitalization disambiguates components from slot names; newline-or-comma separators; lists in `[...]`; triple-quoted multi-line strings with adjacent-literal concatenation; Markdown allowed in `text-markdown`-typed slots; per-invocation implicit-children rule (children are implicit only when the invocation fills no other slot). See `SLIDEWRIGHT.md / Form` for the full spec, and `design/sketches/three-obstacles.md` for the bake-off that produced this choice.

## Where to start: v0.0 implementation

v0 is split into phases (`SLIDEWRIGHT.md / v0 sequencing`). v0.0 is the read-only viewer — no canvas, no editing, just parser + renderer. Concretely:

1. **Tree-sitter grammar** for the brace-block DSL. Spec is in `SLIDEWRIGHT.md / Form`.
2. **Diagnostics translator** over the tree-sitter CST that emits Slidewright-friendly error messages. Tree-sitter's built-in errors are structural; wrap them with semantic ones.
3. **Cell-resolution runtime**:
   - `resolve(handle, context): T` interface.
   - `(handle, context)`-keyed cache (even though context is `{}` in v0).
   - Literal values only; no computed defaults yet (those come in v0.2+).
4. **Slide-component contract consumer**:
   - Load `.tsx` files exporting a `slidewright` metadata object.
   - Validate slot fillings against the slot schema.
   - Dispatch to the default React export with resolved `{ slots, params }`.
5. **Renderer**: walk the parsed AST, resolve cells, dispatch to components, produce React elements that drop into the existing scaffold's `Presentation` runtime.
6. **Reference deck**: a tiny `.sw` deck (title slide + one content slide) plus the corresponding `.tsx` components.
7. **CLI**: `slidewright validate` — parse + slot-schema validation; structured diagnostic output (file:line:col with error kind).

**v0.0 demo**: author hand-writes a `.sw` file, runs `vite`, sees the slide rendered. Edits to source hot-reload.

## Open implementation decisions you'll hit early

These weren't worth pinning down in the design pass but you'll need to make calls during v0.0:

- **Tree-sitter grammar specifics**: how exactly to encode the brace-block grammar with capitalization rules, newline-or-comma separators, adjacent-string concatenation, etc. Tree-sitter's grammar.js DSL handles all of these; the call is just shape, not whether-possible.
- **Project layout convention**: where do `.sw` files live in a Slidewright project? `slides/`? Alongside their custom components? Workspace structure for shared components across decks is in the open-questions list — for v0.0, just pick a convention.
- **`.sw` file extension**: confirmed — `.sw`. (Used in earlier sketches; could be revisited.)
- **Vite integration shape**: the existing scaffold uses Vite. The Slidewright integration should be a Vite plugin (or a library that produces React elements consumed by user code). Lean toward "library that produces React elements" first; Vite plugin can come later if compilation needs warrant it.
- **How `import headshotImg from './headshot.jpg'` works in the DSL value context**: the DSL needs to resolve external asset references somehow. Probably the Slidewright runtime accepts a context object that maps identifiers to resolved values, populated from the deck's TS modules.

## What v0.0 does NOT need

Resist the temptation to build any of these in v0.0; they have their own phases:

- VS Code extension (v0.1).
- Any canvas / direct-manipulation gestures (v0.2+).
- Round-trip emit (v0.2 — read-only viewer doesn't need to write).
- Computed defaults / `solve.*` forms (v0.2+).
- External-edit reconciliation, undo stacks (v0.4).
- Markdown rendering in text slots (v0.5 polish).
- Animation features of any kind (post-v0).
- AI invocation UX (we're not building this; agents are external).

## Key files to update as you go

- **`SLIDEWRIGHT.md`** — promote TENTATIVE → DECIDED as choices get validated by experience. Add new OPEN questions as they surface. Don't let it go stale.
- **`design/sketches/`** — when you validate a sketch by implementing against it, update the sketch's commentary with what you learned. Add new sketches when you encounter representative cases that aren't covered.
- **This file (`HANDOFF.md`)** — keep it terse. It's the entry point for the next fresh agent context. Update the "Status" section as phases complete.

## Build process

Per `SLIDEWRIGHT.md / Build process and decision-making`:

1. Build narrowly. Don't generalize beyond what the current phase needs, but don't bake in assumptions that preclude later generalization.
2. Test the round-trip property aggressively once v0.2+ lands. Property-based testing.
3. Document decisions in SLIDEWRIGHT.md as they get made.
4. Resist scope creep. Animations, AI, structured diagrams are all exciting and tempting. Don't.
5. Revisit decisions when implementation reveals new information. The DSL syntax, the contract shape, the gesture semantics, and the implicit-children rule are all things that may evolve once v0.0 + v0.1 are real.

## One asymmetry worth holding in mind

The contract is the only Slidewright architectural piece with external consumers (user-authored components, eventually AI-generated components, eventually shared component libraries across decks). Iterate freely on internal architecture; commit to contract stability only when external consumers exist. v0 has no external consumers yet.
