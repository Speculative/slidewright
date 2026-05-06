// Two-slide deck. Used by navigation / cursor-sync tests that
// need to cross slide boundaries (editor cursor jumping between
// slides → canvas active slide tracks; thumbnail click → editor
// caret optionally moves; etc.). Each slide has one Box at known
// coords so the tests can identify which slide is rendered.

Deck {
  name: "Test"
  subtitle: "two-slides fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "First"
      notes: ""
      content: Freeform {
        children: [
          Box { x: 200, y: 200, width: 200, height: 150, fill: amber }
        ]
      }
    }
    Slide {
      label: "Second"
      notes: ""
      content: Freeform {
        children: [
          Box { x: 800, y: 500, width: 200, height: 150, fill: cyan }
        ]
      }
    }
  ]
}
