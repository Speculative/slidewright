import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { sourceSync } from './source-sync.mjs';

test('source endpoint checks disk revisions and restricts writes to known decks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slidewright-sync-'));
  const path = join(root, 'decks/v0-reference/deck.sw');
  await mkdir(join(root, 'decks/v0-reference'), { recursive: true });
  await writeFile(path, 'original α');
  const server = await createServer({ configFile: false, root, plugins: [sourceSync({ root })], server: { port: 5191, host: '127.0.0.1' } });
  await server.listen();
  const address = server.httpServer!.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/__slidewright/source?deck=reference`;
  const get = async () => (await fetch(endpoint)).json();
  const put = (revision: string, source: string) => fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, source }) });
  try {
    const initial = await get();
    const saved = await put(initial.revision, 'short');
    assert.equal(saved.status, 200);
    assert.equal(await readFile(path, 'utf8'), 'short');
    const current = await saved.json();
    assert.notEqual(current.revision, initial.revision);
    assert.equal((await get()).revision, current.revision);
    assert.equal((await put(initial.revision, 'stale')).status, 409);
    await writeFile(path, 'agent edit');
    assert.equal((await put(current.revision, 'overwrite')).status, 409);
    assert.equal(await readFile(path, 'utf8'), 'agent edit');
    const beforeRename = await get();
    await writeFile(`${path}.tmp`, 'atomic replacement');
    await rename(`${path}.tmp`, path);
    assert.equal((await put(beforeRename.revision, 'overwrite')).status, 409);
    assert.equal(await readFile(path, 'utf8'), 'atomic replacement');
    assert.equal((await fetch(endpoint.replace('reference', '../../README.md'), { method: 'PUT' })).status, 404);
    assert.equal((await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
    assert.equal((await put((await get()).revision, '')).status, 200);
    assert.equal(await readFile(path, 'utf8'), '');
    await rm(path);
    assert.equal((await fetch(endpoint)).status, 503);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
