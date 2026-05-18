// VStack with an explicit empty children array. Exercises bug #2
// (empty-array drop target) — without rendered children, the
// gap-rect math has nothing to anchor; the fix falls back to the
// parent stack's own bounding rect for a single index-0 gap.

Deck {
  name: "Test"
  subtitle: "empty-vstack fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: VStack {
        spacing: 24
        children: []
      }
    }
  ]
}
