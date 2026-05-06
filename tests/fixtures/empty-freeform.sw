// Empty Freeform slide. Used by shape-creation gesture tests —
// the test starts here and uses a tool palette to draw a new shape
// onto the empty surface.

Deck {
  name: "Test"
  subtitle: "empty-freeform fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: Freeform {
        children: []
      }
    }
  ]
}
