import {defineConfig, devices} from '@playwright/test';
import {loadEnv} from 'vite';

const env = loadEnv('development', process.cwd(), '');

export default defineConfig({
  webServer: {
    command: 'npm run build && npm run preview',
    url: env.VITE_APP_URL,
    reuseExistingServer: !process.env.CI,
  },
  testDir: './test',
  timeout: 10000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? '50%' : undefined,
  reporter: [['list'], ['html']],
  use: {
    baseURL: env.VITE_APP_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: 'auth.setup.ts',
    },
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
      dependencies: ['setup'],
    },
  ],
});
