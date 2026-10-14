import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: resolve(process.cwd(), 'index.html'), canvas: resolve(process.cwd(), 'canvas.html') } } },
  server: { host: true, port: 5173 },
});
