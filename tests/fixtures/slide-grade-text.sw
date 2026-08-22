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
            listStyle: "decimal"
            listStart: 3
            content: [
              "Mixed "
              Span {
                content: "style"
                size: 48
                weight: "700"
                letterSpacing: 2
                color: accent
              }
              " with "
              Span { content: "underline" underline: true }
              ", "
              Span { content: "strike" strikethrough: true }
              ", and a "
              Span {
                content: "link"
                href: "https://example.com/rich-text"
                underline: true
              }
            ]
            bullets: [
              "First bullet"
              ["Second ", Span { content: "bullet" italic: true }]
            ]
          }
          TextBox {
            x: 1040
            y: 180
            width: 640
            height: 620
            fontSize: 34
            content: List {
              style: "upper-alpha"
              start: 2
              items: [
                ListItem { content: "Structured item" }
                ListItem {
                  content: ["Nested ", Span { content: "list" weight: "700" }]
                  children: List {
                    style: "square"
                    items: [
                      ListItem { content: "Editable child" }
                      ListItem { content: "Second child" }
                    ]
                  }
                }
              ]
            }
          }
        ]
      }
    }
  ]
}
