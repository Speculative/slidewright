// v0 reference deck — the smallest end-to-end demo of Slidewright v0.0.
// Mirrors design/sketches/title-slide.md and three-obstacles.md at
// minimum-viable depth.

Deck {
  name: "Slidewright"
  subtitle: "v0.0 reference"
  width: 1920
  height: 1080

  // Source-declared color tokens. Override any registry default and
  // add deck-specific named colors. Visible to every slide's
  // `color`/`fill`/`stroke` name_refs (`fill: brand`, etc.).
  tokens: Tokens {
    brand: oklch(0.55 0.18 285)
    soft:  oklch(0.92 0.02 285)
  }

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
          Box { x: 200, y: 220, width: 460, height: 320, fill: brand }
          Box { x: 760, y: 380, width: 380, height: 240, fill: cyan }
          Box { x: 1240, y: 580, width: 280, height: 280, fill: oklch(0.62 0.22 25) }
        ]
      }
    }

    Slide {
      label: "Rich text"
      notes: """
        Reference surface for source-backed slide text. It demonstrates
        TextBox defaults, mixed Span runs, links and decorations, flat
        numbered bullets, a nested structured list, wrapping, alignment,
        and non-destructive shrink-to-fit.
      """
      content: Freeform {
        children: [
          TextBox {
            x: 120
            y: 70
            width: 1680
            height: 110
            font: "display"
            fontSize: 58
            fontWeight: "700"
            letterSpacing: -1
            align: "center"
            content: [
              "Slide-grade "
              Span { content: "rich text" color: brand italic: true }
            ]
          }
          TextBox {
            x: 120
            y: 220
            width: 790
            height: 310
            fontSize: 32
            lineHeight: 1.4
            wrap: true
            content: [
              "Mixed runs preserve "
              Span { content: "weight" weight: "800" }
              ", "
              Span { content: "size" size: 42 }
              ", "
              Span { content: "mono" font: mono }
              ", "
              Span { content: "color" color: accent }
              ", "
              Span { content: "italic" italic: true }
              ", "
              Span { content: "underline" underline: true }
              ", "
              Span { content: "strikethrough" strikethrough: true }
              ", and "
              Span {
                content: "links"
                href: "https://example.com/slidewright"
                color: blue
                underline: true
              }
              "."
            ]
          }
          TextBox {
            x: 120
            y: 570
            width: 790
            height: 330
            fontSize: 32
            lineHeight: 1.45
            listStyle: "decimal"
            listStart: 3
            content: omit
            bullets: [
              "Flat lists choose their marker style."
              ["Items still accept ", Span { content: "mixed runs" weight: "700" }, "."]
              "The authored starting number round-trips."
            ]
          }
          TextBox {
            x: 1010
            y: 220
            width: 790
            height: 510
            fontSize: 32
            lineHeight: 1.35
            content: List {
              style: "upper-alpha"
              start: 2
              items: [
                ListItem { content: "Structured lists can be ordered." }
                ListItem {
                  content: ["A list item can own a ", Span { content: "nested list" weight: "700" }, "."]
                  children: List {
                    style: "square"
                    items: [
                      ListItem { content: "Nesting is explicit in source." }
                      ListItem { content: "Child text remains canvas-editable." }
                    ]
                  }
                }
                ListItem { content: "Markers and start values remain semantic." }
              ]
            }
          }
          TextBox {
            x: 1010
            y: 790
            width: 790
            height: 105
            font: "display"
            fontSize: 54
            fontWeight: "700"
            align: "center"
            wrap: false
            shrinkToFit: true
            color: muted
            content: "Shrink-to-fit keeps the authored font size in source."
          }
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

    Slide {
      label: "Empty slots"
      notes: """
        Empty-slot placeholders. Optional slots omitted in source
        surface as dashed teal boxes (block/slide types) or inline
        ghost text (text type). Click a placeholder to select the
        slot — the inspector shows a 'Slot: <name> (empty)' panel.
        For text slots: type a value + Enter in the inspector to
        materialize the fill, or double-click the placeholder to
        enter contentEditable directly. For block / slide slots:
        the inspector shows a deferred-insertion hint (slot-
        targeted insertion gestures are next).

        This slide's ContentSlide intentionally omits eyebrow,
        intro, and body. The CardRow below omits its body slot.
      """
      content: ContentSlide {
        title: "Empty-slot demo"
      }
    }

    Slide {
      label: "Empty slots in a stack"
      notes: """
        Two CardRows: one fully filled (for comparison), one with
        only the eyebrow filled — heading and body show empty text
        placeholders. Useful for testing empty placeholders inside
        a layout that itself has gestures (gap-drag, reorder).
      """
      content: VStack {
        spacing: 32
        children: [
          CardRow {
            color:   purple
            eyebrow: "Filled"
            heading: "All slots have values."
            body:    "For comparison."
          }
          CardRow {
            color:   cyan
            eyebrow: "Partly empty"
          }
        ]
      }
    }

    Slide {
      label: "Stacks demo"
      notes: """
        Slide-level VStack with flow-laid CardRow children. Click
        an empty area inside the VStack to select it; the inspector
        shows `spacing`. Drag a child to reorder; drag a gap grip
        to change spacing. The VStack is directly under the slide
        (no Freeform wrapper) — selection visuals portal into the
        slide stage.

        Stack children must be flow-laid components (CardRow,
        future Eyebrow / Title typography roles). Box / TextBox
        use absolute positioning so they overlap when placed in a
        flex parent — which is correct, just not sensible.
      """
      content: VStack {
        spacing: 24
        children: [
          CardRow {
            color:   purple
            eyebrow: "VStack"
            heading: "Children flow vertically."
            body:    "Click an empty area inside the VStack to select it; edit `spacing` in the inspector."
          }
          CardRow {
            color:   cyan
            eyebrow: "Spacing"
            heading: "Drives the flex gap."
            body:    "The number param surfaced in the inspector commits straight back to source on Enter."
          }
        ]
      }
    }
  ]
}
