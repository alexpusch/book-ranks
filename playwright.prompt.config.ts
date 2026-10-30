import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './prompt-eval',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: './test-results/prompt-eval',
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report/prompt-eval', open: 'never' }],
  ],
  use: { baseURL: 'http://127.0.0.1:4197' },
  webServer: {
    command: 'npm run dev -- --port 4197 --strictPort',
    url: 'http://127.0.0.1:4197',
    reuseExistingServer: false,
  },
});
