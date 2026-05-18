// VStack with implicit children (bare component invocations in
// the body — no `children: [...]` fill). Exercises bug #3: the
// implicit-children branch of the loader must emit the same
// data-sw-slot-name wrapper as the explicit-fills path, otherwise
// the canvas's drop-target hit-test can't find the slot.

Deck {
  name: "Test"
  subtitle: "implicit-children-vstack fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: VStack {
        CardRow {
          color:   purple
          eyebrow: "First"
          heading: "Implicit first."
          body:    "Body."
        }
        CardRow {
          color:   cyan
          eyebrow: "Second"
          heading: "Implicit second."
          body:    "Body."
        }
      }
    }
  ]
}
