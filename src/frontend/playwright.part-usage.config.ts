import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['pui_cangxu_part_usage_component.spec.ts'],
  outputDir: '/tmp/cangxu-part-usage-playwright',
  timeout: 30000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: 'http://localhost:5173',
    headless: true,
    reducedMotion: 'reduce'
  },
  webServer: {
    command: 'yarn dev --host 127.0.0.1 --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120000
  }
});
