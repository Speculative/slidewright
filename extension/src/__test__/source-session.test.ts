import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SourceSession } from '../source-session.js';
import { verifyChanges, type ExtensionToWebview, type SetSourceMessage, type SourceSnapshot } from '../source-protocol.js';

function authority() {
  let snapshot: SourceSnapshot = { source: 'Deck { name: "a" }', version: 1, fileName: 'deck.sw', assets: {} };
  const messages: ExtensionToWebview[] = [];
  const applied: { changes: unknown; baseVersion: number }[] = [];
  let finish: ((accepted: boolean) => void) | undefined;
  const session = new SourceSession({ snapshot: () => snapshot, post: message => messages.push(message),
    apply: async (changes, baseVersion) => {
      applied.push({ changes, baseVersion });
      return new Promise<boolean>(resolve => { finish = resolve; });
    } });
  const change = (source: string, changes?: SetSourceMessage['changes']) => {
    snapshot = { ...snapshot, source, version: snapshot.version + 1 }; session.update(changes);
  };
  session.start();
  const request = (source = snapshot.source.replace('"a"', '"longer"')): SetSourceMessage => ({
    type: 'set-source', source, requestId: 1, baseVersion: snapshot.version, origin: 'canvas',
    changes: [{ start: snapshot.source.indexOf('"a"'), end: snapshot.source.indexOf('"a"') + 3, insert: '"longer"' }],
  });
  return { session, messages, applied, change, request, finish: (accepted: boolean) => finish!(accepted) };
}

test('native authority preserves exact changes and tags its own event and result', async () => {
  const a = authority();
  const request = a.request();
  const pending = a.session.setSource(request);
  assert.deepEqual(a.applied, [{ changes: request.changes, baseVersion: 1 }]);
  a.change(request.source, request.changes);
  assert.equal((a.messages.at(-1) as any).requestId, 1);
  assert.deepEqual((a.messages.at(-1) as any).changes, request.changes);
  a.finish(true); await pending;
  assert.deepEqual(a.messages.at(-1), { type: 'source-result', source: request.source,
    fileName: 'deck.sw', assets: {}, version: 2, requestId: 1, accepted: true });
});

test('stale, malformed and overlapping requests never reach the native editor', async () => {
  const a = authority();
  await a.session.setSource({ ...a.request(), baseVersion: 0 });
  await a.session.setSource({ ...a.request(), changes: [] });
  await a.session.setSource({ ...a.request(), changes: [{ start: -1, end: 0, insert: 'bad' }] });
  assert.equal(a.applied.length, 0);
  const pending = a.session.setSource(a.request());
  await a.session.setSource({ ...a.request(), requestId: 2 });
  assert.equal(a.applied.length, 1);
  assert.equal((a.messages.at(-1) as any).accepted, false);
  a.finish(false); await pending;
  assert.equal((a.messages.at(-1) as any).accepted, false);
});

test('native races and failed edits return current authority; missed events replace', async () => {
  const a = authority();
  const pending = a.session.setSource(a.request());
  a.change('Deck { name: "external" }');
  assert.equal((a.messages.at(-1) as any).replacement, true);
  assert.equal((a.messages.at(-1) as any).requestId, undefined);
  a.finish(false); await pending;
  assert.equal((a.messages.at(-1) as any).source, 'Deck { name: "external" }');
  assert.equal((a.messages.at(-1) as any).accepted, false);
});

test('wire changes verify exact UTF-16 ranges and reject ambiguity', () => {
  const before = 'a🌍b middle c';
  verifyChanges(before, 'alongb middle last', [{ start: 1, end: 3, insert: 'long' }, { start: 12, end: 13, insert: 'last' }]);
  assert.throws(() => verifyChanges('abc', 'abc', [{ start: 1, end: 2, insert: 'b' }, { start: 1, end: 1, insert: '' }]));
});
