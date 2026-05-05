// Headless render smoke test. Loads the dev-server URL, captures a
// screenshot of each slide, and reports console errors.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = process.env.SLIDEWRIGHT_URL ?? 'http://localhost:5173/';
const OUT = resolve(process.cwd(), '.tmp/slidewright-smoke');
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle' });

  // Two slides: capture each via keyboard nav.
  await page.screenshot({ path: `${OUT}/slide-01.png`, fullPage: false });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/slide-02.png`, fullPage: false });

  await browser.close();

  if (errors.length > 0) {
    console.log('FAIL: runtime errors:');
    for (const e of errors) console.log('  ', e);
    process.exit(1);
  }
  console.log(`OK: rendered. screenshots in ${OUT}`);
}

main().catch((e) => {
  console.error('render smoke crashed:', e);
  process.exit(1);
});
