import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { sourceSync } from './scripts/source-sync.mjs';

export default defineConfig({
  plugins: [react(), sourceSync({ root: process.env.SLIDEWRIGHT_SOURCE_ROOT ?? process.cwd() })],
  build: { rollupOptions: { input: { main: resolve(process.cwd(), 'index.html'), canvas: resolve(process.cwd(), 'canvas.html') } } },
  server: { host: true, port: 5173 },
});
