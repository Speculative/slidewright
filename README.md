# Slidewright

A projectional editor for code-based slide decks. Typed brace-block `.sw`
source and React/TypeScript components share one source of truth with the
visual canvas: direct edits round-trip back into source.

## Run and develop

```sh
npm install
npm run dev                 # Vite at http://localhost:5173
npm run build               # static output in dist/
npm run preview             # serve the production build
```

- `/canvas.html` — standalone Slidewright editor, with a deck picker.
- `/canvas.html?deck=uist-2026` — editable UIST 2026 talk. See the
  [talk README](decks/uist-2026/README.md) for required local media,
  browser drafts, presenting, and the speaker console.
- `/canvas.html?deck=plateau-demo` — preserved PLATEAU example; edits stay in
  browser drafts. See the [demo README](decks/plateau-demo/README.md).
- `/canvas.html?fixture=<name>` — load `tests/fixtures/<name>.sw` for debugging.
- `/` — read-only reference-deck presentation.

With `npm run dev`, edits to the reference and UIST decks save continuously
back to their repository `.sw` files. The editor checks disk revisions every
500 ms, including while idle. An external change stops writes and displays
“Out of sync”; local text stays available to download. **Reload from disk**
discards the local draft and reconnects to the current file. Saves compare the
last acknowledged revision before writing. This is optimistic synchronization:
independent processes writing in place can still race the filesystem calls.

The PLATEAU demo, static builds, imported files, and fixtures do not write
repository files.
Static builds and imports keep browser drafts; use **Download source** to export
them. Server-backed decks normally load from disk. Pending unsaved edits are backed
up in browser storage and recovered after reload or deck switching. A recovered
draft differing from disk opens out of sync, ready to download; it never
overwrites disk automatically. Only Reload from disk explicitly discards it.
Browser storage failures show a warning. Uncommitted rich-text drafts (before
Done/blur) are not backed up, and browser storage is not a version history.
The hosts use bundled component registries; arbitrary deck-local TSX compilation
is not yet implemented.

```sh
npm test                    # typecheck + runtime/canvas smoke tests
npm run test:e2e             # Playwright browser suites, excluding perf
npm run test:perf            # opt-in gesture scaling sweep
npm run test:production      # build + production browser checks
npm run slidewright -- decks/v0-reference/deck.sw  # validate source
npm run extension:build      # build the VS Code extension
npm run extension:watch      # watch extension bundles
npm run extension:typecheck  # extension and webview typechecks
npm run code-server         # browser VS Code on :8080 in Carthage
```

See the [extension README](extension/README.md) for the F5 development-host
workflow and the **Slidewright: Open Canvas** command. Browser tests run against
the standalone host; desktop VS Code still needs a smoke check before release.

## Canvas shape shortcuts

Press **T** for text, **R** for a rectangle, **E** for a line (Edge),
**Shift+E** for an arrow, or **O** for an ellipse. Click to place text;
drag to draw the other shapes inside a Freeform. **Escape** cancels the
armed tool. These shortcuts stay inactive while typing or presenting.
**I** opens the insertion picker, which also includes Line and Ellipse.

Select a Line or Arrow and use **startHead** / **endHead** in the inspector
to choose `none`, `arrow`, or `circle` independently at either endpoint.
These settings are saved in the `.sw` source and support canvas undo.

## Slide builds

In the canvas editor, **Add build** creates an indented frame beneath the
selected slide. Edit objects, text, or styling in that frame; changes propagate
forward until the next explicit property keyframe. The **Forward / Backward / Everywhere**
control (Alt+Shift+B) changes the direction of the next edit. Property diamonds
pin an unchanged value or reset it to inherited. Everywhere applies edited
properties to all frames, replacing their keyframes while retaining unrelated
properties. Duplicate a frame, pin values,
and reorder it to create a return state after temporary emphasis.

The whole-text-box toolbar exposes diamonds for font, size, bold weight,
foreground color, line height and letter spacing, including mixed keys when
multiple boxes are selected. Its scope label follows the propagation control.
Whole-box formatting preserves later wording variants and clears conflicting
inline overrides within the affected range. Press Enter to reapply a displayed
value in Everywhere mode. **Text & inline styles** shares a content key for
wording and range formatting; individual phrase styles do not yet have
independent keys.

