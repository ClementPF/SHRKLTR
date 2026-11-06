import { defineConfig, devices } from '@playwright/test';
import { CONTROL_URL, WEB_URL } from './apps/backend/e2e/environment.js';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // Tests reset one dedicated database; never parallelize against it.
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: WEB_URL,
    ...devices['Desktop Chrome'],
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run e2e:serve',
    url: `${CONTROL_URL}/ready`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
