# Editable PLATEAU 2026 talk

Open `/canvas.html?deck=plateau` through `npm run dev`.

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
hashed Vite URLs in built output. `migration.json` records the original source
hash and normalized speaker-note hashes for preservation checks.
