// Playwright config for end-to-end gesture tests.
//
// Tests drive the standalone canvas in a real browser, perform mouse
// gestures (drag, resize, etc.), and assert on the resulting DSL
// source visible in the editor pane. The fixture-loading mechanism
// (URL ?fixture=name → tests/fixtures/name.sw) is implemented in
// src/standalone-host.ts.
//
// Port choice: 5175 to avoid stepping on the dev server (5173/5174).
// `--strictPort` makes Vite refuse to fall back to a random port,
// which would otherwise diverge from `use.baseURL` and break the run.

import { defineConfig } from '@playwright/test';

const PORT = 5175;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // workers: 1 — Vite's dev server is single-threaded and tested at
  // 4-up-parallel saturated it (page.goto timeouts as the second
  // worker waits behind the first's fixture compile). The whole
  // suite is ~5s sequentially so the lost parallelism doesn't
  // matter; revisit if the suite grows past ~30s.
  workers: 1,
  reporter: 'list',
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    // Trace on retry: cheap to enable, invaluable for diagnosing
    // gesture flakes (records DOM, network, screenshots, video).
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
