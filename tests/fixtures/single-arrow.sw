// Single Arrow on a Freeform slide. Used by body-drag and endpoint-
// move gesture tests. Endpoints chosen so the arrow has a clearly
// distinguishable start vs end (different x AND different y) so
// off-by-one mistakes between (x1, y1) and (x2, y2) are caught.

Deck {
  name: "Test"
  subtitle: "single-arrow fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: Freeform {
        children: [
          Arrow { x1: 400, y1: 300, x2: 800, y2: 600 }
        ]
      }
    }
  ]
}
