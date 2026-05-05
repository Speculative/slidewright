// Slidewright canvas — VS Code webview entry.
//
// Thin: instantiates the VSCodeHost adapter and mounts the
// host-agnostic App from slidewright/canvas/. All canvas UI logic
// lives there; this file just wires the host to React's root.

import { createRoot } from 'react-dom/client';
import { App } from '../../../slidewright/canvas/App.js';
import { VSCodeHost } from './vscode-host.js';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Slidewright canvas: #root not found.');
}
createRoot(rootEl).render(<App host={new VSCodeHost()} />);
