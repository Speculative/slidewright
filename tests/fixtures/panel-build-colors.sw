Deck {
  width: 1920
  height: 1080
  tokens: Tokens { red: "#d42a0c" blue: "#0000ff" teal: "#007d70" }
  slides: [Slide {
    content: PlateauSlide { branding: true content: Freeform { children: [
      CodeDisplay {
        id: "code"
        x: 100 y: 225 width: 1000 height: 700
        content: [Paragraph { content: [Span {
          runId: "code-run"
          content: """
            def evaluate(node):
                match node.op:
                    case "+": result = left + right
                    case "*": result = left * right
                    case "^": result = left * right
                return result
          """
        }] }]
      }
      TerminalDisplay {
        id: "terminal"
        x: 1150 y: 225 width: 600 height: 350
        content: [Paragraph { content: [
          ">>> calculate("
          Span { id: "expression" color: blue content: [Span {
            runId: "expression-run"
            color: blue
            content: """
              "2 + 3 * 4 ^ 2"
            """
          }] }
          ")\n"
          Span { runId: "output-run" content: "^\n*\n+" }
          "\n26"
        ] }]
      }
    ] } }
    builds: [
      Build { id: "one" changes: [] }
      Build { id: "two" changes: [] }
      Build { id: "three" changes: [Change {
        target: "code"
        content: [Paragraph { content: [Span {
          runId: "code-run"
          content: """
            def evaluate(node):
                match node.op:
                    case "+": result = left + right
                    case "*": result = left * right
                    case "^": result = left * right
                print(node.op)
                return result
          """
        }] }]
      }] }
    ]
  }]
}
