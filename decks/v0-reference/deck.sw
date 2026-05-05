// v0 reference deck — the smallest end-to-end demo of Slidewright v0.0.
// Mirrors design/sketches/title-slide.md and three-obstacles.md at
// minimum-viable depth.

Deck {
  name: "Slidewright"
  subtitle: "v0.0 reference"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Title"
      notes: """
        Title slide for the Slidewright v0.0 demo.
        - Speaker notes round-trip through triple-quoted strings.
      """
      content: TitleSlide {
        venue:       "SLIDEWRIGHT · v0.0"
        title: [
          "Vibe Debugging with "
          Span { color: accent, font: mono, content: "autopsy-report" }
        ]
        subtitle:    "or: towards comprehending agent-written code"
        presenter:   "Jeffrey Tao"
        affiliation: "Penn HCI Lab"
        headshot:    headshotImg
      }
    }

    Slide {
      label: "Freeform demo"
      notes: """
        Three colored boxes positioned in a Freeform container.
        Drag them around in the canvas to test drag-to-move.
      """
      content: Freeform {
        children: [
          Box { x: 200, y: 220, width: 460, height: 320, fill: amber }
          Box { x: 760, y: 380, width: 380, height: 240, fill: cyan }
          Box { x: 1240, y: 580, width: 280, height: 280, fill: magenta }
        ]
      }
    }

    Slide {
      label: "Three obstacles"
      notes: """
        - Behavior isn't a thing you can just look at.
        - Three problems: representation, attention, volume.
      """
      content: ContentSlide {
        eyebrow: "Three obstacles"
        title:   "Behavior is hidden by default."
        intro:   "Programs do a lot, and most of it is invisible by default. "
                 "To observe behavior, you have to solve three problems."
        body: VStack {
          spacing: 32
          children: [
            CardRow {
              color:   purple
              eyebrow: "Representation"
              heading: "Code isn't behavior."
              body:    "Code shows what could happen, not what did. Behavior has to be captured and shaped into something you can read."
            }
            CardRow {
              color:   cyan
              eyebrow: "Attention"
              heading: "It's mostly noise."
              body:    "Useful observations are buried within everything else. Which parts actually matter?"
            }
            CardRow {
              color:   magenta
              eyebrow: "Volume"
              heading: "There's too much stuff."
              body:    "Even when you know where to look, the data is a firehose."
            }
          ]
        }
      }
    }
  ]
}
