// Deck-level `tokens: Tokens { ... }` — source-declared color
// tokens. The first Box uses `fill: brand`, which should resolve
// to the `oklch(...)` declared above instead of falling through
// to a `var(--brand)` (which doesn't exist).

Deck {
  name: "Test"
  subtitle: "source-tokens"
  width: 1920
  height: 1080

  tokens: Tokens {
    brand: oklch(0.55 0.18 285)
    soft:  oklch(0.92 0.02 285)
  }

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: Freeform {
        children: [
          Box { x: 200, y: 200, width: 200, height: 150, fill: brand }
          Box { x: 800, y: 500, width: 200, height: 150, fill: soft }
        ]
      }
    }
  ]
}
