import { defineConfig } from "@playwright/test";
const qaPort = process.env.SAYGO_QA_WEB_PORT;
const runtimePort = process.env.SAYGO_RUNTIME_PORT;
for (const port of [qaPort, runtimePort])
  if (port && (!/^\d+$/.test(port) || +port < 1024 || +port > 65535))
    throw new Error("QA ports must be numeric non-privileged ports.");
if (qaPort && (!runtimePort || qaPort === runtimePort))
  throw new Error("Isolated browser QA requires a separate runtime port.");
const origin = `http://localhost:${qaPort || 3100}`;
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: origin,
    launchOptions: { args: ["--mute-audio", "--use-fake-device-for-media-stream"] },
    viewport: { width: 1536, height: 1024 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: qaPort
      ? `pnpm exec concurrently -k 'pnpm --filter @saygo/web exec next dev --hostname 127.0.0.1 --port ${qaPort}' 'tsx apps/runtime/src/index.ts' 'tsx apps/worker/src/index.ts'`
      : "pnpm dev",
    env: { SAYGO_WEB_ORIGIN: origin },
    url: origin,
    reuseExistingServer: !qaPort && !process.env.CI,
    timeout: 60000,
  },
});
