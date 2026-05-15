// ContentSlide demo for the slotsState / per-component-omit-treatment
// behavior. eyebrow is filled (renders inside .eyebrow); intro has
// no fill (renders the loader's placeholder INSIDE .eyebrow-class
// styling, so the user has an affordance to author into it); body
// is omit'd (skipped entirely — no wrapper element in the DOM).

Deck {
  name: "Test"
  subtitle: "content-slide fixture"
  width: 1920
  height: 1080

  slides: [
    Slide {
      label: "Test"
      content: ContentSlide {
        eyebrow: "EYEBROW TEXT"
        title: "Title"
        body: omit
      }
    }
  ]
}
