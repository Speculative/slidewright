# Editor design system

Imported from `jeff-tao-design-system-v0.1.zip` (Jeff Tao, v0.1).
`SOURCE-README.md` is the supplied brand book; `SOURCE-USAGE.md` documents
its original distribution. `tokens.json` is the original token source.

`tokens.css` retains the supplied token values and bundled Lato / JetBrains
Mono fonts. CSS variables are prefixed `--sw-` to avoid changing authored
slides. Document type-style utility classes and the unused candidate IBM
Plex Sans face are omitted. `components.css` contains the app component
rules from the supplied bundle, with the same token prefix.

`Controls.tsx` ports Button, Select and Switch to the project's React module
setup. Select keeps the native field as its value and focus owner, replacing
the platform popup with a viewport-positioned, portaled listbox styled as
the supplied Menu. Arrow/Home/End navigation, type-ahead, disabled options,
Enter/Space selection, Escape cancellation and outside/Tab dismissal are
handled without moving focus away from a text-editing session. Native
change events and refs are preserved. Editor-specific
layout and control integration live in `../canvas.css`. Switches edit literal
boolean properties; expressions keep their source editor. Formatting toggles
retain `aria-pressed`, including the mixed state. Number fields retain the
editor's existing source-backed scrub behavior.

No global `.sp-app *` reset or document typography is applied to slides.
