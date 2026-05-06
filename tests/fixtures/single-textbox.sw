// Single TextBox on a Freeform slide. Used by drag, resize, and
// text-edit gesture tests.

Deck {
  name: "Test"
  subtitle: "single-textbox fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: Freeform {
        children: [
          TextBox {
            x: 400
            y: 300
            width: 320
            height: 120
            content: "Hello"
          }
        ]
      }
    }
  ]
}
