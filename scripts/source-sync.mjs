import { createHash } from 'node:crypto';
import { closeSync, fstatSync, ftruncateSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';

const files = { reference: 'decks/v0-reference/deck.sw', 'uist-2026': 'decks/uist-2026/deck.sw' };
const MAX_BODY = 5 * 1024 * 1024;

function snapshot(fd) {
  const stat = fstatSync(fd, { bigint: true });
  const source = readFileSync(fd, 'utf8');
  const revision = createHash('sha256').update(`${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:`).update(source).digest('hex');
  return { source, revision };
}

// Dev-server only. The static build continues to use browser drafts.
export function sourceSync({ root = process.cwd() } = {}) {
  return {
    name: 'slidewright-source-sync',
    handleHotUpdate(context) {
      // The host checks disk revisions itself. Raw-module HMR would silently
      // replace an unsaved draft (and could echo our own saves back as edits).
      if (Object.values(files).some(file => context.file === resolve(root, file))) return [];
    },
    configureServer(server) {
      server.middlewares.use('/__slidewright/source', async (request, response) => {
        const send = (status, body) => {
          response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify(body));
        };
        const choice = new URL(request.url, 'http://localhost').searchParams.get('deck');
        if (!Object.hasOwn(files, choice)) return send(404, { error: 'Unknown deck' });
        if (!['GET', 'PUT'].includes(request.method)) return send(405, { error: 'Use GET or PUT' });
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}` && request.headers.origin !== `https://${request.headers.host}`) return send(403, { error: 'Cross-origin writes are not allowed' });
        let edit;
        if (request.method === 'PUT') {
          if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Expected JSON' });
          try {
            const chunks = [];
            let size = 0;
            for await (const chunk of request) {
              size += chunk.length;
              if (size > MAX_BODY) return send(413, { error: 'Source is too large' });
              chunks.push(chunk);
            }
            edit = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (typeof edit?.source !== 'string' || typeof edit?.revision !== 'string') return send(400, { error: 'Expected source and revision' });
          } catch { return send(400, { error: 'Invalid JSON' }); }
        }
        let fd;
        try {
          const path = resolve(root, files[choice]);
          fd = openSync(path, edit ? 'r+' : 'r');
          const current = snapshot(fd);
          if (!edit) return send(200, current);
          if (edit.revision !== current.revision) return send(409, { error: 'Source file changed', ...current });
          // Keep compare/write synchronous and serialize requests in this process.
          // Use the checked inode, so an external atomic replacement cannot be
          // overwritten by a later rename from this server. Uncooperative in-place
          // writers can still race these OS calls; filesystems offer no file CAS.
          const opened = fstatSync(fd, { bigint: true });
          const named = statSync(path, { bigint: true });
          if (opened.ino !== named.ino || opened.dev !== named.dev) return send(409, { error: 'Source file changed' });
          const bytes = Buffer.from(edit.source, 'utf8');
          let offset = 0;
          while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset, offset);
          ftruncateSync(fd, bytes.length);
          // Read from the start: readFileSync(fd) above advanced the descriptor.
          // The content is known; only the metadata must be refreshed.
          const stat = fstatSync(fd, { bigint: true });
          const revision = createHash('sha256').update(`${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:`).update(edit.source).digest('hex');
          return send(200, { source: edit.source, revision });
        } catch { return send(503, { error: 'Could not access the source file' }); }
        finally { if (fd !== undefined) closeSync(fd); }
      });
    },
  };
}
