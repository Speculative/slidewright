Deck {
  name: "Media"
  width: 1920
  height: 1080
  slides: [
    Slide {
      label: "Media"
      content: Freeform {
        children: [
          Image { x: 300, y: 200, width: 400, height: 225, src: "/tests/fixtures/media.svg", alt: "Fixture logo", fit: "cover", radius: 20 }
          Video { x: 900, y: 200, width: 640, height: 360, src: "/tests/fixtures/media.webm", label: "Demo", loop: true, muted: true }
        ]
      }
    }
  ]
}
