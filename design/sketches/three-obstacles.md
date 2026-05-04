# Three Obstacles — worked example

The "Three obstacles" slide from `decks/ne-agents-day-2026/Deck.jsx` (slide 4 in the deck): an eyebrow + title + intro + three colored cards with shared two-column layout (label/heading on the left, body on the right). One of the most repetitive slides in the deck, so a useful test of how the DSL handles structural repetition.

This sketch was the first concrete exercise that motivated several decisions in `SLIDEWRIGHT.md`: the three component layers, layout primitives as stacks/grids rather than CSS-translation, typed named slots, and the cell-with-override model.

---

## The slide as it exists today (React/CSS)

Excerpt from the deck's actual source. Shape: inline `style={...}`, utility class names (`card purple`, `body`, `label`), CSS grid with a hand-tuned `35rem` first column. Three nearly-identical card subtrees that diverge only in color and content.

```jsx
<Slide label="Three problems" notes={`...`}>
  <div className="eyebrow">Three obstacles</div>
  <div className="slide-title">
    Behavior is hidden by default.
  </div>
  <div style={{ fontSize: 32, marginBottom: 48 }}>
    Programs do a lot, and most of it is invisible by default. To
    observe behavior, you have to solve three problems.
  </div>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
    <div
      className="card purple"
      style={{
        display: 'grid',
        gridTemplateColumns: '35rem 1fr',
        gap: 48,
        alignItems: 'center',
      }}
    >
      <div>
        <div className="label">Representation</div>
        <h3 style={{ marginBottom: 0 }}>Code isn't behavior.</h3>
      </div>
      <div className="body">
        Code shows what could happen, not what did. Behavior has to
        be captured and shaped into something you can read.
      </div>
    </div>
    {/* same card shape repeated for cyan and magenta */}
  </div>
</Slide>
```

---

## First pass: naive JSX with typed components

Hand-written before any DSL design conversation, as an exercise in "what would the same slide look like if we pulled out the layout-specific styling?"

```jsx
<ContentSlide>
  <Eyebrow>Three obstacles</Eyebrow>
  <Title>Behavior is hidden by default.</Title>
  <Text>
    Programs do a lot, and most of it is invisible by default. To
    observe behavior, you have to solve three problems.
  </Text>
  <FlexColumn>
    <Card color={purple}>
      <Row template={35rem 1fr}>
        <Box>
          <Label>Representation</Label>
          <Sublabel>Code isn't behavior.</Sublabel>
        </Box>
        <Text>
          Code shows what could happen, not what did. Behavior has to
          be captured and shaped into something you can read.
        </Text>
      </Row>
    </Card>
    <Card color={cyan}>   {/* same shape */}   </Card>
    <Card color={magenta}>{/* same shape */}   </Card>
  </FlexColumn>
  <Notes>
    - Behavior isn't a thing you can just look at.
    - First, attention — programs do a lot, where do you point your eyes?
    - Second, volume — even when you know where to look, there's a firehose.
    - Third, representation — behavior isn't directly visible. Something
      has to capture it and shape it into a form you can read.
    - The rest of the talk is how autopsy-report addresses these three.
  </Notes>
</ContentSlide>
```

**What we liked:**
- Markup reads cleanly with layout/styling configurations pulled out.
- `Eyebrow`, `Title`, `Text`, `Notes` feel reusable and obvious.
- `Card color={purple}` is direct and inspector-friendly.
- Pulling typography roles out of inline styles makes it obvious which roles the deck *has*.

**What was wrong:**
- `Label` and `Sublabel` felt forced — they're really small-caps category tags and bigger headlines, i.e., typography roles, not generic semantics.
- `FlexColumn` and `Row template={35rem 1fr}` are direct CSS-flex/grid translations; they leak browser layout vocabulary into the DSL.
- JSX gives no signal that `ContentSlide` *expects* particular slot types — children are just nested. The template's expectations are invisible.
- `35rem` is repeated three times via copy-paste; nothing in the source captures "this should be the same width across all cards."
- Colors as bare names (`purple`, `cyan`) — global constants? Theme tokens? Not specified.

This first-pass exercise drove the SLIDEWRIGHT.md decisions on three component layers, stack/grid layout primitives, typed named slots, and the cell-with-override model.

---

## Candidate A: indented-colon form

A custom indented-colon syntax. Uses a deck-specific `CardRow` composite to factor out the repeated card shape; uses typed slots throughout; relies on either subgrid-style alignment or an explicit shared cell to handle the shared-column-width problem (see commentary).

