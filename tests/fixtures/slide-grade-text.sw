Deck {
  name: "Text"
  width: 1920
  height: 1080
  slides: [
    Slide {
      label: "Typography"
      content: Freeform {
        children: [
          TextBox {
            x: 240
            y: 180
            width: 720
            height: 440
            font: "display"
            fontSize: 42
            fontWeight: "500"
            lineHeight: 1.4
            letterSpacing: 1.5
            align: "center"
            wrap: true
            content: [
              "Mixed "
              Span {
                content: "style"
                size: 48
                weight: "700"
                letterSpacing: 2
                color: accent
              }
            ]
            bullets: [
              "First bullet"
              ["Second ", Span { content: "bullet" italic: true }]
            ]
          }
        ]
      }
    }
  ]
}
