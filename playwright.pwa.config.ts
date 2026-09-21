import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/pwa',
  outputDir: 'playwright-report/pwa-results',
  forbidOnly: Boolean(process.env.CI),
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', launchOptions: process.env.COMMAND_CHROMIUM_PATH ? { executablePath: process.env.COMMAND_CHROMIUM_PATH } : {} },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173', reuseExistingServer: false,
    env: { CONTEXT: 'dev', VITE_SUPABASE_URL: 'https://command-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test_key', VITE_APP_ORIGIN: 'http://127.0.0.1:4173' },
  },
})
