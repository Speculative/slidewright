// Real canvas + VSCodeHost + native SourceSession with a controllable transport.
import '../src/styles.css';
import '../decks/uist-2026/presentation.css';
import '../slidewright/canvas/canvas.css';
import { createRoot } from 'react-dom/client';
import { App } from '../slidewright/canvas/App.js';
import { VSCodeHost } from '../extension/src/webview/vscode-host.js';
import { SourceSession } from '../extension/src/source-session.js';
import { verifyChanges, type SetSourceMessage, type SourceSnapshot, type WebviewToExtension } from '../extension/src/source-protocol.js';
import type { SourceChange } from '../slidewright/runtime/document.js';

let current: SourceSnapshot = { source: `Deck { slides: [${Array.from({ length: 100 }, (_, i) =>
  `Slide { label: "slide-${i}" content: Freeform { children: [Box { x: ${200 + i} y: 300 width: 100 height: 100 }] } }`).join('\n')}] }`,
  version: 1, fileName: 'bridge.sw', assets: {} };
const requests: SetSourceMessage[] = [];
let application: { changes: readonly SourceChange[]; baseVersion: number; resolve: (value: boolean) => void } | undefined;
const session = new SourceSession({ snapshot: () => current,
  post: data => window.dispatchEvent(new MessageEvent('message', { data })),
  apply: (changes, baseVersion) => new Promise<boolean>(resolve => { application = { changes, baseVersion, resolve }; }),
});
Object.assign(window, { acquireVsCodeApi: () => ({ postMessage: (message: WebviewToExtension) => {
  if (message.type === 'ready') session.start();
  if (message.type === 'set-source') { requests.push(message); void session.setSource(message); }
} }) });
const host = new VSCodeHost();
Object.assign(window, { bridge: {
  host, requests, source: () => current.source, initial: current.source,
  complete(accepted = true) {
    const pending = application;
    if (!pending) throw new Error('No native edit pending');
    application = undefined;
    if (accepted && pending.baseVersion === current.version) {
      let source = current.source;
      for (const change of [...pending.changes].reverse()) source = source.slice(0, change.start) + change.insert + source.slice(change.end);
      current = { ...current, source, version: current.version + 1 };
      session.update(pending.changes);
      pending.resolve(true);
    } else pending.resolve(false);
  },
  external(source: string, changes?: readonly SourceChange[]) {
    if (changes) verifyChanges(current.source, source, changes);
    current = { ...current, source, version: current.version + 1 };
    session.update(changes);
  },
} });
createRoot(document.getElementById('root')!).render(<div className="sw-standalone"><App host={host} /></div>);
