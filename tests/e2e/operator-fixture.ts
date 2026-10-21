import { test as base, expect, type BrowserContext } from "@playwright/test";

type OperatorState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type WriteWindow = { file: string; completedAt: number };

// Keep authentication in memory. Each test still gets a fresh browser context
// and lane cookie, without repeatedly exercising the production sign-in limit.
export const test = base.extend<
  { respectWriteWindow: void },
  { operatorState: OperatorState; writeWindow: WriteWindow }
>({
  writeWindow: [
    // Playwright requires destructured fixture dependencies, even when empty.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => use({ file: "", completedAt: 0 }),
    { scope: "worker" },
  ],
  respectWriteWindow: [
    async ({ writeWindow }, use, testInfo) => {
      if (writeWindow.file !== testInfo.file) {
        // A spec's fast fixture/MCP calls can use most of the real write limit.
        // Begin each new spec in a fresh minute; never retry or bypass a write.
        const wait = Math.max(
          0,
          60000 - (Date.now() - writeWindow.completedAt),
        );
        if (writeWindow.file && wait > 0) {
          console.info(
            `Waiting ${Math.ceil(wait / 1000)}s for the local write-rate window before the next spec.`,
          );
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        writeWindow.file = testInfo.file;
      }
      try {
        await use();
      } finally {
        writeWindow.completedAt = Date.now();
      }
    },
    { auto: true, timeout: 65000 },
  ],
  operatorState: [
    async ({ browser }, use, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL;
      const context = await browser.newContext({ baseURL });
      let state: OperatorState;
      try {
        const page = await context.newPage();
        await page.goto("/lane/lane-1");
        await page
          .getByLabel("Password", { exact: true })
          .fill("harbor-demo-only");
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Begin customer session" }),
        ).toBeVisible();
        state = await context.storageState();
      } finally {
        await context.close();
      }
      await use(state);
    },
    { scope: "worker" },
  ],
  storageState: async ({ operatorState }, use) => use(operatorState),
});

export { expect };
export type { Page, WebSocketRoute } from "@playwright/test";
