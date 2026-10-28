Deck { name: "Build export" width: 960 height: 540 tokens: Tokens { ink: oklch(0.45 0.12 250) } slides: [
  Slide { label: "Diagram" chapter: "Opening chapter" notes: "Explain the reveal." content: Freeform { id: "scene" children: [
    TextBox { id: "caption" x: 50 y: 70 width: 700 height: 100 color: ink content: "Initial caption" }
    Image { id: "portrait" x: 800 y: 20 width: 100 height: 100 src: headshotImg }
    Box { id: "reveal" visible: false x: 60 y: 200 width: 100 height: 100 }
  ] } builds: [
    Build { id: "reveal" changes: [Change { target: "caption" content: "Revealed caption" } Change { target: "reveal" visible: true x: 300 }] }
    Build { id: "final" changes: [Change { target: "caption" content: "Final caption" } Change { target: "reveal" x: 500 }] }
  ] }
  Slide { label: "Closing" notes: "Thank the audience." content: Freeform { children: [
    TextBox { x: 50 y: 70 width: 700 height: 100 content: "Closing caption" }
  ] } }
] }
