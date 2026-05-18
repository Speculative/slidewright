// Three-slide deck for slide-strip multi-select + reorder + delete
// tests. Each slide carries a unique label so reorder assertions
// can match against the resulting `slides:` list order.

Deck {
  name: "Test"
  subtitle: "three-slides fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Alpha"
      notes: ""
      content: Freeform {
        children: [
          Box { x: 200, y: 200, width: 200, height: 150, fill: amber }
        ]
      }
    }
    Slide {
      label: "Beta"
      notes: ""
      content: Freeform {
        children: [
          Box { x: 400, y: 400, width: 200, height: 150, fill: cyan }
        ]
      }
    }
    Slide {
      label: "Gamma"
      notes: ""
      content: Freeform {
        children: [
          Box { x: 600, y: 600, width: 200, height: 150, fill: purple }
        ]
      }
    }
  ]
}
