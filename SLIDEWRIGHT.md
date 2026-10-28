# Slidewright design

Slidewright is a projectional editor for code-based slide decks. Human visual
edits and source edits from humans or external coding agents share one authored
representation: a typed component tree in the `.sw` DSL. Custom components use
TypeScript and React.

This document holds durable architecture, contracts, and rationale. It describes
supported contracts unless a section explicitly discusses extension constraints.
[README.md](README.md) covers setup and repository navigation. Ostraka items hold
work discussions, progress, proposals, and outstanding decisions; the project
brief is a concise orientation summary. Historical designs remain in git history
and illustrative [design sketches](design/sketches/README.md).

## Architecture overview

The boundaries separate authoring semantics from rendering and host services:

- The [runtime](slidewright/runtime/contract.ts) owns DSL values, component
  contracts, parsing, validation, resolution, and rendering.
- The [canvas](slidewright/canvas/App.tsx) owns selection, authoring controls,
  gesture coordination, previews, and source-edit transactions.
- A [Host](slidewright/canvas/host.ts) supplies canonical full-deck source,
  environment-specific asset URLs, and source-selection synchronization.
- Component modules own their rendering and opt-in editing behavior. Hosts
  provide a component registry; the runtime does not discover arbitrary TSX
  files or compile them itself.
- Presentation renders slide content without authoring chrome. Components may
  own internal interactions or animation, while host navigation and source-backed
  editing remain separate responsibilities.

The runtime does not depend on editor-specific APIs. Host integrations handle
VS Code buffers, browser persistence, filesystem synchronization, and asset
packaging. A source mutation crosses the Host boundary rather than bypassing the
host's document or persistence model.

## DSL design

### Form

A small brace-block grammar makes the supported, round-trippable language
explicit. General computation and arbitrary DOM/CSS belong in component modules.
DSL source describes component composition through typed named slots and params.

```sw
Deck {
  slides: [
    Slide {
      label: "Introduction"
      content: Freeform {
        children: [
          TextBox {
            x: 120 y: 100 width: 720 height: 240
            content: [Paragraph { content: ["Hello " Span { weight: "700" content: "world" }] }]
          }
        ]
      }
      notes: "Opening remarks"
    }
  ]
}
```

Component invocations use `Name { ... }`; fills use `name: value`. Newlines or
commas separate entries. Lists use brackets. Values include strings, numbers,
booleans, `null`, `omit`, name references, components, lists, and native OKLCH
color literals. Indentation is cosmetic; emission uses deterministic formatting.
Triple-quoted strings support multiline text with dedenting. Adjacent ordinary
string literals concatenate; triple-quoted strings do not adjacency-concatenate.
Separately authored list entries remain separate values.

A component body containing only component invocations fills its `children`
slot implicitly. Mixing named fills with children requires an explicit children
fill. This is a rule of the invocation's syntax, not an inference from schema.
Structural edits preserve implicit children when that form remains applicable.

### Variables and scopes

Name references resolve through the supplied [scope](slidewright/runtime/scope.ts);
asset bindings and color-token lookup have distinct resolution responsibilities.
A reference retains its authored identity even when its displayed value is known.
Resolution is not permission to replace a shared reference with a literal.

The DSL has no general JavaScript expression, closure, constraint-expression, or
anchor-reference syntax. New binding or computation forms need an explicit
source and write-back contract. Scope extensions must specify visibility and
ownership rather than guessing from a rendered value.

### Parser

The [parser](slidewright/runtime/parser.ts) is a hand-written recursive-descent
parser. The [tree-sitter grammar specification](slidewright/grammar/grammar.js)
is documentation, not the runtime parser. One small language and contextual
diagnostics favor keeping parsing and recovery under the runtime's control.

Parsing recovers where possible and reports source-located diagnostics.
Validation checks the component contracts. Partial rendering provides feedback
while source is being authored; an invalid partial AST is not a safe basis for a
structural write. Errors should identify the location, failing contract, and
useful repair information for both human and automated authors.

### Comments

Leading and trailing comments attach to AST nodes by adjacency and travel with
those nodes during structural edits. Comments after a parent's last child can
attach to that parent. Exact placement, including same-line comments and deletion
or reordering boundaries, is heuristic. Edits must preserve meaningful comment
ownership rather than treating comments as disposable formatting.

## Wrapper / contract design

### Slide-component contract

