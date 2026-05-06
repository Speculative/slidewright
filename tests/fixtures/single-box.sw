// Single Box on a Freeform slide. Used by drag, resize, and delete
// gesture tests. Coordinates chosen so the shape sits well inside
// the 1920x1080 design space and has room to grow / move in any
// direction without clipping.

Deck {
  name: "Test"
  subtitle: "single-box fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: Freeform {
        children: [
          Box { x: 400, y: 300, width: 200, height: 150, fill: accent }
        ]
      }
    }
  ]
}