```
ContentSlide
  eyebrow: "Three obstacles"
  title:   "Behavior is hidden by default."
  intro:   "Programs do a lot, and most of it is invisible by default.
            To observe behavior, you have to solve three problems."

  body:
    VStack spacing=32
      CardRow color=purple
        eyebrow: "Representation"
        heading: "Code isn't behavior."
        body:    "Code shows what could happen, not what did. Behavior has to
                  be captured and shaped into something you can read."

      CardRow color=cyan
        eyebrow: "Attention"
        heading: "It's mostly noise."
        body:    "Useful observations are buried within everything else that
                  happens. Which parts actually matter?"

      CardRow color=magenta
        eyebrow: "Volume"
        heading: "There's too much stuff."
        body:    "Even once you know where to look, the data is a veritable
                  firehose. Logs scroll past, breakpoints fire on every
                  iteration."

  notes:
    """
    - Behavior isn't a thing you can just look at.
    - First, attention — programs do a lot, where do you point your eyes?
    - Second, volume — even when you know where to look, there's a firehose.
    - Third, representation — behavior isn't directly visible. Something
      has to capture it and shape it into a form you can read.
    - The rest of the talk is how autopsy-report addresses these three.
    """
```

`CardRow` is a deck-specific composite (layer 3) wrapping a `Card` with an internal two-column layout. Its slot schema is `{ eyebrow: text, heading: text, body: text, color: color-token }`.

### Things assumed / underspecified

- **Slot syntax for attribute-style params vs body-content slots.** `color=purple` uses attribute style; `eyebrow:` etc. use slot style. Are these one mechanism or two? Probably one (params-as-slots), but the surface syntax distinguishes. A consistent form (everything is `name: value`) might be cleaner: `color: purple` instead of `color=purple`.
- **Token references.** `color=purple` assumes `purple` resolves against the deck's color palette. Mechanism for declaring deck tokens in source still TBD.
- **Multi-line strings and indentation.** The `"""..."""` form for `notes` is borrowed from Python. Works, but indentation/dedent rules need spec. Same question for `intro` and the `body:` strings spanning multiple source lines: literal preserved, whitespace collapsed, or explicit form for each?
- **Shared column width across `CardRow` instances.** Two viable approaches:
  - *(a) Subgrid-style alignment*: each `CardRow`'s internal `Grid columns="auto 1fr"` participates in alignment with sibling `CardRow`s' grids. Clean from the slide author's view, but requires the layout primitive to support subgrid-like behavior — a real architectural commitment.
  - *(b) Explicit shared cell*: lift the column width into a slide-scope cell (`let titleCol = solve.minFitWidth(...)`) and pass it down to each `CardRow`. More verbose; the cell-with-override model handles it cleanly without subgrid magic.
  - The current sketch hides this choice inside `CardRow`. We should pick one before writing the actual `CardRow` component.
- **IDs.** Per the IDs decision, every primitive has a stable ID written in source. Not shown here for readability; the editor would auto-insert them.
- **Slot type reuse.** `body` is a `text` slot in `CardRow` but in `ContentSlide` it's a tree of layout primitives. Same name, different types in different schemas — fine if slot types are per-component-declared, but worth noting.
- **`VStack` under `body:` could be implicit.** If `ContentSlide`'s `body` slot has a `spacing` attribute of its own, the explicit `VStack spacing=32` wrapper goes away. Schema design choice.

### What we like

- Empty/required slots are visually obvious (a slot line with no body) — projectional editor can render placeholders.
- The body of `body:` is just a tree, so nesting is unrestricted.
- Reading order matches presentation order; slot-filling reads like prose.
- Card color is a panel param, not a class hack — fits the inspector model.
- `CardRow` factors out repetition; the repeated `35rem` disappears.
- Explicit `CardRow` makes "build a component for it" concrete — the deck vocabulary owns the card shape, not the slide author.

### What we don't like / what's unresolved

- Long string literals embedded in slot bodies feel awkward. Some kind of "block string" form (Python `"""`, Nix `''`, YAML `|`) would help; choose one and apply consistently.
- The slot/attribute distinction (`color=purple` vs `eyebrow: "..."`) is dialect, not principle. Worth unifying.
- Indentation has to be exactly right for the parse to work — same fragility as YAML/Python. Accepted; worth re-evaluating after writing more sketches.
- The composite `CardRow` doesn't exist in the deck's current components; it would have to be authored. The fact that the sketch presupposes it shows the DSL design is downstream of "what composites the deck library provides."

---

## Candidate B: NestedText form

