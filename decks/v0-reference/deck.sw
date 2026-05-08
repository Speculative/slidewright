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
