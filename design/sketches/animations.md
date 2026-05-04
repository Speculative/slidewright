# Animations — worked examples

Sketches of how each of the three animation categories looks in candidate Slidewright source. Speculative on every axis (surface syntax bikeshed-able; v0 ships none of this); the goal is to make the data model concrete and surface what's assumed or underspecified.

The data model: cells get an optional `valuesByState` layer; elements get an optional existence schedule; explicit transition declarations live as siblings to the slide content for non-default cases. See SLIDEWRIGHT.md / Animations and builds for the design.

---

## Category 1: enter/exit builds

A simple slide with three cards, each appearing one at a time as the speaker advances.

```
ContentSlide {
  eyebrow: "Three obstacles"
  title:   "Behavior is hidden by default."
  body: VStack {
    spacing: 32
    children: [
      Card {
        id:              card-1
        color:           purple
        existsInStates:  [1, 2, 3]
        eyebrow:         "Representation"
        heading:         "Code isn't behavior."
        body:            "..."
      }
      Card {
        id:              card-2
        color:           cyan
        existsInStates:  [2, 3]
        eyebrow:         "Attention"
        heading:         "It's mostly noise."
        body:            "..."
      }
      Card {
        id:              card-3
        color:           magenta
        existsInStates:  [3]
        eyebrow:         "Volume"
        heading:         "There's too much stuff."
        body:            "..."
      }
    ]
  }
}
```

**What this exercises:**
- Per-element existence schedule. Each card declares which states it exists in.
- Default entrance: an element's first frame of existence triggers a default entrance effect (probably fade-in for v1; configurable later).

**What's underspecified:**
- Whether the first state is auto-presented or requires a click. I'd say auto: state 1 is what the user sees when they navigate to this slide; clicks advance from there.
- How `existsInStates` renders in the inspector — a row of state-checkboxes? An interval like `[1..]`? An author-friendly UI is one of the things we'll iterate on.
- Whether non-contiguous schedules are allowed (`[1, 3]` — appears, disappears, reappears). Probably yes but corner case.
- What "default entrance" looks like and how to override it (a per-element `enterEffect: fade-up` field? An explicit transition declaration?).
- Whether the schedule is per-element or could be per-slot (maybe a slot-level `appearsInStates` annotation).

**What we like:**
- Implicit and additive: an existing static slide gains build steps by adding `existsInStates` to a few elements. No structural rewrite.
- Reads naturally for the academic-presentation case where this category does most of the work.

**What we don't like / unresolved:**
- The existence schedule mixes structural information with content. Pulling it out into a sibling block (`builds: ...`) might read better for slides with many timed elements.
- `existsInStates: [3]` is verbose for "appears at state 3 and stays." A shorthand like `appearsAtState: 3` might be friendlier.

---

## Category 2: cell-value transitions

A box that moves from left to right between two states. Static height, static color.

```
SimpleSlide {
  title: "Box on the move"
  body: Freeform {
    Box {
      id:     box-1
      x: {
        state.1: 100
        state.2: 800
      }
      y:      360
      width:  200
      height: 200
      color:  accent
    }
  }
}
```

**What this exercises:**
- Per-state values on a single cell (`x`). Other cells stay static — there's no animation noise on cells you didn't touch.
- The `state.N: value` form is shorthand for `valuesByState[N]: value`.
- Implicit interpolation: `x` is a numeric cell, so the engine animates between `100` (at state 1) and `800` (at state 2) with the default numeric curve.

**Inheritance via the dependency graph.** Suppose an arrow points at the box's right edge:

```
Arrow {
  id:   arrow-1
  from: (50, 460)
  to:   #box-1.right.midpoint
}
```

The arrow's `to` is a computed default that depends on `box-1.x`. When the box's `x` animates between states, the arrow's endpoint inherits the animation automatically. No per-state values on the arrow needed; the dependency graph does the right thing.

**What's underspecified:**
- Whether `state.N: value` is the canonical form or if other shapes (`when state=N: value`, an indented `state` block, a YAML-list of state-value pairs) read better.
- Default interpolation curves per type (linear? ease-in-out? cubic-bezier with what params?).
- What happens when the user navigates *into* the slide directly to state 2 — animate from state 1 implicitly, or just show state 2's value? Probably the latter (no preceding state means no transition to interpolate from).
- Whether `state.1` is the "initial" state or whether state 0 is reserved for "before any clicks." I'd say start at state 1 for human-readable consistency.

**What we like:**
- Animation is opt-in per cell. A box that moves but doesn't change color has only its `x` cell animated; the color cell stays static. The source visibly distinguishes "this animates" from "this doesn't" by which cells have `valuesByState`.
- The dependency graph makes computed defaults follow their inputs without extra declarations. This is a real Slidewright advantage over Keynote/PowerPoint, which can't propagate animation through computed values because they don't have a cell model.

