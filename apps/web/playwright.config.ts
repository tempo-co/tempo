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
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', {open: 'never'}]],
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
    {
      // Every iPhone browser is WebKit. Specs that set a phone width cover iPhone layouts here.
      name: 'webkit',
      // Saved-app specs need the service worker, which this project blocks.
      testIgnore: [
        'e2e/home/offline.spec.ts',
        'e2e/auth/network-resilience.spec.ts',
        'e2e/banking/offline-retention.spec.ts',
      ],
      use: {
        ...devices['Desktop Safari'],
        // WebKit sends service-worker requests past page.route, so mocked responses would leak to the API.
        serviceWorkers: 'block',
      },
      dependencies: ['setup'],
    },
  ],
});
