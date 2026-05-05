# Slidewright VS Code extension

The VS Code half of Slidewright. Per `SLIDEWRIGHT.md / v0 sequencing`,
v0.1 ships a read-only canvas + source-panel + selection sync; v0.2+
adds gestures and round-trip emit.

## Dev workflow

Inside the Carthage container:

```sh
npm run code-server
# open http://localhost:8080 on the host
# open the /workspace folder, then F5
```

F5 reads `/workspace/.vscode/launch.json`, runs the
`build:extension` task (esbuild bundle), and launches the Extension
Development Host with this extension loaded. Press F5 again or use
"Developer: Reload Window" in the dev host after rebuilding.

For continuous rebuilding during dev:

```sh
npm run extension:watch    # in a separate tmux pane
```

## Layout

- `package.json` — VS Code manifest (`engines`, `contributes`,
  `activationEvents`, `main`).
- `src/extension.ts` — extension entry point (`activate` /
  `deactivate`).
- `esbuild.mjs` — bundler driver. Outputs `dist/extension.js` with
  `vscode` left external.
- `tsconfig.json` — TypeScript configuration scoped to this dir
  (Node CJS target, distinct from the root tsconfig which targets
  the browser/ESM path).
