import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VSCodeHost } from '../../../extension/src/webview/vscode-host.js';
import type { HostState } from '../host.js';

test('VS Code source messages share one revisioned document and late subscribers receive its current state', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldAPI = Object.getOwnPropertyDescriptor(globalThis, 'acquireVsCodeApi');
  const window = new EventTarget();
  const posts: unknown[] = [];
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  Object.defineProperty(globalThis, 'acquireVsCodeApi', { value: () => ({ postMessage: (message: unknown) => posts.push(message) }), configurable: true });
  try {
    const host = new VSCodeHost();
    const received: HostState[] = [];
    host.subscribe(state => {
      assert.equal(host.document!.snapshot.source, state.source);
      received.push(state);
    });
    assert.deepEqual(posts, [{ type: 'ready' }]);
    const source = 'Deck { slides: [Slide { label: "first" } Slide { label: "later" }] }';
    const send = (source: string, fileName = 'deck.sw', assets = {}) => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'source-updated', source, fileName, assets },
    }));
    send(source);
    const document = host.document!;
    const later = document.snapshot.occurrences.filter(o => o.component.name === 'Slide')[1]!.handle;
    send(source.replace('first', 'a longer first slide'));
    assert.equal(host.document, document);
    assert.equal(document.snapshot.revision, 1);
    assert.ok(document.occurrence(later));
    assert.equal(received[1]!.documentUpdate!.before.revision, 0);
    let late: HostState | undefined;
    host.subscribe(state => { late = state; });
    assert.equal(late!.source, document.snapshot.source);
    assert.equal(late!.documentUpdate, undefined);
    send(document.snapshot.source, 'deck.sw', { image: 'changed-url.png' });
    assert.equal(document.snapshot.revision, 1);
    assert.equal(received[2]!.documentUpdate, undefined);
    send(document.snapshot.source, 'other.sw');
    assert.equal(document.snapshot.revision, 2);
    assert.equal(document.occurrence(later), undefined);
    assert.equal(received[3]!.documentUpdate!.replacement, true);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldAPI) Object.defineProperty(globalThis, 'acquireVsCodeApi', oldAPI);
    else Reflect.deleteProperty(globalThis, 'acquireVsCodeApi');
  }
});
