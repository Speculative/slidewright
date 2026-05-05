/// <reference types="vite/client" />

// Vite's client types declare:
//   - `import.meta.hot` for HMR
//   - CSS / asset module imports (.css side-effects, .jpg → URL string,
//     etc.)
//   - `?raw`, `?url`, `?worker` query suffixes
//
// We pull them in once here; the root tsconfig's `include` covers
// slidewright/, src/, and decks/, so the ambient declarations are
// visible everywhere they're needed.
