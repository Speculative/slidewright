// Browser tests may save built-in decks. Give their server private backing
// files, while Vite still serves the real application and packaged assets.
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const root = await mkdtemp(join(tmpdir(), 'slidewright-e2e-'));
for (const deck of ['v0-reference', 'uist-2026']) {
  await mkdir(join(root, 'decks', deck), { recursive: true });
  await copyFile(`decks/${deck}/deck.sw`, join(root, 'decks', deck, 'deck.sw'));
}
process.env.SLIDEWRIGHT_SOURCE_ROOT = root;
const server = await createServer({ server: { port: Number(process.argv[2]), strictPort: true } });
async function stop() { await server.close(); await rm(root, { recursive: true, force: true }); process.exit(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
await server.listen();
server.printUrls();
