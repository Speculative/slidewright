# Slide template

HTML deck framework derived from the NoSQL lecture, packaged as a Vite +
React project.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

## Layout

- `index.html` — Vite entry. Loads fonts and mounts React into `#app`.
- `src/main.jsx` — React entry; imports `deck-stage.js` and `styles.css`,
  mounts `<App />`.
- `src/App.jsx` — composes `<deck-stage>`, the deck, and the tweaks panel.
- `src/slides/Deck.jsx` — your deck content. Edit this.
- `src/slides/helpers.jsx` — `<Slide>` and `<Section>` components plus
  `ACTS`, `TOTAL`, `DECK_NAME`, `DECK_SUBTITLE`.
- `src/styles.css` — visual system: colors, typography, card/chip/code/table
  treatments. CSS variables under `:root` are the swap points.
- `src/deck-stage.js` — `<deck-stage>` web component: keyboard nav,
  auto-scaling, print stylesheet, slide persistence, `slidechange`
  events. Generic; do not edit per-deck.
- `src/TweaksPanel.jsx` — accent-color picker + speaker-notes overlay
  wiring. Posts edit-mode messages to a parent frame; harmless when run
  standalone.
- `src/speaker-notes.js` — array of speaker-note strings, one per slide.
- `src/notes-markdown.js` — minimal-markdown renderer shared between the
  in-page overlay and the popout.
- `public/notes.html` — speaker-notes popout served as a static file.
  Press **N** in the deck to open.

## Authoring a slide

```jsx
<Slide idx={N} label="...">
  <div className="eyebrow">EYEBROW</div>
  <div className="slide-title">Title.</div>
  {/* body JSX */}
</Slide>
```

Section dividers (inverted black background):

```jsx
<Section idx={N} label="..." actNum={1}
         titleLines={<>Title<br/>Lines</>}
         subtitle="Subtitle" />
```

Keep `TOTAL` and the `ACTS` ranges in sync as you add slides. Edit
`DECK_NAME` / `DECK_SUBTITLE` in `helpers.jsx` once for your deck — they
drive the breadcrumb in the chrome footer.

## Speaker notes

Edit the array in `src/speaker-notes.js`. One string per slide, in order.
Markdown subset: `**bold**`, `*italic*`, `` `code` ``, `-` / `•` bullets
with 2-space indent for nesting. Keep notes self-contained — they're
shown one at a time, so don't reference "slide 5" or "the next one".

## Keyboard

- `←` `→` / PgUp PgDn / Space — navigate
- Number keys — jump to slide
- `Home` / `End` — first / last
- `R` — reset to slide 1
- `N` — open speaker-notes popout

## Print to PDF

The deck includes a print stylesheet. Use the browser's Print → Save as
PDF; you get one page per slide at the design size.

## Style vocabulary

CSS classes you'll reach for most:

- Layout: `.cols`, `.cols-3`, `.card-grid`, `.card-grid-3`, `.stack-48`,
  `.stack-32`, `.stack-24`, `.stack-16`
- Type: `.title`, `.title-xl`, `.title-xxl`, `.slide-title`, `.eyebrow`,
  `.body`, `.body-lg`, `.small`, `.big-fig`
- Cards: `.card` plus color modifier (`.amber`, `.cyan`, `.magenta`,
  `.lime`, `.red`, `.purple`, `.inverted`)
- Misc: `.chip`, `pre.code` (+ `.dark`), `table.tbl`, `hr.rule`,
  `.accent-rule`

Accent color is `var(--accent)`. The Tweaks panel (visible only inside an
edit-mode parent frame) lets you switch it live.