The contract describes what the editor can understand about a component.
Internals remain ordinary React. Repeated needs that force authors into custom
code are evidence for extending the shared vocabulary; a single unusual
component does not justify a new framework-wide abstraction.

A component module exports `slidewright: ComponentMeta` and a default React
component. It may also export a `canvas` adapter. The authoritative types live in
[contract.ts](slidewright/runtime/contract.ts).

- `produces` declares the output type; `slots` declare accepted types and whether
  a fill is required. Placement uses these same types.
- `params` declare scalar/token settings and defaults.
- `category`, `description`, and `insertion` describe library presentation and
  insertion behavior. They do not alter content typing.
- `editor.inspector` explicitly controls inspector membership. Schema and
  inspector presentation are independent.
- `inlineEditing` declares inline editing ownership.
- `protocols` reserves an extension namespace; it is not a working geometry,
  constraint, or animation protocol implementation.

### Slot types and `produces` share one vocabulary

Content types include `text`, `text-document`, `list-item`, `block`, `image`, and
`slide`; scalar types include `string`, `number`, and `boolean`; token types
include `color-token`, `spacing-token`, and `font-token`. `array<T>` declares a
list of values of a supported type. Compatibility follows the runtime contract,
including the special grammar for text documents and list items.

`omit` explicitly suppresses an optional slot's empty placeholder. It differs
from a missing fill and from `null`. Components receive `slotsState` values of
`filled`, `missing`, or `omit`, so intentionally omitted content can collapse
without hiding an unfinished slot.

### Resolved values at the React boundary

Components receive `{ slots, params, slotsState }`. Inline text, text documents,
and block slots arrive as renderable React values; image slots resolve to asset
strings; scalar and token settings resolve to the corresponding runtime values.
Components should not need to walk the DSL AST just to render their slots.

Generic primitives, theme-specific typography roles, and structural composites
serve different purposes. A theme can define titles and captions without making
them universal primitives. A diagram component can own data and layout without
requiring authors to manually place every emitted shape.

Arbitrary output from a React component does not become independently editable
source. Editing a generated part requires an explicit ownership/write-back
contract; otherwise the component is an opaque authored unit.

## Mediation layer

### Round-trip discipline

The invariant is semantic: parsing the emitted result of an AST edit must recover
the intended edited structure. Canonical formatting may change whitespace.
Comments, references, and unaffected authored structure remain meaningful parts
of the document.

The [source-edit pipeline](slidewright/canvas/ast-edits.ts) mutates a clone of the
matching document snapshot and emits exact source splices, preserving untouched
authored text. It validates the result by reparsing complete authored owners,
with a full-parser fallback for unsafe boundaries or invalid intermediate syntax.
Mutation failure or a stale base revision aborts the edit. Post-edit selection
ranges come from the validated new AST; emitted edits must satisfy round-trip
invariants and intended component contracts.

### Revisioned documents

Interactive hosts share a `DeckDocument` containing authoritative source,
revisioned AST/diagnostic snapshots, and session-local occurrence handles.
Transactions carry a base revision, origin, UTF-16 change ranges and affected
owners. Cached results belong to that revision. `DeckResolver` retains unaffected
slide results and relocates source markers/diagnostics; shared tokens, assets and
registry changes invalidate conservatively. `loadDeck` remains the one-shot
CLI/SSR adapter. Chapter/order frames are separate from retained slide content.

CodeMirror receives mapped changes rather than replacing its state on ordinary
updates. Its folding index repairs lexical windows with the real DSL lexer.
External history barriers remain explicit. VS Code queues local writes against
confirmed native document versions, checks ranges before applying them, and
restores native authority on rejection or competing edits. Selection messages
also carry versions so stale offsets cannot target newer source.

The [document contract](slidewright/runtime/document.md) describes handle
lifecycles, parsing boundaries, invalidation, synchronization and acceptance tests.

### Rendered-tree to AST mapping

The loader stamps authored component occurrences with source ranges. Canvas hit
testing uses those markers and the registry to find the authored selection target;
component authors do not need to forward source metadata through their DOM.

Selection distinguishes component occurrences, filled slots, empty slots, and
the active slide. An empty slot is identified by its parent occurrence and slot
name because no fill span exists yet. Text-document internals belong to the
TextBox's text editor rather than becoming separate canvas drill targets.

### IDs in source

Source spans identify occurrences in a particular source snapshot; they are not
stable IDs across emission. Session-local occurrence handles survive mapped edits
to retained components, and retire on deletion or explicit replacement. They do
not require IDs in the DSL. Edits recover selection ranges from mapped handles
or the validated new AST. They must respect a user's new or
empty canvas selection rather than restoring an abandoned target.

