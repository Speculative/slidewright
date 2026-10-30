Jeff Tao's personal system for sites, talks, prototypes, apps and artifacts. **Version 0.1**, a working prototype: internally consistent, still being tested against real work.

## Ethos

Jeff is a technologist who insists on the importance of human thought inside technological systems. The work builds tools in which people reason, point, notice and change their minds, rather than systems that think for them. The identity should say the same thing at a glance.

- **Bold and confident.** Black ink on white paper, one loud accent, big tight type. No hedging with soft gradients, pastel washes or rounded corners.
- **Forward-looking, with a lineage.** The vocabulary comes from the early web and from the first personal-computing interfaces (classic Mac OS, Windows 2–3, HyperCard), plus the flat, saturated colour of Businessweek. It is used deliberately and composed in a modern way, not as nostalgia.
- **Humane.** The person is always visible in the system: a selection being held, a value being dragged, an estimate being corrected. Warmth comes from showing people thinking, not from decoration.
- **A little contrarian.** The stance is "let me show you something you might not expect". Every artifact should have a moment where the obvious answer is shown and then overturned.

Three devices carry the human touch across every medium:

1. **Show the revision.** Keep the expectation visible and strike it through beside the truth: ~~12 rows~~ → 1,204,551. This is the default rhetorical move on slides and pages.
2. **Let people point.** Selection outlines with handles, inspectors and highlighted lines (`SelectionBox`, `Code` `highlight`) show a person holding and examining part of the system.
3. **Let readers think.** Anything continuous is scrubbable (`NumberField`), and live values sit next to what produces them. On the web, prefer an explorable figure to a static one.

## Principles

