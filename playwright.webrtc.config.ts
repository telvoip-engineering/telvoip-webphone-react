import { defineConfig } from "@playwright/test";

const fixturePort = 4177;

export default defineConfig({
  testDir: "./tests/webrtc",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: "line",
  outputDir: "node_modules/.cache/webphone-playwright-results",
  use: {
    baseURL: `http://127.0.0.1:${fixturePort}`,
    headless: true,
  },
  projects: [
    {
      name: "chrome",
      use: {
        browserName: "chromium",
        channel: "chrome",
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        launchOptions: {
          firefoxUserPrefs: {
            "media.navigator.streams.fake": true,
            "media.navigator.permission.disabled": true,
            "media.autoplay.default": 0,
          },
        },
      },
    },
  ],
  webServer: {
    command: "node tests/webrtc/fixture-server.mjs",
    url: `http://127.0.0.1:${fixturePort}`,
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