**What we don't like / unresolved:**
- The shorthand `state.N: value` mixes well with simple values but reads awkwardly when a state-specific value is itself complex (e.g., a computed default per state). Need a block form: `state.1: solve.minFitWidth(...)` works, but `state.2: { computed: solve.minFitWidth(...), override: 35rem }` doesn't have a tidy single-line shape.

---

## Category 2 (cross-slide): same-ID Magic Move

Two consecutive slides that share an element by ID. The element interpolates across the slide boundary.

```
ContentSlide {
  id:    slide-1
  title: "First, attention"
  body: Freeform {
    Card {
      id:     intro-card
      x:      100
      y:      100
      width:  800
      height: 600
    }
  }
}

ContentSlide {
  id: slide-2
  body: Freeform {
    Card {
      id:     intro-card
      x:      200
      y:      200
      width:  400
      height: 300
    }
  }
}
```

**What this exercises:**
- Cross-slide identity by ID: `intro-card` exists in both slides; engine identifies them automatically and animates the slide-transition.
- No declaration needed; same-ID match is the implicit default for cross-slide transitions when the engine recognizes a continuation.

**What's underspecified:**
- Whether all slide transitions interpolate matched IDs by default, or only when explicitly enabled (`slideTransition: magic-move` per slide pair).
- How the editor surfaces "this element continues into the next slide" visually — the element shows up in both slides' canvases, and a scrubber on the slide-transition shows the interpolation? The model is clear; the editor surface less so.
- Whether the element's appearance in each slide must explicitly declare the cross-slide intent, or whether ID match is enough.

**What we like:**
- Stable IDs are doing exactly the work they were designed to do. The continuation falls out of the existing identity machinery.
- Authors who don't want cross-slide animation can use distinct IDs and get the simple static behavior.

**What we don't like / unresolved:**
- The "same ID across slides" convention assumes IDs are deck-scope unique enough to be matched across slides. We'd previously committed to per-slide ID scope. So either cross-slide matching uses compound IDs (`intro-card-cross`?) or we allow author-named IDs to be deck-scope-unique-by-convention. Worth resolving when this feature is actually built.

---

## Cross-ID morph (explicit transition)

The "zoom into the box" example: a Box's text on slide N becomes the title of slide N+1, even though they have different IDs.

```
ContentSlide {
  id: slide-1
  body: Freeform {
    Box {
      id:     box-3
      x:      200
      y:      300
      width:  400
      height: 200
      children: [
        Text { id: box-3-text, content: "First, attention" }
      ]
    }
  }
}

ContentSlide {
  id:    slide-2
  title: "First, attention"
}

# Sibling to the slides at deck level:
Transitions {
  Transition {
    from: slide-1
    to:   slide-2
    morph: {
      from:     #box-3-text
      to:       #slide-2.title
      duration: 0.6s
      curve:    ease-in-out
    }
  }
}
```

**What this exercises:**
- Explicit transition declaration linking elements with different IDs across slides.
- Per-cell granularity of morph: just the text, not the surrounding box.
- Custom timing (`duration`) and curve (`curve`) on the explicit declaration.

**What's underspecified:**
- Where transition declarations live in source. Sibling of slides at deck level (as shown)? Per-slide? In a separate `transitions/` directory? Probably at the boundary between the slides being transitioned, but the surface form is open.
- How "morph" interpolation actually works for arbitrary element pairs. Text-to-title is text run to text run (interpolate position, size, font); morph between a Box and a Card has richer rules. We'll need a small set of supported morph shapes and good defaults.
- How slide transitions and within-slide build transitions interact — does the slide change happen "at" state N+1 of slide N+1's first state, or as a separate slide-transition phase? Probably separate phase: a slide-transition is its own scoped animation between two slides' rendered end-states.

**What we like:**
- The implicit machinery handles 90% of cases (same-ID continuation, default interpolation); the explicit form is reserved for the 10% that need it.
- Reads as a declaration: "from this to that, like this." Author intent is visible.
- Customization (timing, curve) lives with the morph declaration, not scattered across element fields.

**What we don't like / unresolved:**
- Two-step morphs (A on slide 1 morphs to B on slide 2 morphs to C on slide 3 with continuity throughout) need either chained declarations or a different shape. Probably out of scope for a long time.
- Morph declarations decoupled from the slides they affect can rot when slides are renamed/reordered. Editor support for keeping them in sync matters.

---

## Notes for the v0 commitment

None of the above ships in v0. The v0 architectural commitment, captured in the SLIDEWRIGHT.md Animations and builds section, is just:

- Cells are addressable handles.
- Resolution takes a `(handle, context)` pair; v0 context is empty.
- Caches and dependency graph are context-keyed.
- Cell type definition has reserved space for `valuesByState`.

Everything in this sketch — the surface syntax for per-state values, the `existsInStates` field, transition declarations, interpolation algorithms, the timeline UI, slide-transition primitives — is post-v0 work that grows additively on the v0 foundation.