An object's first appearance and each reappearance implicitly protect its
non-visibility properties. Backward from a later build preserves that appearance
frame, including the initial frame for objects already visible there. Forward
stops before a subsequent appearance. Green diamond outlines show this
protection; explicit pins remain separate. Everywhere crosses both kinds of
barrier when revising the complete diagram.

**Hidden objects** restores objects removed in a build. Presentation visits each
build before advancing slides; the presenter window follows the same sequence.
**PDF pages** selects final-state-only or one page per authored build. Changes
are instantaneous in this version; grouping/reparenting should be done before
adding builds. See [the build model](slidewright/runtime/builds.md) for source
syntax and detailed behavior.

## Repository map

- [SLIDEWRIGHT.md](SLIDEWRIGHT.md) — durable architecture, component contracts, and
  design rationale. Ostraka items hold work discussions and outstanding
  tasks; the Ostraka project brief holds concise durable agent context.
- `decks/v0-reference/` — reference `deck.sw`, shared `registry.ts`, and
  component modules. Modules export React rendering, `slidewright` metadata,
  and optional `canvas` adapters.
- `decks/plateau-demo/` — preserved PLATEAU example source, sharing talk assets.
- `decks/uist-2026/` — editable talk, custom components, and local assets.
- `decks/ne-agents-day-2026/` — original React/JSX deck retained as a reference.
- `slidewright/runtime/` — lexer, parser, AST, emitter, loader, component
  contract, cells, scope, and diagnostics; `__test__/` contains smoke tests.
- `slidewright/grammar/` — declarative grammar specification, outside the build.
- `slidewright/canvas/` — host-agnostic editor. `App.tsx` coordinates state and
  commits; `host.ts` defines the host boundary; `ScaledCanvas.tsx` handles the
  design surface and pointer dispatch; `InspectorPanels.tsx` handles hierarchy
  and properties; `EditorPane.tsx` hosts the standalone CodeMirror source view.
  Gesture and grouping entry points are documented in SLIDEWRIGHT.md.
- `src/canvas-standalone.tsx` and `src/standalone-host.ts` — browser entry and
  Host adapter; `canvas.html` is the HTML entry.
- `extension/src/canvas.ts` and `extension/src/webview/` — VS Code integration.
- `tests/` — Playwright suites and `.sw` fixtures; `design/sketches/` — worked
  DSL examples with commentary.

## Repository assets and commit checks

Presentation videos and `decks/uist-2026/assets/headshot.jpg` are local assets
and are ignored by Git. See
`decks/uist-2026/README.md` for the PLATEAU media setup.

`npm install` / `npm ci` installs the versioned pre-commit hook through the
`prepare` script. For an existing checkout, run `npm run prepare` once.
The hook rejects added or modified staged files over 1 MiB, including files
added with `git add -f`. It checks all file types, so large binary files cannot
slip through by changing their extension. Existing unchanged tracked assets
are unaffected. Run `npm run check:staged` to check manually and
`npm run test:commit-hook` to test the hook.

Git ignore rules cannot enforce a size limit. The hook is local protection;
Git's `--no-verify` option can bypass it, and clones need the install step.

## React presentation runtime

`index.html` loads `src/main.jsx`, which mounts `src/App.jsx`. That app wraps the
rendered reference deck in `src/Presentation.jsx`; `src/Slide.jsx` supplies Slide
and Section primitives. The runtime owns keyboard navigation, viewport scaling,
slide persistence, print sizing, and the `public/notes.html` speaker popout.
The original JSX deck is retained in `decks/ne-agents-day-2026/Deck.jsx`.

Presentation keys: arrows / Page Up / Page Down / Space navigate, digits jump,
Home / End select first / last, R resets, and N opens notes. Browser Print →
Save as PDF emits one page per slide at the design size.

`src/styles.css` defines the shared typography, layout, card, chip, and code
styles. Accent color is `var(--accent)`.
