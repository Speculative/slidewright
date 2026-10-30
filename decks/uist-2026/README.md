# Editable UIST 2026 talk

Open `/canvas.html?deck=uist-2026` through `npm run dev`.

A preserved [example/demo snapshot](../plateau-demo/README.md) is available at
`/canvas.html?deck=plateau-demo`. Its edits stay in browser drafts, leaving the
example source intact. This working talk continues to save to disk.

The headshot (`assets/headshot.jpg`) and five presentation videos are local
assets, excluded from Git. Supply `headshot.jpg` separately in
`decks/uist-2026/assets/` when setting up a fresh checkout. Before
building or running the PLATEAU tests in a new checkout, copy `agg_filter.mp4`,
`computed.mp4`, `stack_trace.mp4`, `stepping.mp4`, and `streams.mp4` into
`decks/uist-2026/assets/`. If you have the original talk under `inspiration/`,
run this from the repository root:

```sh
cp inspiration/talk/static/{agg_filter,computed,stack_trace,stepping,streams}.mp4 decks/uist-2026/assets/
```

These files remain on disk in the existing working checkout. Keep a separate
copy when moving to another machine; a Git clone does not contain the headshot or videos.

The footer reads `UIST 2026 // Chapter Name`. “Chapter 1” is a temporary
chapter title until the talk outline is settled. Select the first slide's
Slide row in the hierarchy and edit its `chapter` property to rename it.
All following slides inherit that title until the next slide with a
`chapter` property. To start another chapter, select its first slide and
fill in `chapter (default)` with a quoted title, such as `"Demo"`. Chapter
boundaries belong to slides, so moving a boundary slide moves the boundary.
Set a slide's `chromeless` property to `true` to hide its footer; this does
not stop chapter inheritance. Footers are otherwise shown by default.
The deck's empty `subtitle` keeps the breadcrumb to two parts.

`deck.sw` contains the 20 slides from the actual presentation, including
speaker notes. The PLATEAU talk supplies the editing baseline for UIST 2026.
The source is canonical structured text. Headings, prose, code examples,
labels, panels, images, and videos are native movable canvas objects.

Double-click a TextBox to edit its text and styles. Done commits the draft;
Cancel discards it. Whole-box defaults are available on selection and during
the draft. Drag objects to move them and use selection handles to resize.

`DebuggerDemo` and `StateTimeChart` are intentionally opaque visualizations.
Their geometry is editable; their local step/playback controls do not write
source. Video playback uses explicit Play/Pause/Restart controls.

`CodeDisplay` is a standalone Python panel: edit its `code` string in source or
the inspector. Select the CodeDisplay in the hierarchy and enter `[7, 9]` in
the `highlightedLines` inspector field (Enter or blur applies it; `[]` clears).
In source, set `highlightedLines: [7, 9]` to emphasize one-based line
numbers. Its geometry and `fontSize` are source-backed; text shrinks to fit
when the panel is resized to share space with other objects.
Python syntax uses purple keywords, teal functions/builtins, blue strings,
and orange numbers/booleans; line emphasis uses a yellow background.
In the authoring canvas, click a code line number (or focus it and press
Space/Enter) to toggle its emphasis. **Edit code** and **Edit output** open
multiline draft editors for CodeDisplay and TerminalDisplay. Save or
Ctrl/Mod-Enter applies the draft as one undoable source edit; Cancel/Escape
discards it. Source changes, slide/build navigation, and entering presentation
discard drafts. Text-range formatting is not implemented for these panels yet.

`TerminalDisplay` is a movable terminal transcript next to the calculator
example. Edit its `content` string in source or the inspector to reuse it
with any transcript; newlines, blank lines, and indentation are preserved.
Its `title`, `fontSize`, and geometry are also source-backed. Set `title: ""`
to hide the heading. Long lines wrap within the panel.

`PlateauSlide` supplies a full-slide positioning context independent of host
chrome. `registry.ts` shares the current host component catalog. Named asset
references resolve to files in `assets/` through the standalone host, including
hashed Vite URLs in built output. The browser hosts bundle the original Lato
and Monaspace Neon fonts through `presentation.css`, scoped to PLATEAU slides
so host/reference typography is preserved. The UIST working deck opts into
`PlateauSlide.branding: true`: its body/display faces are Lato, code is
JetBrains Mono, and shared debugger code/terminal/variable panels use the
personal design system's light colors. `Deck.tokens` contains the brand
palette, text-safe tag colors and legacy-name aliases for source-backed
color picking. Authored text and panels use those names. The palette and
scoped CSS values come from the imported design system v0.1. Place-time
and state-time SVG chart colors remain the original blue/red/orange;
embedded raster images and videos are preserved. The PLATEAU snapshot
keeps its original typefaces and colors because branding is opt-in. Box border width/color and corner
radius are source-backed; decorative title highlights have no border. `migration.json` records the original source
hash and normalized speaker-note hashes for preservation checks.

Use the Deck picker to switch between UIST 2026, the PLATEAU demo, and the reference deck. With
`npm run dev`, committed edits save continuously to the repository source file.
External file changes display “Out of sync” and stop writes; download the local
text or use Reload from disk to discard it and reconnect. Static builds and
imported decks keep browser drafts instead; Save draft confirms storage.
Download source exports the current full deck as a `.sw` file. Open source
imports a saved deck with the bundled component/asset catalog.

Present hides editor chrome and demo step controls. Right/Space/PageDown and
a left click on the slide advance one build; Left/PageUp reverses one build.
Motion within a build runs automatically, then waits. At a build boundary,
navigation moves to the adjacent slide. Each slide entry starts at build zero;
R resets the current build. Multiple visuals advance together, each stopping at
its own final stage. Video controls remain interactive. Fullscreen fills the
audience display with the slide, hiding the file toolbar and authoring frame. Escape or the Exit fullscreen overlay returns to
windowed presentation on the same slide; Edit slides returns to authoring.
`npm run build` includes the canvas
and all talk media; serve `dist/` with `npm run preview`. The production check is
`npm run test:production`.

Presenter view opens a separate speaker console with current/next slide
outlines, live speaker notes, slide navigation and an elapsed timer. It also
puts the audience window into Present mode. The current preview shares the
audience's build state; the next preview shows its initial build. Arrow keys
and R control the same audience build. Previous/Next slide buttons skip builds.
Close and reopen the presenter window as needed.
