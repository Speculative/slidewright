// Two Boxes on a Freeform slide. Used by multi-select tests —
// shift-click building a multi-selection, group drag, group delete.
// Different colors so a test can distinguish them visually if a
// failure mode lands a delta on the wrong shape.

Deck {
  name: "Test"
  subtitle: "two-boxes fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: Freeform {
        children: [
          Box { x: 200, y: 200, width: 200, height: 150, fill: amber }
          Box { x: 800, y: 500, width: 200, height: 150, fill: cyan }
        ]
      }
    }
  ]
}
