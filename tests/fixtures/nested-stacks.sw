// VStack containing an HStack and a CardRow. Exercises bug #4
// (outer array wrapper masking inner): without the innermost-
// wins fix, a pointer over the HStack's contents resolves to the
// outer VStack's children slot because the outer wrapper appears
// first in DOM order. The user's original repro.

Deck {
  name: "Test"
  subtitle: "nested-stacks fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      notes: ""
      content: VStack {
        spacing: 24
        children: [
          HStack {
            spacing: 24
            children: [
              CardRow {
                color:   purple
                eyebrow: "Inner"
                heading: "Inside HStack."
                body:    "Drop nearby to test inner targeting."
              }
            ]
          }
          CardRow {
            color:   cyan
            eyebrow: "Outer"
            heading: "Outer VStack child."
            body:    "Below the HStack."
          }
        ]
      }
    }
  ]
}
