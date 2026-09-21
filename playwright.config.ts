import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.COMMAND_CHROMIUM_PATH ? { executablePath: process.env.COMMAND_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --mode test',
    url: 'http://127.0.0.1:5173', reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://command-test.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test_key',
      VITE_APP_ORIGIN: 'http://127.0.0.1:5173',
    },
  },
})
