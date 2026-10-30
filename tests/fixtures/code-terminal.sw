Deck {
  width: 1920
  height: 1080
  slides: [Slide { content: PlateauSlide { content: Freeform { children: [
    CodeDisplay {
      x: 65
      y: 229
      width: 1111
      height: 740
      fontSize: 40
      highlightedLines: []
      code: """
        def evaluate(node):
            if isinstance(node, Num):
                return node.value
            left = evaluate(node.left)
            right = evaluate(node.right)
            match node.op:
                case "+": result = left + right
                case "*": result = left * right
                case "^": result = left * right
            return result
      """
      id: "example-code"
    }
    TerminalDisplay {
      x: 1218
      y: 236
      width: 622
      height: 320
      fontSize: 32
      content: ">>> calculate(\"2 + 3 * 4 ^ 2\")\n26"
      id: "example-terminal"
    }
  ] } } }]
}
