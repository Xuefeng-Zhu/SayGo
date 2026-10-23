import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CustomerMcpLogEntry,
  CustomerMcpLogSnapshot,
  View,
} from "@saygo/contracts";
import { test, expect, type Page } from "./operator-fixture";

// The first test uses actual local fixture/MCP calls and the mock kitchen.
// The remaining tests intercept only the read-only log endpoint to exercise
// presentation/reconnect cases; they are not provider or live speech tests.
const evidence =
  process.env.SAYGO_E2E_EVIDENCE_DIR ?? resolve("../screenshots");
const logRequests = (url: string) =>
  new URL(url).pathname === "/api/lane/mcp-log";
const disclosure = (page: Page) =>
  page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "MCP call log" }),
  });
const calls = (page: Page) =>
  page.getByRole("list", { name: "MCP calls, newest first" });

async function start(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/lane/lane-1");
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your order", exact: true }),
  ).toBeVisible();
}

async function view(page: Page): Promise<View> {
  const response = await page.request.get("/api/lane/state");
  expect(response.ok()).toBe(true);
  return response.json();
}

function snapshot(
  current: View,
  entries: CustomerMcpLogEntry[],
): CustomerMcpLogSnapshot {
  return {
    session_id: current.session.id,
    epoch: current.session.epoch,
    entries,
    limit: 30,
  };
}

test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
});

test("collapsed log stays idle; actual fixture correction and explicit approval produce one mock ticket, then reset for the next customer", async ({
  page,
  context,
}) => {
  let reads = 0;
  let confirmations = 0;
  page.on("request", (request) => {
    if (logRequests(request.url())) reads++;
    if (
      new URL(request.url()).pathname === "/api/lane/confirm" &&
      request.method() === "POST"
    )
      confirmations++;
  });
  await start(page);
  await expect(disclosure(page)).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Start example order" }).click();
  await expect(page.locator(".order-line")).toHaveCount(3);
  // Observe a full polling interval: a closed log must make no request.
  await page.waitForTimeout(1100);
  expect(reads).toBe(0);

  const summary = disclosure(page).locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure(page)).toHaveAttribute("open", "");
  await expect(calls(page).getByRole("listitem")).toHaveCount(2);
  await expect(
    calls(page).getByText("Test fixture", { exact: true }),
  ).toHaveCount(2);
  await expect(calls(page).getByText("Succeeded", { exact: true })).toHaveCount(
    2,
  );
  await expect(calls(page).getByLabel("Measured call duration")).toHaveCount(2);

  await page
    .getByRole("button", { name: "Apply correction", exact: true })
    .click();
  await expect(calls(page).getByRole("listitem")).toHaveCount(4);
  await expect(calls(page)).toContainText("Update 2 items");
  await expect(
    page.getByText("No onions · No cheese", { exact: true }),
  ).toBeVisible();
  expect((await view(page)).order).toBeNull();
  expect(confirmations).toBe(0);

  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(calls(page).getByRole("listitem")).toHaveCount(5);
  const reviewCall = calls(page)
    .getByRole("listitem")
    .filter({
      has: page.getByText("prepare_order_review", { exact: true }),
    });
  await expect(reviewCall).toContainText("Screen");
  await expect(reviewCall).toContainText("customer approval required");
  const reviewed = await view(page);
  expect(reviewed.quote?.approved).toBe(false);
  expect(reviewed.order).toBeNull();
  expect(confirmations).toBe(0);

  await page
    .getByRole("button", { name: "Confirm order", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your order is in." }),
  ).toBeVisible({
    timeout: 15000,
  });
  await expect(calls(page).getByRole("listitem")).toHaveCount(6);
  const submitCall = calls(page)
    .getByRole("listitem")
    .filter({
      has: page.getByText("submit_order", { exact: true }),
    });
  await expect(submitCall).toContainText("Screen");
  await expect(submitCall).toContainText("Succeeded");
  expect(confirmations).toBe(1);
  const accepted = await view(page);
  expect(accepted.order?.status).toBe("accepted");
  expect(accepted.order?.snapshot.totals.total).toBe(1809);
  const kitchen = await context.newPage();
  await kitchen.goto("/kitchen");
  const ticket = kitchen.locator(".ticket").filter({
    has: kitchen.getByRole("heading", {
      name: `#${String(accepted.order!.number).padStart(3, "0")}`,
      exact: true,
    }),
  });
  await expect(ticket).toHaveCount(1);
  await expect(ticket).toContainText("No onions · No cheese");
  await expect(ticket).toContainText("Large");
  const kitchenResponse = await page.request.get("/api/kitchen");
  expect(kitchenResponse.ok()).toBe(true);
  const kitchenData = (await kitchenResponse.json()) as {
    orders: Pick<NonNullable<View["order"]>, "id" | "snapshot">[];
  };
  const matchingTickets = kitchenData.orders.filter(
    ({ id }) => id === accepted.order!.id,
  );
  expect(matchingTickets).toHaveLength(1);
  expect(matchingTickets[0].snapshot).toEqual(accepted.order!.snapshot);
  await kitchen.close();

  await calls(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${evidence}/mcp-log-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await calls(page).scrollIntoViewIfNeeded();
  await calls(page).focus();
  await expect(calls(page)).toBeFocused();
  await page.keyboard.press("End");
  expect(
    await calls(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await calls(page).evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: `${evidence}/mcp-log-mobile.png`,
    fullPage: true,
  });

  await summary.click();
  await expect(disclosure(page)).not.toHaveAttribute("open", "");
  const closedReads = reads;
  await page.waitForTimeout(1100);
  expect(reads).toBe(closedReads);
  await page.getByText("Operator controls", { exact: true }).click();
  await page
    .getByRole("button", { name: "Vehicle departed", exact: true })
    .click();
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your order", exact: true }),
  ).toBeVisible();
  expect((await view(page)).session.id).not.toBe(accepted.session.id);
  await expect(disclosure(page)).not.toHaveAttribute("open", "");
  await expect(calls(page)).toHaveCount(0);
  await disclosure(page).locator("summary").click();
  await expect(disclosure(page).getByRole("status")).toHaveText(
    "No MCP calls yet.",
  );
  await expect(calls(page)).toHaveCount(0);
  expect(confirmations).toBe(1);
});