The language does not require or auto-insert a persistent ID on every primitive.
Runtime cell handles, editor-session leaf identities, and authored references
serve different roles. Future persistent identity must define its scope and
lifecycle explicitly; transient spans cannot substitute for it.

### Concurrency and out-of-band edits

Source is authoritative outside a live draft. External replacement cancels
in-progress gestures and text drafts so captured source spans and params cannot
write over newer work. Source-driven navigation also ends a text draft without
applying it to a different slide. Selection restoration across a replacement is
best-effort; stale targets must fail safely.

Persistence adapters must keep external updates and pending local drafts
distinguishable. Revision checks and recovery copies protect against silently
replacing an independently changed document. Presentation, source projections,
and canvas edits all refer to the same canonical deck.

### Undo/redo

A completed user gesture or text-edit session forms one canvas undo transaction;
previews are not separate source commits. Cancellation restores the pre-gesture
state. A text draft can have its own local undo history before committing once.

Canvas undo and source-editor history have separate ownership. External source
changes are history barriers in the existing implementation. A unified history
must explicitly reconcile those ownership boundaries rather than replay stale
snapshot-relative operations. Command routing follows focus so typing or undo in
a text editor does not accidentally operate on canvas objects.

## Editor

### Gesture model and shape adapters

The canvas owns pointer lifecycles, tool policy, and gesture coordination.
Component behavior lives with the component in a registered
[ShapeAdapter](slidewright/canvas/shape-adapter.ts) or
[LayoutAdapter](slidewright/canvas/layout-adapter.ts). The runtime carries the
adapter opaquely and remains canvas-independent.

Visual previews derive from authored params plus the active gesture delta.
Shapes, outlines, and handles use the same preview state; independently mutating
DOM positions creates competing sources of geometry. `translate` and `transform`
are framework-known operations. Bespoke handle gestures carry adapter-owned
payloads through the opaque channel; the canvas does not inspect those payloads.
Preview and commit must interpret the same delta consistently.

Layout parents can own child reordering or gap edits. A body drag in a positioning
container edits coordinates; a stack gesture edits the stack's ordering or
spacing. A gesture must change the semantic owner that can represent its result,
not whichever DOM descendant happened to receive the pointer.

### Coordinate frames and layout measurement

Bounds, pointer deltas, and selection overlays must agree on their coordinate
frame. Freeform and Group provide local positioning contexts. Mixed-context
selection needs bounds converted into a common slide frame; combined transforms
require compatible adapters and positioning contexts.

Flow-layout bounds come from committed DOM layout, not just component params.
[Layout measurement](slidewright/canvas/layout-measurement.ts) subscribes to
layout changes. Measurements must follow element replacement and slide
mount/unmount lifecycles rather than retaining observers on detached elements.

### Persistent grouping

A [Group](slidewright/canvas/grouping.ts) stores children in local coordinates.
Grouping and ungrouping preserve visual geometry, authored content, and comments.
The local origin remains fixed when children extend beyond it; the selection
frame follows the recursive union of member bounds. Empty groups use their
stored size as a fallback. Transform support follows adapter capabilities rather
than assuming every selected unit supports resizing.

Free positioning operations require a shared coordinate system and directly
editable positions. They must not silently replace authored bindings to force an
alignment, grouping, or distribution result.

### Layouts, slots, and insertion

Insertion is registry-driven. A component's insertion factory receives the
intended gesture, target slot type, optional design-space rectangle, and insertion
index. It returns an authored AST component or declines the target. Metadata and
factories live with components instead of extending a central switch for every
new shape.

Drop compatibility follows `produces` and slot typing. Empty-slot and array-gap
insertion preserve their respective ownership; filling an empty slot does not
imply replacing an already-filled scalar slot. Omitted slots do not expose an
empty-slot drop target. Nested gap hit testing must leave outer and inner
insertion sites reachable.

### Inspector and source surfaces

Inspector presentation is independent of schema. Text-specific authoring
controls own range/caret formatting, paragraph/list structure, and whole-box
text defaults. Generic fields remain appropriate for components without an
explicit inspector policy. Notes have a dedicated source surface.

Deck, active-slide, and notes source views are projections of the Host's canonical
full-deck source. Selection offsets stay global; edits translate back into that
source rather than creating an independent slide-sized document. Host
replacements are external updates to a source editor's history.

