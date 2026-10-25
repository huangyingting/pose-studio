import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3210);
const baseURL = process.env.BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    // Software WebGL so the suite also runs on GPU-less CI machines.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 900 } } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: `npm run build && npm run start -- -p ${PORT}`, url: baseURL, timeout: 300_000, reuseExistingServer: !process.env.CI },
});
