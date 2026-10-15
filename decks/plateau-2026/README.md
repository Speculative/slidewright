# Editable PLATEAU 2026 talk

Open `/canvas.html?deck=plateau` through `npm run dev`.

The five presentation videos are local assets, excluded from Git. Before
building or running the PLATEAU tests in a new checkout, copy `agg_filter.mp4`,
`computed.mp4`, `stack_trace.mp4`, `stepping.mp4`, and `streams.mp4` into
`decks/plateau-2026/assets/`. If you have the original talk under `inspiration/`,
run this from the repository root:

```sh
cp inspiration/talk/static/{agg_filter,computed,stack_trace,stepping,streams}.mp4 decks/plateau-2026/assets/
```

These files remain on disk in the existing working checkout. Keep a separate
copy when moving to another machine; a Git clone does not contain the videos.

`deck.sw` contains the 20 slides from the actual presentation, including
speaker notes. Original PLATEAU wording is preserved as the editing baseline.
The source is canonical structured text. Headings, prose, code examples,
labels, panels, images, and videos are native movable canvas objects.

Double-click a TextBox to edit its text and styles. Done commits the draft;
Cancel discards it. Whole-box defaults are available on selection and during
the draft. Drag objects to move them and use selection handles to resize.

`DebuggerDemo` and `StateTimeChart` are intentionally opaque visualizations.
Their geometry is editable; their local step/playback controls do not write
source. Video playback uses explicit Play/Pause/Restart controls.

`PlateauSlide` supplies a full-slide positioning context independent of host
chrome. `registry.ts` shares the current host component catalog. Named asset
references resolve to files in `assets/` through the standalone host, including
hashed Vite URLs in built output. The browser hosts bundle the original Lato
and Monaspace Neon fonts through `presentation.css`, scoped to PLATEAU slides
so host/reference typography is preserved. Box border width/color and corner
radius are source-backed; decorative title highlights have no border. `migration.json` records the original source
hash and normalized speaker-note hashes for preservation checks.

Use the Deck picker to switch between PLATEAU and the reference deck. Committed
edits are saved separately in browser storage; Save draft confirms storage.
Download source exports the current full deck as a `.sw` file. Open source
imports a saved deck with the bundled component/asset catalog. These browser
edits do not overwrite the repository file; replace `deck.sw` with a downloaded
copy when you want to keep the changes in version control.

Present hides editor chrome and keeps keyboard slide navigation and media/demo
controls. Fullscreen fills the audience display with the slide, hiding the file
toolbar and authoring frame. Escape or the Exit fullscreen overlay returns to
windowed presentation on the same slide; Edit slides returns to authoring.
`npm run build` includes the canvas
and all talk media; serve `dist/` with `npm run preview`. The production check is
`npm run test:production`.

Presenter view opens a separate speaker console with current/next slide
outlines, live speaker notes, slide navigation and an elapsed timer. It also
puts the audience window into Present mode. Previews show the slide's initial
build; animation build synchronization and click-to-progress behavior are
tracked separately. Close and reopen the presenter window as needed.
