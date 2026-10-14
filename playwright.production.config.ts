import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'standalone-production.spec.ts', workers: 1,
  timeout: 30000, use: { baseURL: 'http://localhost:5180', headless: true },
  webServer: { command: 'npm run preview -- --port 5180 --strictPort', url: 'http://localhost:5180', reuseExistingServer: !process.env.CI },
});
