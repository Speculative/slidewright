// A VStack directly under the slide's content slot — no Freeform
// wrapper. Exercises the slide-stage portal-target fallback in
// `portal-target.ts:useSelectionPortal`. Used to verify that
// selection visuals + the gap-drag handles render against the
// slide stage when the layout has no Freeform ancestor.

Deck {
  name: "Test"
  subtitle: "slide-level-vstack fixture"
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
            eyebrow: "First"
            heading: "First card."
            body:    "Top card content."
          }
          CardRow {
            color:   cyan
            eyebrow: "Second"
            heading: "Second card."
            body:    "Bottom card content."
          }
        ]
      }
    }
  ]
}
