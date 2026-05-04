# TitleSlide — worked example of a custom component

The existing deck's title slide (`decks/ne-agents-day-2026/Deck.jsx`, slide 1) reimagined as a reusable Slidewright component against the v0-light contract. Demonstrates how a parameterized template slide is authored on the React side and filled in DSL form.

In the current deck, the title slide is inline JSX inside a `<Slide>` element — about 50 lines of layout code mixed with content. The same slide as a Slidewright component splits into:

- **`TitleSlide.tsx`**: layout, styling, slot/param schema. Authored once, reusable across decks.
- **A DSL invocation** in the deck's slides: just the content (venue, title, subtitle, presenter, headshot).

---

## The component (TitleSlide.tsx)

```tsx
// decks/ne-agents-day-2026/components/TitleSlide.tsx
export const slidewright = {
  produces: "slide",
  slots: {
    venue:       { type: "text",  required: true },
    title:       { type: "text",  required: true },
    subtitle:    { type: "text",  required: false },
    presenter:   { type: "text",  required: true },
    affiliation: { type: "text",  required: true },
    headshot:    { type: "image", required: true },
  },
  params: {
    accentColor: { type: "color-token", default: "accent" },
  },
  protocols: {},
};

export default function TitleSlide({ slots, params }) {
  const accent = `var(--${params.accentColor})`;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100%",
      }}
    >
      <div className="eyebrow">{slots.venue}</div>

      <div>
        <div className="accent-rule" />
        <div className="title-xl">{slots.title}</div>
        {slots.subtitle && (
          <div
            style={{
              marginTop: 48,
              fontSize: 36,
              maxWidth: 1500,
              color: "var(--muted)",
            }}
          >
            <em>{slots.subtitle}</em>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          fontFamily: "var(--font-mono)",
          fontSize: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img
            src={slots.headshot}
            alt=""
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
          <span>
            {slots.presenter}{" "}
            <span style={{ color: accent }}>·</span>{" "}
            {slots.affiliation}
          </span>
        </div>
      </div>
    </div>
  );
}
```

---

## The DSL invocation

In the deck's slide source (brace-block form — see SLIDEWRIGHT.md / Form):

```
TitleSlide {
  venue:       "NE AGENTS DAY · 2026"
  title:       [
    "Vibe Debugging with "
    Span { color: accent, font: mono, content: "autopsy-report" }
  ]
  subtitle:    "or: towards comprehending agent-written code"
  presenter:   "Jeffrey Tao"
  affiliation: "Penn HCI Lab"
  headshot:    headshotImg
}
```

`headshotImg` is an imported asset reference resolved by the DSL value system. The `title` slot accepts text runs (`(string | Span)+`) — here the value is a list with a string followed by a styled `Span`; the editor pre-resolves these into React nodes before `TitleSlide` ever sees them.

---

## What this exercises in the contract

- **`produces: "slide"`** — the editor knows this can be placed at the deck's slide-list level.
- **Mixed slot types** — `text` (most slots), `image` (headshot). The editor validates DSL fillings against the schema and renders compatible inspector affordances.
- **Optional slot** — `subtitle: { required: false }` lets the component conditionally render. The DSL author can omit the slot entirely.
- **Token param with default** — `accentColor: { type: "color-token", default: "accent" }`. If the deck author doesn't set it, the component uses the deck-theme default. If they do, the inspector edits it as a color-token picker that drops down available palette names.
- **Inline styled text run** — the `Span color=accent font=mono` inside the `title` slot exercises the `(string | Span)+` text-runs model; the component just renders `{slots.title}` and the editor handles run-to-React resolution.
- **Asset reference** — `headshotImg` is an imported binding from the deck's TS modules; the cell model resolves it to a string path at render time, and `slots.headshot` arrives as that string.
- **Empty `protocols: {}`** — nothing to expose; this is a leaf slide.
- **Arbitrary React internals** — flex layout, conditional rendering, hardcoded styles. None of it is constrained by the contract; the component just renders.

## Things assumed / underspecified

- **Theme tokens.** The component uses CSS vars (`var(--muted)`, `var(--font-mono)`, `var(--accent)`) directly, because v0 doesn't ship a theme system. Once theme tokens land, these would resolve through the deck theme instead of being hardcoded as CSS var references.
- **Image asset import path.** `headshotImg` is shown as a bare identifier in the DSL; the actual import (`import headshotImg from './headshot.jpg'`) lives somewhere — either at the top of the deck file, in a dedicated assets module, or auto-imported by convention. Mechanism TBD.
- **What "pre-resolved React nodes" actually look like for `text` slots.** The contract says the component receives `slots.title` as a renderable React node, but the resolution machinery (DSL run array → React fragment with styled spans) lives in the editor runtime, not the contract. Worth pinning down before any v0 code, since it affects how the runtime walks the DSL tree.
- **Where to put per-deck custom components.** The sketch puts `TitleSlide.tsx` under `decks/ne-agents-day-2026/components/`. Reasonable convention but not yet specified anywhere.
- **How the editor surfaces "the title is a Span run, edit the styled portion."** Direct manipulation of the styled run inside the title slot is a real editor concern but doesn't appear in this sketch.

## What we like

- The deck author's view (the DSL invocation) is content-only, no layout concerns. Reusable for any title slide that fits this template.
- The component author's view is plain React with two small additions (the `slidewright` metadata object and slot-typed props). Familiar; testable in isolation by calling the function with mock props.
- The contract surface stays small even for a relatively rich template — `{ produces, slots, params, protocols: {} }` is the entire schema-side; the rest is normal React.
- Optional slots and defaulted params handle common variation cleanly.
- The escape hatch is right there: any styling or behavior the DSL doesn't express ends up in the React function. We don't need a special API to be expressive; we need a thin contract that doesn't get in the way.

## What we don't like / what's unresolved

- **Hardcoded styles in the component.** The component is full of inline `style={{ ... }}` and CSS class names. Some of this is "this template's specific look," which is fine; some is "the deck theme says titles are 36px italic muted," which should live in the theme. Without a theme system, we can't separate these. Cosmetic for v0; structural for v1.
- **Slot-vs-param distinction is fuzzy.** Why is `presenter` a slot and `accentColor` a param? Roughly: slots are content-bearing things the deck author fills with text/blocks/images; params are knobs the deck author tunes in the inspector. But "venue" is a slot here, and you could argue it's just as much a knob. The line is "anything that can hold a tree or styled text → slot; anything that's a scalar or token → param" — but `venue` is a string and we made it a slot. Worth observing; might collapse to one mechanism if the distinction keeps feeling forced across more components.
- **The `accentColor` param has limited utility here.** This particular slide always uses the deck accent. A future ImageSlide where the author overrides the accent per-slide would justify the param machinery better.
- **Component lives in `decks/ne-agents-day-2026/components/`** — fine for one deck, but the title slide format is something the user wants to reuse across presentations. Workspace structure for shared components is unresolved.
