# Using this design system outside Claude

Version 0.1 (with the canvas trial). Read `README.md` first: it is the brand book and the usage rules.

## Files

- `tokens.json`: every colour, type style, spacing, radius, shadow and size token, with usage notes. Light and dark values per colour.
- `tokens.css`: the same tokens as CSS custom properties (`--ink`, `--accent`, `--tag-1` …), one class per type style (`.h1`, `.ui-mono` …), and `@font-face` rules pointing at `fonts/`.
- `fonts/`: Lato, JetBrains Mono and IBM Plex Sans (candidate) as woff2. All SIL Open Font License.
- `components/bundle.css`: component styles (`.sp-*` classes). Uses only the token variables.
- `components/bundle.js`: React 18 components on `window.Speculative` (Button, Card, Highlight, Band, Code, Panel, NumberField, Chip …). Expects `window.React` and `window.ReactDOM`.
- `components/index.d.ts`: prop types for every component.
- `components/<Name>/README.md` and `preview.html`: guidelines and a live example per component; `App*` folders are the four test apps.
- `assets/Logos/`: the JT favicon at 16, 32 and 48px.

## Plain HTML/CSS (no React)

```html
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="components/bundle.css">
<body class="sp-prose" data-accent="blue">  <!-- or red | orange | purple -->
  <p><strong>Hi, I'm Jeff!</strong> <a href="#">Read the paper</a></p>
  <a class="sp-card" href="#"><p class="sp-card-title">GREMLIN</p></a>
  <button class="sp-btn sp-btn-primary">Run</button>
</body>
```

Dark mode: set `data-theme="dark"` on `<html>`.

App canvas (on trial): give the workspace element the `sp-canvas` class and set `data-canvas="grey|neutral|warm|dots|grid|blueprint"` on it or the app root. Default is `grey`.

## React (script tags)

```html
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="components/bundle.css">
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="components/bundle.js"></script>
<script>
  const S = window.Speculative, h = React.createElement;
  ReactDOM.createRoot(document.getElementById('root')).render(
    h('div', { className: 'sp-app' }, h(S.Button, { variant: 'primary', size: 'sm' }, 'Run'))
  );
</script>
```

## Previews

The `preview.html` files assume the design-system page injects the stylesheets, React and the bundle. To open one directly, add the five tags above to its `<head>`.

Lucide icons inside `bundle.js` are ISC-licensed.
