import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3210);
const baseURL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const MOCK_AI = 3299;

/*
 * Tests run against the server edition (a superset of the static one): a fresh SQLite database,
 * the password-less test sign-in and a mock of the upstream AI (tests/e2e/mock-ai.mjs).
 */
const serverEnv = {
  DATABASE_URL: 'file:./data/e2e.db',
  NEXTAUTH_URL: baseURL,
  NEXTAUTH_SECRET: 'e2e-secret',
  AUTH_TEST_LOGIN: '1',
  GOOGLE_CLIENT_ID: '',
  AZURE_AD_CLIENT_ID: '',
  AZURE_OPENAI_ENDPOINT: '',
  OPENAI_API_KEY: 'test',
  OPENAI_MODEL: 'mock',
  OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_AI}/v1`,
  AI_DAILY_LIMIT: '1000',
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One browser at a time (each shares the server's database); tests are spread over CI's shards one by one.
  fullyParallel: true,
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
    // (A laptop's size: the canvas is drawn in software, and fewer pixels draw faster.)
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : [
        { command: `node tests/e2e/mock-ai.mjs`, url: `http://127.0.0.1:${MOCK_AI}/health`, reuseExistingServer: !process.env.CI, env: { MOCK_AI_PORT: String(MOCK_AI) } },
        {
          command: `rm -f data/e2e.db* && node scripts/migrate.mjs && npm run build && npm run start -- -p ${PORT}`,
          url: baseURL,
          timeout: 300_000,
          reuseExistingServer: !process.env.CI,
          env: serverEnv,
        },
      ],
});
