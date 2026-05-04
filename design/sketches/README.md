# Slidewright design sketches

This directory contains worked examples of slides written in candidate Slidewright DSL syntax — "dream code" for what we'd like to write — annotated with commentary.

**Purpose:**
- Make syntax decisions concrete by writing real examples instead of arguing in the abstract.
- Surface what's assumed or underspecified in the current design.
- Build a corpus that the round-trip test harness can exercise once v0 lands.

**These sketches are not authoritative.** `SLIDEWRIGHT.md` (at the repo root) is the source of truth for design commitments. Sketches are illustrative; they predate or test those commitments. Expect them to evolve, get rewritten, or be superseded as the syntax bikeshed resolves.

**Convention:**
- One markdown file per slide or feature, kebab-case filename.
- Each file shows: the original (if it exists in the reference deck), candidate revisions, and commentary on assumptions, what we like, and what we don't.
- Code blocks use `jsx` for React/JSX content and no language tag for candidate Slidewright DSL (its surface syntax isn't pinned down yet).

**Index:**
- `three-obstacles.md` — the "Three obstacles" slide from `decks/ne-agents-day-2026/Deck.jsx`. The first sketch; motivated the typed-slot model, three-component-layer split, and stack-based layout primitives in SLIDEWRIGHT.md.