Authoring icon buttons use named `lucide-react` imports with accessible names,
tooltips, and visible keyboard focus. Enabled/disabled and authored/mixed state
must remain understandable without relying on the icon alone.

## Structured text editing

TextBox sizing is source-backed through `sizing: "auto-width"`, `"auto-height"`,
or `"fixed"`. Auto width fits the content; auto height wraps at `width` and grows
vertically; fixed uses both `width` and `height`. New boxes default to auto width
and are placed with a click into a focused, empty text editor. Dismissing an
empty TextBox deletes it only when it is a direct child of Freeform; nested
boxes remain. Without an explicit mode, authored width and height
preserve legacy fixed sizing, width alone implies auto height, and no width
implies auto width. The Text sizing control preserves the rendered dimensions
when switching modes. Horizontal resizing of an automatic box chooses auto
height; corner or vertical resizing chooses fixed size. Shrink-to-fit applies
only to fixed boxes.

### Text-document grammar

`TextBox.content` uses `text-document`, distinct from general inline `text`. Its
canonical value is an ordered sequence of Paragraph and List blocks:

```sw
content: [
  Paragraph { content: ["Intro " Span { color: accent content: "text" }] }
  List {
    style: "decimal" start: 3
    items: [ListItem { content: ["First item"] }]
  }
]
```

Paragraph and ListItem content is an inline sequence of strings, marked Spans,
registered `produces: text` elements, and compatible references. A ListItem can
own a nested List through `children`; its content is not general block content.
Each List owns marker style, start, and typed items. Paragraphs and list items own
spacing, alignment, line height, and indentation.

A single string remains accepted as one-paragraph shorthand. Its first structured
edit canonicalizes to the document grammar. Structured text remains ordinary DSL
content rather than an opaque rich-text-editor payload.

### Editing ownership

`ComponentMeta.inlineEditing` makes ownership explicit:

- Transparent elements expose a text content slot belonging to the outer editor.
- Owned elements control a nested editor and provide explicit write-back and
  exit behavior; the mount contract is independent of a particular text engine.
- Leaf elements are non-editable in the outer editor. Absent metadata makes a
  custom inline element atomic.

Shared or derived values stay atomic without explicit write-back. Visual wrappers
such as ordinary pills should use marks when possible. Formatting must preserve
unaffected authored nodes, comments, references, and ownership boundaries.
Lowering rebuilds the smallest semantic authored owner that can represent the
edit; the owner depends on grammar and component contract, not DOM nesting.

### Draft sessions and selection

The [private text adapter](slidewright/canvas/rich-text/Editor.tsx) projects the
DSL into ProseMirror for a live session. ProseMirror owns immutable document and
selection state, native input, and its editable DOM island. React owns the
surrounding UI. Engine types and positions are not public Slidewright contracts.
Text-leaf offsets use UTF-16 coordinates for DOM mapping, with grapheme-safe
commands where user-visible characters are edited.

Enter edits paragraph/list structure; soft breaks remain within a paragraph.
Done, Mod-Enter, or leaving the session commits one canvas transaction; Escape
or Cancel discards it. Whole-box defaults preview in the same draft. A composing
blur waits for composition to finish before committing. External source changes
cancel the draft. Deselecting the owning TextBox ends the session and clears its
browser text selection.

Formatting controls retain the draft's range while they own focus. DOM wrapper
changes must not expand or collapse the browser highlight relative to the
logical selection. The floating toolbar follows a nonempty range and dismisses
when the range is cleared/collapsed or the user clicks outside; caret formatting
remains available in the sidebar. Popovers are part of the same authoring surface,
so entering a color picker must not accidentally finish the draft.

Authored, mixed, and inherited formatting are distinct feedback states. Clearing
a style restores inheritance. Inline Span styles and links are source-backed;
whole-box typography provides defaults. Shrink-to-fit derives a rendered size
without overwriting the authored font size.

## Color editing

OKLCH is the native authored color space. Its lightness, chroma, and hue axes
support deliberate palette editing with a more perceptually useful separation
than raw RGB channels. Native values use `oklch(L C H)`; the color literal has no
alpha channel. CSS color strings remain accepted escape values.

A color-token reference resolves through the merged registry/source token map,
falling back to a CSS variable. Source declarations use `Deck.tokens: Tokens { ... }`.
Components consume the resolved CSS color directly. Preserve references when a
user chooses a token; rendering its current color is not a reason to replace it
with a literal or a quoted token name.