test("intercepted read snapshots show pending and unknown honestly, deduplicate IDs, suppress raw errors and recover without product writes", async ({
  page,
}) => {
  await start(page);
  const current = await view(page);
  const id = randomUUID();
  const pending: CustomerMcpLogEntry = {
    id,
    tool: "get_cart",
    source: "voice",
    status: "pending",
    input_summary: "Read current draft",
  };
  let body = snapshot(current, [pending]);
  let fail = false;
  let reads = 0;
  let productWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/api/lane/")
    )
      productWrites++;
  });
  await page.route("**/api/lane/mcp-log", async (route) => {
    reads++;
    await route.fulfill(
      fail
        ? {
            status: 500,
            json: { error: "PRIVATE_BACKEND_STACK_TOKEN_must_not_render" },
          }
        : { json: body },
    );
  });
  await disclosure(page).locator("summary").click();
  await expect(calls(page).getByText("Pending", { exact: true })).toBeVisible();
  await expect(calls(page).getByText("Voice", { exact: true })).toBeVisible();
  await expect(calls(page).getByLabel("Measured call duration")).toHaveCount(0);

  const unknown: CustomerMcpLogEntry = {
    ...pending,
    status: "unknown",
    result_summary:
      "Result not confirmed; do not repeat a consequential action",
  };
  // Duplicate IDs are intentional fixtures, representing a reconnect replay.
  body = snapshot(current, [unknown, unknown]);
  await expect(
    calls(page).getByText("Result not confirmed", { exact: true }),
  ).toBeVisible();
  await expect(calls(page).getByRole("listitem")).toHaveCount(1);
  await expect(calls(page).getByText("Failed", { exact: true })).toHaveCount(0);
  fail = true;
  await expect(disclosure(page).getByRole("status")).toHaveText(
    "Call history is temporarily unavailable. Reconnecting…",
  );
  await expect(
    page.getByText("PRIVATE_BACKEND_STACK_TOKEN_must_not_render"),
  ).toHaveCount(0);
  await expect(calls(page).getByRole("listitem")).toHaveCount(1);

  const succeeded: CustomerMcpLogEntry = {
    ...pending,
    source: "mcp",
    status: "succeeded",
    duration_ms: 1250,
    result_summary: "0 items · $0.00",
  };
  body = snapshot(current, [succeeded, succeeded]);
  fail = false;
  await expect(disclosure(page).getByRole("status")).toHaveText(
    "1 recent call.",
  );
  await expect(calls(page).getByRole("listitem")).toHaveCount(1);
  await expect(
    calls(page).getByText("Succeeded", { exact: true }),
  ).toBeVisible();
  await expect(calls(page).getByLabel("Measured call duration")).toHaveText(
    "1.3 s",
  );
  await expect(
    calls(page).getByText("MCP client", { exact: true }),
  ).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(4);
  expect(productWrites).toBe(0);
  expect((await view(page)).order).toBeNull();
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toHaveCount(0);
});

test("intercepted stale session or epoch snapshots never expose their entries and current-scope recovery succeeds", async ({
  page,
}) => {
  await start(page);
  const current = await view(page);
  const entry: CustomerMcpLogEntry = {
    id: randomUUID(),
    tool: "get_cart",
    source: "screen",
    status: "succeeded",
    input_summary: "OTHER_CUSTOMER_ENTRY_must_not_render",
  };
  let body: CustomerMcpLogSnapshot = {
    ...snapshot(current, [entry]),
    session_id: randomUUID(),
  };
  await page.route("**/api/lane/mcp-log", (route) =>
    route.fulfill({ json: body }),
  );
  await disclosure(page).locator("summary").click();
  await expect(disclosure(page).getByRole("status")).toHaveText(
    "Call history is temporarily unavailable. Reconnecting…",
  );
  await expect(calls(page)).toHaveCount(0);
  await expect(page.getByText(entry.input_summary)).toHaveCount(0);

  body = snapshot(current, [{ ...entry, input_summary: "Read current draft" }]);
  await expect(calls(page)).toContainText("Read current draft");
  body = { ...snapshot(current, [entry]), epoch: current.session.epoch + 1 };
  await expect(disclosure(page).getByRole("status")).toHaveText(
    "Call history is temporarily unavailable. Reconnecting…",
  );
  await expect(calls(page)).toHaveCount(0);
  await expect(page.getByText(entry.input_summary)).toHaveCount(0);
  body = snapshot(current, []);
  await expect(disclosure(page).getByRole("status")).toHaveText(
    "No MCP calls yet.",
  );
  expect((await view(page)).order).toBeNull();
});
