// Sweep N for the per-frame-setState perf test. Loads /perf.html
// at several N values, waits for each run to complete, prints
// the resulting frame-time stats. No hard assertions — the test
// is exploratory ("what's the FPS at this many shapes?"), not
// regression-detecting (FPS depends heavily on hardware).
//
// Read the console output to decide whether the React-native
// gesture refactor is performance-viable for slide-scale shape
// counts. Rule of thumb: avg frame time below ~16ms = solid 60fps.

import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface PerfStats {
  n: number;
  frames: number;
  totalMs: number;
  avgFrameMs: number;
  p95FrameMs: number;
  fps: number;
  done: boolean;
}

async function runPerfAt(page: Page, n: number, frames = 300): Promise<PerfStats> {
  await page.goto(`/perf.html?n=${n}&frames=${frames}`);
  // Wait for the perf-stats panel to flip from 'pending' to 'done'.
  await page.locator('[data-perf-stats="done"]').waitFor({ timeout: 30_000 });
  return page.evaluate(() => {
    const stats = (window as unknown as { __perfStats?: PerfStats }).__perfStats;
    if (!stats) throw new Error('__perfStats global not set');
    return stats;
  });
}

// @perf — opt-in via `npm run test:perf`. Excluded from the
// default `npm run test:e2e` because each sweep takes ~30s and
// performance numbers depend on hardware.
test('@perf per-frame setState scaling sweep', async ({ page }) => {
  test.setTimeout(120_000);
  const ns = [50, 200, 500, 1000, 2000, 5000];
  const results: PerfStats[] = [];
  for (const n of ns) {
    const stats = await runPerfAt(page, n);
    results.push(stats);
  }
  // Pretty-print results to the test output. Grep `PERF` in the
  // run log to recover.
  console.log('\nPERF: per-frame setState scaling (chromium, 1 worker)');
  console.log(
    'PERF:   N    avg ms     p95 ms     fps',
  );
  for (const r of results) {
    console.log(
      `PERF:   ${String(r.n).padStart(3)}  ${r.avgFrameMs.toFixed(2).padStart(6)}     ${r.p95FrameMs.toFixed(2).padStart(6)}     ${r.fps.toFixed(1).padStart(5)}`,
    );
  }
});
