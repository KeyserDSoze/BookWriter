import { defineConfig, devices } from "@playwright/test";

// Test con LM Studio reale: il progetto esiste solo se LMSTUDIO_MODEL è impostata
// (vedi e2e/support/lmstudio.ts), così CI e run normali non cambiano e non producono skip.
const liveLmStudio = process.env.LMSTUDIO_MODEL?.trim() ? [{
  name: "live-lmstudio",
  testMatch: "**/live/**/*.live.spec.ts",
  retries: 0,
  use: { ...devices["Desktop Chrome"] },
}] : [];

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", testIgnore: "**/live/**", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      testIgnore: "**/live/**",
      use: {
        browserName: "chromium", viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      },
    },
    ...liveLmStudio,
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
