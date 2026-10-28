Deck { name: "Keyframe interaction" width: 1920 height: 1080 slides: [
  Slide { label: "Diagram" content: Freeform { id: "diagram" children: [
    Box { id: "node" x: 100 y: 150 width: 240 height: 160 fill: oklch(0.7 0.15 40) }
    TextBox { id: "caption" x: 500 y: 150 width: 600 height: 160 content: "Diagram caption" }
  ] } builds: [
    Build { id: "focus" label: "Focus" changes: [] }
    Build { id: "return" label: "Return" changes: [] }
  ] }
  Slide { label: "Next slide" content: Freeform { children: [TextBox { x: 100 y: 100 width: 900 height: 200 content: "After the diagram" }] } }
] }