1. **Ink on paper first.** `ink` on `paper` carries everything. Colour is added, never needed to read the page.
2. **One accent per view, used loudly.** Spend it on solid blocks (a highlight, a card's shadow, the selection), never on tints for decoration or on gradients.
3. **Square.** Every box is `radius-0`. Only true circles (plot points, diagram nodes) use `radius-full`.
4. **Hard, not soft.** Shadows are solid offset blocks, never blurred. Hover and activation invert colours instead of fading.
5. **Colour has a job.** Accent means "here, this one". Tags mean "this category". `danger` means "this is wrong". Nothing is coloured for decoration.

## Status of v0.1

- **Settled:** ink and paper, square geometry, hard offsets, the accent slot (blue, red, orange, purple), the eight tag colours, Lato with JetBrains Mono, the app layer and its components, the three code schemes.
- **Provisional:**
  - Purple stays as an accent for now and is under review. It is not a tag.
  - The eight tags will be winnowed as they are used.
  - IBM Plex Sans is still a candidate against Lato.
  - **The app canvas is on trial.** The current grey (A) stays the default while five candidates are tried in real apps: neutral (C2), warm (F2), dots (B), grid (C3) and blueprint (D2). See the `Canvas` card.
- **Forthcoming:**
  - **A chart palette.** The tag colours are too loud for visualisation and clash on a shared chart; until a quieter family exists, follow "Charts and figures" below.
  - **Dark mode colours.** The dark theme has values for every token and reads well in apps, but it has not been designed for slides or the site, and its accent and tag values may change.

## Content fundamentals

- First person and plain: "Hi, I'm Jeff!", "In my spare time, I also maintain some side projects". No marketing voice.
- Lead with the surprising fact, then the explanation: "The planner is confidently wrong", then the numbers.
- Headings on sites are short nouns (News, Publications, Projects). Slide headlines are Title Case phrases, often `Topic: Specific` ("Observations: Repeated Changes").
- On the site, news items start with a dated bracket, `[2026.08]`. On slides, citations sit inline in parentheses: "(Wu et al., UIST '23)".
- The full name is "Jeff Tao" in headers and "Jeffrey Tao" in author lists. On the site, his own name in author lists is set in `accent-text`.
- In notes and labels, write like an engineer, not a pundit: "est. 12, actual 1.2M", not "100,000× off!".
- Emoji only as reactions on slides (😄 😭 ✅ ❌ ❓ marking pros, cons and open questions), never as decoration, bullets or in app chrome.

## Colour

**Neutrals.**
- Page: `paper`. Text, borders, rules: `ink`. Secondary text: `ink-muted`. Hairlines: `rule`. Quiet panels behind code or figures: `surface`. App workspace behind a document: `canvas` (apps only; objects on it stay `paper`; never a page, card or panel background).
- `ink-dimmed` is only for greyed-out items in a progressive slide build. It fails contrast on purpose.

**Accents.**
- Four accents: **blue** (default, `#0000FF`), **red**, **orange** and **purple**.
- Components read only the slot tokens:
  - `accent`: the fill.
  - `on-accent`: text on the fill.
  - `accent-text`: the accent as a link or emphasis on `paper`.
  - `accent-tint`: the selection wash.
  - `focus`: the focus ring.
- Swap the accent for a subtree with `data-accent="red|orange|purple"` on any container, or pass `accent` to a component.
- Use one accent per artifact or project, for example FreeForm orange or GREMLIN purple. Don't mix accents within a view.
- Text on the accents: white on blue, red and purple; black on orange. As text on paper, orange uses its darker `accent-orange-text`.
- Blue, red and orange are the same colours as tags 1, 4 and 2 (`accent-blue` = `{tag-1}`), so a blue accent and a blue tag never drift apart.

**Tags.**
- Eight categorical colours for chips, coded segments and highlights, in this order: `tag-1` blue, `tag-2` orange, `tag-3` teal, `tag-4` red, `tag-5` yellow, `tag-6` cyan, `tag-7` pink, `tag-8` graphite.
- Each tag has three tokens:
  - `tag-N`: the fill.
  - `on-tag-N`: text on the fill.
  - `tag-N-text`: the hue as text on `paper`.
- Use tags in order. The order keeps the pairs that merge under colour blindness apart: blue/cyan, red/orange, red/pink.
- `tag-8` (graphite) is for "uncoded", "other" and disabled categories.
- In chips, a tag is a solid swatch beside an `ink` label, so colour is never the only cue.
- Background highlights use `tag-N` with `on-tag-N`; foreground highlights use `tag-N-text`. Prefer yellow and orange as backgrounds, since their text values are weak.
- When two things must be told apart (A vs B in a formula, two branches of a diff), use blue + orange.

**Errors.**
- `danger` (`#C2300E`) is for errors and destructive actions only, always with an icon and a sentence that names the fix.
- In a red-accented scope, errors must carry the icon and words, because the colour alone no longer distinguishes them.

**Dark theme (provisional).**
- `paper` and `ink` swap, and the `band` inverts to white.
- The blue fill brightens to `#5C5CFF`.
- Every `*-text` colour is lifted to at least 8:1 on black. Saturated hues at the 4.5:1 minimum look dim and buzzy on black.
- Light is the default. Dark is for screens that ask for it.

## Type

- **Lato** for everything: headings at 700–900 with -0.02em tracking, body at 400. **JetBrains Mono** for code, data, numbers in apps, SQL and LaTeX. Both ship as files in `fonts/`.
- Web scale: `display` (site name, once), `h1`, `h2`, `h3`, `body` (16/24), `small` for authors and venues, `label` (uppercase).
- Slide scale at 1920×1080: `slide-title` 96, `slide-heading` 60, `slide-subhead` 48, `slide-label` / `slide-body` 36, `slide-caption` 24. Nothing on a slide is smaller than 24px.
- App scale: `ui-title`, `ui`, `ui-strong`, `ui-label` (uppercase), `ui-mono`, `ui-touch`.
- Code: `code` (14/20) on the web, `code-slide` (36/48) on slides.
- IBM Plex Sans (`sans-alt`, styles `alt-h1`, `alt-body`) is a candidate kept for comparison only. Don't use it in new work.
- Arvo and Iosevka (the current site's heading and code faces) are retired in favour of Lato and JetBrains Mono.

## Emphasis and highlights

- Bold = `Highlight`: an `accent` block with `on-accent` text and `space-2` side padding. At most three per paragraph.
- Categorical highlights in text (coded transcript spans, labelled terms) use tags: a `tag-N` block with `on-tag-N`, or a 3px `tag-N` underline under `ink` text.
- Italic is not used for emphasis. `<em>` renders as upright `accent-text`.
- Links: `accent-text`, weight 500, underlined.
- Lists use square bullets.

## Code

Use the `Code` component, which has three schemes over one tokenizer.

- **`ink` (default).**
  - Keywords are bold, comments italic `ink-muted`, and literals `tag-1-text`. Everything else is `ink`.
  - Use it in editors, docs and dense code. It is the brand's "ink plus one accent" applied to code.
- **`marker`.**
  - Strings sit on `marker-yellow`, numbers on `marker-cyan`, and function names are bold `tag-1-text`.
  - Use it on slides and in explanation diagrams, where highlighting means "look at this value".
- **`full`.**
  - Each token type gets a `tag-N-text`: keywords blue, strings teal, numbers orange, functions red, types pink, built-ins cyan, docstrings yellow.
  - It is optional, for short samples.

To point at a line, pass `highlight`. The line gets an `accent-tint` wash with an `accent` edge. The accent is never used for token colours.

## Layout and spacing

- Sites: one centred column at `content-width` (832px), `space-5` top and bottom, `space-3` gutters. Use `Band` for the header and, optionally, the footer.
- Rhythm: `space-2` between paragraphs, `space-4` between sections and stacked cards, `space-5` inside bands.
- Slides: white, `space-6` margins, headline top-left in `slide-title`, footer `speculative.tech` and `Jeff Tao` in `slide-label`.
- Apps: see "Apps" below.

## Borders, shadows, states

- Borders: `border-hair` for rules, `border-rule` (2px) for controls and focus, `border-heavy` (4px) for cards and figure frames, always in `ink`.
- **Accent offsets are brand moments.** `shadow-offset` (8px) sits on cards and `shadow-offset-sm` (4px) on primary buttons. On a canvas, the selected object casts one too. On hover, a card's shadow collapses to 0 and the card fills with `accent`.
- **Ink offsets mean "floating".** `shadow-float` (4px) is for menus, popovers and dragged items; `shadow-dialog` (8px) is for dialogs and sheets.
- Hover = invert: links in a band become a `paper` block with `accent-text`; secondary buttons go `ink` with `paper` text; active tools, tabs and selected chips are `ink` with `paper`.
- Focus: a 2px solid `focus` ring, at least 3:1 on paper under every accent.
- Motion: colour, background, shadow and position transitions at 0.2s ease-in-out, nothing else. An anchor target flashes `accent` once (1.5s).

## Charts and figures

- **Forthcoming:** a dedicated, quieter chart palette. Do not use tag colours for charts. Several of them on one chart clash.
- Until it exists:
  - Draw data in `ink` with greys for context.
  - Use the view's `accent` for the one series or bar the figure is about.
  - Add blue + orange only when exactly two things must be compared.
- Flat fills, no gradients, `ink` axes, labels in `small` / `slide-caption` and `ink-muted`.
- Diagrams use `border-heavy` ink strokes and square boxes. Circles only for nodes.

## Iconography

- **Sites and slides:** no general icon set.
  - Icons appear only for external profile links (GitHub, LinkedIn), using Font Awesome brand glyphs at 16px in the text colour.
  - On slides, prefer words and the ✅ / ❌ / ❓ reactions over pictograms.
- **Apps:** Lucide outline icons through `Icon`.
  - Drawn with square caps and mitred joins at 2px.
  - 16px by default, 14px in dense rows, 20px at touch density.
  - Always `currentColor`.

## Apps

Apps are the brand turned into an instrument: the same ink, paper, square edges and single accent, with the volume turned down so the person's work is loudest. Wrap an app in `.sp-app`; add `data-density="touch"` on mobile.

- **Accent means "here".** In an app the accent marks only what the person has hold of: the selection, the current item, the playhead, the focused field, the one primary action. Categories use `tag-*`; decoration uses nothing.
- **The band becomes a label.** The site's black band survives as the 28px `Panel` head and the node head. The `TopBar` is paper with a 1px `ink` rule: the band's black mass is too heavy to keep on screen all day.
- **Lines, not boxes.** Panels meet the canvas and each other with 1px `ink` lines; nested groups use `rule` hairlines and `Section` titles. No gaps between panels, no rounded cards, no blur.
- **Make the state visible.** This is where the ethos lives in tools.
  - Show live values next to the thing that produces them (row counts under a node, est. → actual).
  - Make anything continuous scrubbable (`NumberField`).
  - Let people point at things (`SelectionBox`).
- **Canvas (on trial).** The workspace behind a document uses `.sp-canvas`.
  - Set `data-canvas` on the app root to one of `grey` (A, default), `neutral` (C2), `warm` (F2), `dots` (B), `grid` (C3) or `blueprint` (D2).
  - Objects on the canvas stay `paper` with `ink` frames.
  - Working hypothesis: solid canvases for page-like documents, faint grids for spatial editors.
  - `AppSlideEditor` and `AppNodeGraph` have a Canvas menu for trying each one in context.
- **Errors** use `danger`, an icon and a sentence that names the fix ("Did you mean 'sequel'?").
- **Density.**
  - Desktop: `ui` 13/18 text, `control-md` 32px controls, `bar-h` 40px bars, `panel-w` 272px panels, `canvas` behind documents.
  - Touch: `ui-touch` 16/22, `control-touch` 44px, 56px bars, one column, primary actions in a bottom tray within thumb reach.
- **Type.**
  - `ui-title` for app and dialog names.
  - `ui-label` for panel and section titles.
  - `ui-mono` for every number, timecode, value and shortcut.
  - Documents inside an app (a slide, a page) keep their full brand type.
- Test apps in this system: `AppSlideEditor`, `AppNodeGraph`, `AppVideoCoding`, `AppVideoCodingMobile`.

## Logo

- The mark is the JT monogram (`assets/Logos/favicon_*.png`): blue "JT" in a blue square frame on white.
- It's used only as a favicon, at 16, 32 and 48px.
- Elsewhere the name is set in type: "Jeff Tao" in `display`.
