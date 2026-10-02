import { defineConfig, devices } from '@playwright/test';

const chromiumViewports = [
  { name: 'phone-360x740', width: 360, height: 740 },
  { name: 'tablet-portrait-768x1024', width: 768, height: 1024 },
  { name: 'tablet-portrait-820x1180', width: 820, height: 1180 },
  { name: 'tablet-landscape-1024x768', width: 1024, height: 768 },
  { name: 'tablet-landscape-1180x820', width: 1180, height: 820 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
];
const crossBrowserProjects =
  process.env.PLAYWRIGHT_CROSS_BROWSER === '1'
    ? [
        {
          name: 'webkit-phone',
          use: { ...devices['iPhone 13'], browserName: 'webkit' as const },
        },
        {
          name: 'firefox-desktop',
          use: { browserName: 'firefox' as const, viewport: { width: 1440, height: 900 } },
        },
      ]
    : [];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    ...chromiumViewports.map(({ name, ...viewport }) => ({
      name,
      use: { ...devices['Desktop Chrome'], viewport },
    })),
    ...crossBrowserProjects,
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
