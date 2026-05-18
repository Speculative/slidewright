// ContentSlide with `body` slot missing entirely → renders an
// empty-block placeholder the user can drop a layout into.
// Companion fixture for the drag-from-toolbar tests covering the
// "drop onto empty-slot placeholder" gesture path.

Deck {
  name: "Test"
  subtitle: "empty-block-slot fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      content: ContentSlide {
        title: "Body is empty"
      }
    }
  ]
}