The same typed-slot semantics expressed in [NestedText](https://nestedtext.org/), an off-the-shelf "YAML without footguns" format whose only data types are dicts, lists, and strings (no implicit type coercion). Component identity is carried by a `type:` field; everything else is application-interpreted (color tokens, references, computed defaults all live as strings).

```nestedtext
type: ContentSlide
eyebrow: Three obstacles
title: Behavior is hidden by default.
intro:
    > Programs do a lot, and most of it is invisible by default.
    > To observe behavior, you have to solve three problems.
body:
    -
        type: VStack
        spacing: 32
        children:
            -
                type: CardRow
                color: purple
                eyebrow: Representation
                heading: Code isn't behavior.
                body:
                    > Code shows what could happen, not what did. Behavior has to
                    > be captured and shaped into something you can read.
            -
                type: CardRow
                color: cyan
                eyebrow: Attention
                heading: It's mostly noise.
                body:
                    > Useful observations are buried within everything else that
                    > happens. Which parts actually matter?
            -
                type: CardRow
                color: magenta
                eyebrow: Volume
                heading: There's too much stuff.
                body:
                    > Even once you know where to look, the data is a veritable
                    > firehose. Logs scroll past, breakpoints fire on every
                    > iteration.
notes:
    > - Behavior isn't a thing you can just look at.
    > - First, attention — programs do a lot, where do you point your eyes?
    > - Second, volume — even when you know where to look, there's a firehose.
    > - Third, representation — behavior isn't directly visible. Something
    >   has to capture it and shape it into a form you can read.
    > - The rest of the talk is how autopsy-report addresses these three.
```

**What we like:**
- Off-the-shelf parser (Python implementation exists; spec is small enough to port to TS for the editor).
- No implicit type coercion (no Norway problem, no string-vs-number ambiguity, etc.) — every distinction we care about lives in our slot schema, not in the format.
- Multi-line strings via `> ` line prefix are explicit and unambiguous.
- Comments are first-class (NestedText supports `#` comments and they survive parse/emit, which matters for round-trip).
- Slot schema validation is purely an application concern — the format doesn't need to know about slots.
- Same typed-slot semantics fall out for free; "slots" are just dict entries the application interprets via the schema.

**What we don't like / what's worse than candidate A:**
- Verbose. Every component invocation needs a `type:` field; every list-of-children item needs an extra `-` indent level.
- No infix attribute form. `color=purple` is now `color: purple` *as a child of the component dict* — which is fine, but means there's no syntactic distinction between "this is a slot" and "this is an attr." (Maybe that distinction was unprincipled to begin with — see candidate A's "things we don't like.")
- All references and tokens have to live inside strings (e.g., `width: =solve.minFitWidth(...)` with a sigil, or `color: $accent`). The format doesn't help us mark them; the editor has to highlight them.
- Lists wrap tightly: every list item that itself has structure starts with a bare `-` line and indents — adds visual noise for component children.

**Things assumed / underspecified:**
- The exact convention for marking a value as a token reference vs. a literal vs. a computed default — needs a sigil convention (`$name` for refs, `=expr` for computed?), since NestedText itself sees them all as strings.
- Whether the `type:` field is the right discriminator, or whether some other convention (e.g., a single-key dict where the key *is* the type) reads better. Single-key form is more YAMLish and slightly more compact but adds parse weight at the application layer.

---

## Candidate C: JSX-with-named-slots

Same typed-slot semantics in a JSX-shaped surface syntax, for comparison:

```jsx
<ContentSlide>
  <slot:eyebrow>Three obstacles</slot:eyebrow>
  <slot:title>Behavior is hidden by default.</slot:title>
  <slot:intro>
    Programs do a lot, and most of it is invisible by default.
    To observe behavior, you have to solve three problems.
  </slot:intro>
  <slot:body>
    <VStack spacing={32}>
      <CardRow color="purple">
        <slot:eyebrow>Representation</slot:eyebrow>
        <slot:heading>Code isn't behavior.</slot:heading>
        <slot:body>Code shows what could happen, not what did...</slot:body>
      </CardRow>
      {/* cyan, magenta */}
    </VStack>
  </slot:body>
  <slot:notes>{/* multi-line text */}</slot:notes>
</ContentSlide>
```

**Reactions:**
- Familiar to React developers; same typed-slot semantics underneath.
- Verbose: `<slot:name>...</slot:name>` is heavier than `name:`.
- The `slot:` prefix is a notation invention to distinguish slot fillings from arbitrary children; without it you're back to JSX-style positional nesting, which is exactly the antipattern we're avoiding.
- Round-tripping closing-tag matching is harder than indent-matching for the projectional editor.
- Doesn't earn its keep over indented-colon *for slides specifically*. Might fare better for richer tree-shaped content (long form prose, rich diagrams).

---

## Provisional verdict

**Surface syntax is not pinned down.** Three serious candidates with different tradeoffs:

- **A (indented-colon)** is the most compact and reads most naturally for slide-shaped content; cost is rolling our own parser and committing to a custom format, including handling comments, escaping, and edge cases that off-the-shelf formats already handle.
- **B (NestedText)** gets us a well-spec'd off-the-shelf format with comment preservation, no type-coercion footguns, and clean multi-line strings — at the cost of more verbose tree expression and pushing all reference/token/computed-default marking into stringly conventions.
- **C (JSX-with-named-slots)** is most familiar to React developers; verbose; tag-matching is harder to round-trip than indent-matching.

Verdict deferred. Write 2–3 more sketches that exercise different shapes — title slide (layer-3 template with no primitives composition), chromeless image slide (single-argument template), freeform diagram (positioned shapes + arrows + anchors) — and revisit after seeing which form holds up under varied content. The decision likely matters less than getting the *semantics* right (typed slots, the cell model, the round-trip property), since all three options express the same semantics.
