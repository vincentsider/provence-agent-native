import { defineConfig, devices } from '@playwright/test';

/**
 * E2E drives WebMCP directly (spec 11.4). Chrome ships document.modelContext
 * behind chrome://flags/#enable-webmcp-testing; from the command line that is
 * the WebMCP runtime feature plus the testing flag. Tests skip gracefully
 * when the API is absent so CI without the flag still runs the human-surface
 * suite (S6).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3040',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome-webmcp',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: {
          // Verified 27 Aug 2026 on Chrome 151 stable: this feature alone
          // exposes document.modelContext (on origin-isolated pages; NOT on
          // about:blank, which is why naive probes miss it).
          args: ['--enable-features=WebMCPTesting'],
        },
      },
    },
    {
      name: 'chromium-no-webmcp',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://127.0.0.1:3040/fr',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