The [shared picker](slidewright/canvas/ColorPicker.tsx) uses a lightness/chroma
plane, hue control, numeric fields, and a visible sRGB gamut boundary. Display
gamut mapping must preserve the authored color's intent: an out-of-gamut preview
does not authorize rewriting the source to its display approximation. Conversion
precision matters near neutral colors and gamut edges.

Picker initialization resolves the actual current color, including source tokens
and CSS-variable aliases. Palettes distinguish global tokens from colors used on
the slide and deduplicate equivalent resolved colors. Color changes share the
owning edit transaction: drags preview continuously, form one undo step, and can
be canceled. An unchanged numeric field must not materialize a token as a literal.

[Popover and palette controls](slidewright/canvas/ColorControls.tsx) live outside
clipping panes, follow their anchor and viewport, and preserve authoring focus.
Escape closes the picker before invoking the surrounding editor's Escape action.

## Cell model for values

### Resolution machinery requirements

Cells are addressable handles resolved through `resolve(handle, context)`. The
[cell store](slidewright/runtime/cells.ts) keys cached values by both handle and
resolution context. Even a literal-only value must not force a single global
current-state cache: presenting two build states simultaneously needs distinct
resolutions of the same handle.

When extending the value model with computed defaults and manual overrides,
retain the computation and store the override separately. Resetting an override
must recover the computed intent rather than an obsolete copied result. Literal,
computed, and overridden values need distinguishable authoring feedback; active
relations must be visible enough to explain dependent movement or layout.

These are extension constraints, not claims that computed layers, pins, solvers,
or binding syntax already exist. The concrete grammar and write-back ownership
of an extension require their own design decision.

## Composition and coordination

Structured diagrams, freeform geometry, and combinations of the two serve
legitimate authoring needs. Components that know the data can produce a clearer
layout than manually arranging every primitive. Freeform annotations should
compose with that structure rather than require flattening it.

Independent components should coordinate through explicit, opt-in contracts
rather than inspect one another's React internals. Geometry exposure, attachment
anchors, obstacle avoidance, and per-element overrides each require defined
identity, coordinate frames, and write-back ownership before becoming shared
editor capabilities. A generated child is not an independently authored child
unless the component exposes such a contract.

## Animations and builds

Discrete presentation/build states and a component's continuous internal motion
have different ownership. State-dependent values should resolve through context
without destroying a static authored value. Resolution must support querying
multiple states at once, so previews and transitions cannot depend on mutating a
single global current-state value.

Slides own an ordered sequence of source-backed Build diffs. Stable object IDs
connect per-property Change keyframes; values inherit forward, and explicit
equal-valued keys remain propagation barriers. Forward/backward propagation is
the scope of one edit, with forward as the default. Pin/unpin toggles local
authorship independently of that direction. Bounded edits author visible
restoration keys where needed. There is no separate shared-value diagram layer.
Appearances (including initial visibility and ancestor reveals) implicitly
protect non-visibility properties against edits crossing that frame. Backward
from a later build preserves the appearance itself. Everywhere crosses both
explicit pins and appearance boundaries when revising the complete diagram.

Visibility is distinct from opacity: hidden objects leave layout but retain
identity and editable data; opacity preserves layout space. Insertion/removal
starts at the selected frame and continues forward. Position, content and styling
changes are instantaneous; tweening is not implemented. Effective scene editing
lowers through canonical source transactions, preserving unaffected authored
source. Grouping/reparenting and scene-child reordering are rejected on slides
with builds rather than silently changing every frame's structure.

Presentation visits each authored build before advancing slides, retaining
explicit custom-component steps within each state. The presenter shares audience
navigation. Standalone PDF export selects final-state-per-slide or every authored
build, resolving each page independently. See
[runtime/builds.md](slidewright/runtime/builds.md) for the source format and
editing contracts. Internal React animation is not implicitly a source-backed
deck build or an interpolated transition API.

## AI authoring

External coding agents work on the same source and component contracts as human
authors. Slidewright's integration surface is an understandable typed codebase,
source-located diagnostics, and [validation tooling](slidewright/cli/validate.ts).
There is no separate permissive agent-ingestion format or first-party agent
orchestration layer in this architecture.

Parsing, validation, rendering, and editing must agree about the language. A
recoverable parse gives useful feedback; validation identifies invalid contracts;
structural edits refuse unsafe writes. Neither an agent nor a canvas gesture
should bypass the source-authority and round-trip invariants.
