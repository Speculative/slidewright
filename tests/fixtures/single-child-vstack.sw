// VStack with a single child. Exercises bug #1 (axis fallback at
// N=1) in the array-gap drop hit-test: with one child, the
// two-child geometry heuristic can't infer axis; the fix derives
// axis from the parent component's identity (VStack → 'v').

Deck {
  name: "Test"
  subtitle: "single-child-vstack fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: VStack {
        spacing: 24
        children: [
          CardRow {
            color:   purple
            eyebrow: "Only"
            heading: "Single child."
            body:    "Drop above or below to insert."
          }
        ]
      }
    }
  ]
}
