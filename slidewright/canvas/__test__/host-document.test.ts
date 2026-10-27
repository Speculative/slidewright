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
    let version = 0;
    const send = (source: string, fileName = 'deck.sw', assets = {}) => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'source-updated', source, fileName, assets, version: ++version, baseVersion: version - 1 },
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

function bridge() {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldAPI = Object.getOwnPropertyDescriptor(globalThis, 'acquireVsCodeApi');
  const window = new EventTarget();
  const posts: any[] = [];
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  Object.defineProperty(globalThis, 'acquireVsCodeApi', { value: () => ({ postMessage: (message: unknown) => posts.push(message) }), configurable: true });
  const host = new VSCodeHost();
  const received: HostState[] = [];
  host.subscribe(state => received.push(state));
  const send = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));
  return { host, posts, received, send, close() {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (oldAPI) Object.defineProperty(globalThis, 'acquireVsCodeApi', oldAPI); else Reflect.deleteProperty(globalThis, 'acquireVsCodeApi');
  } };
}
const native = (source: string, version: number) => ({ source, version, fileName: 'deck.sw', assets: {} });

test('local edits, undo and redo serialize against native versions without echo history barriers', () => {
  const b = bridge();
  try {
    const original = 'Deck { slides: [Slide { label: "a" } Slide { label: "later" }] }';
    b.send({ type: 'source-updated', ...native(original, 10) });
    const doc = b.host.document!;
    const later = doc.snapshot.occurrences.filter(o => o.component.name === 'Slide')[1]!.handle;
    const first = original.replace('"a"', '"a longer first"');
    const changes = [{ start: original.indexOf('"a"') + 1, end: original.indexOf('"a"') + 2, insert: 'a longer first' }];
    b.host.setSource(first, { baseRevision: 0, changes, origin: 'canvas' });
    assert.equal(doc.snapshot.source, first);
    const request = b.posts.at(-1)!;
    assert.equal(request.baseVersion, 10);
    assert.deepEqual(request.changes, changes);
    b.host.setSource(original, { baseRevision: 1, origin: 'canvas-undo' });
    b.host.setSource(first, { baseRevision: 2, origin: 'canvas-redo' });
    assert.equal(b.posts.filter(m => m.type === 'set-source').length, 1);
    assert.equal(b.received.length, 4);
    const acknowledge = (request: any, version: number) => {
      b.send({ type: 'source-updated', ...native(request.source, version), requestId: request.requestId });
      b.send({ type: 'source-result', ...native(request.source, version), requestId: request.requestId, accepted: true });
    };
    acknowledge(request, 11);
    assert.equal(doc.snapshot.source, first); // Never echo an earlier queued source.
    const undo = b.posts.at(-1)!;
    assert.equal(undo.baseVersion, 11);
    assert.equal(undo.origin, 'canvas-undo');
    acknowledge(undo, 12);
    const redo = b.posts.at(-1)!;
    assert.equal(redo.baseVersion, 12);
    assert.equal(redo.origin, 'canvas-redo');
    acknowledge(redo, 13);
    assert.equal(b.received.length, 4);
    assert.equal(doc.snapshot.revision, 3);
    assert.ok(doc.occurrence(later));
    // Delayed native echoes, readiness resends and old results are inert.
    acknowledge(request, 11);
    b.send({ type: 'source-updated', ...native(first, 13) });
    assert.equal(b.received.length, 4);
    assert.throws(() => b.host.setSource(original, { baseRevision: 0 }), /Stale/);
    assert.equal(b.posts.filter(m => m.type === 'set-source').length, 3);
  } finally { b.close(); }
});

test('external edits and rejected requests discard queued source and form explicit history barriers', () => {
  for (const rejected of [false, true]) {
    const b = bridge();
    try {
      const original = 'Deck { slides: [Slide { label: "original" }] }';
      b.send({ type: 'source-updated', ...native(original, 1) });
      b.host.setSource(original + ' ', { origin: 'canvas' });
      const request = b.posts.at(-1)!;
      b.host.setSource(original + '  ', { origin: 'canvas' });
      const external = original.replace('original', 'external');
      b.send({ type: rejected ? 'source-result' : 'source-updated', ...native(external, 2),
        accepted: false, requestId: rejected ? request.requestId : undefined,
        baseVersion: 1, changes: [{ start: original.indexOf('original'), end: original.indexOf('original') + 8, insert: 'external' }] });
      assert.equal(b.host.document!.snapshot.source, external);
      assert.equal(b.received.at(-1)!.documentUpdate!.replacement, true);
      b.send({ type: 'source-result', ...native(request.source, 1), requestId: request.requestId, accepted: true });
      assert.equal(b.host.document!.snapshot.source, external);
      assert.equal(b.posts.filter(m => m.type === 'set-source').length, 1);
      b.host.setSource(external + '\n', { origin: 'canvas' });
      assert.equal(b.posts.at(-1)!.baseVersion, 2);
    } finally { b.close(); }
  }
});

test('precise external ranges retain middle identities; bad ranges and missed versions replace safely', () => {
  const b = bridge();
  try {
    const original = 'Deck { name: "first" slides: [Slide { label: "middle" }] subtitle: "last" }';
    b.send({ type: 'source-updated', ...native(original, 1) });
    const doc = b.host.document!;
    const middle = doc.snapshot.occurrences.find(o => o.component.name === 'Slide')!.handle;
    const next = original.replace('first', 'longer first').replace('last', 'longer last');
    const changes = ['first', 'last'].map(t => ({ start: original.indexOf(t), end: original.indexOf(t) + t.length, insert: 'longer ' + t }));
    b.send({ type: 'source-updated', ...native(next, 2), baseVersion: 1, changes });
    assert.deepEqual(b.received.at(-1)!.documentUpdate!.changes, changes);
    assert.ok(doc.occurrence(middle));
    b.send({ type: 'source-updated', ...native(next + ' ', 3), baseVersion: 2, changes });
    assert.equal(b.received.at(-1)!.documentUpdate!.replacement, true);
    assert.equal(doc.occurrence(middle), undefined);
    b.send({ type: 'source-updated', ...native(next, 5), baseVersion: 4, changes: [] });
    assert.equal(doc.snapshot.source, next);
    assert.equal(b.received.at(-1)!.documentUpdate!.replacement, true);
  } finally { b.close(); }
});

test('selection waits for confirmed source and native cursor offsets require its version', () => {
  const b = bridge();
  try {
    const original = 'Deck { name: "first" slides: [Slide {}] }';
    b.send({ type: 'source-updated', ...native(original, 1) });
    const cursors: number[] = [];
    b.host.onCursorChange(offset => cursors.push(offset));
    b.host.setSource(original.replace('first', 'longer first'));
    const request = b.posts.at(-1)!;
    const span = { start: b.host.document!.snapshot.source.indexOf('Slide'), end: b.host.document!.snapshot.source.indexOf('Slide') + 8 };
    b.host.sendSelection(span);
    b.send({ type: 'cursor-changed', offset: 0, version: 1 });
    assert.deepEqual(cursors, []);
    assert.equal(b.posts.filter(m => m.type === 'select-source-range').length, 0);
    b.send({ type: 'source-result', ...native(request.source, 2), requestId: request.requestId, accepted: true });
    assert.deepEqual(b.posts.at(-1), { type: 'select-source-range', ...span, version: 2 });
    b.send({ type: 'cursor-changed', offset: 0, version: 1 });
    b.send({ type: 'cursor-changed', offset: span.start, version: 2 });
    assert.deepEqual(cursors, [span.start]);
  } finally { b.close(); }
});
