import { test, expect, type Page } from "./operator-fixture";
import { mkdir, writeFile } from "node:fs/promises";
const evidence = process.env.SAYGO_E2E_EVIDENCE_DIR ?? "docs/evidence";
async function start(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/lane/lane-1");
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your order", exact: true }),
  ).toBeVisible();
}
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
});
test("correct order, explicit review, accepted ticket, reload and next vehicle", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const startMs = performance.now();
  const firstResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/lane/fixture") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start example order" }).click();
  await expect(page.locator(".order-line")).toHaveCount(3);
  const cartMs = Math.round(performance.now() - startMs);
  const firstResult = await (await firstResponse).json();
  expect(firstResult.timing.tool_ms).toBeGreaterThanOrEqual(0);
  await page.getByRole("button", { name: "Apply correction" }).click();
  await expect(
    page.getByText("No onions · No cheese", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".grand-total")).toContainText("$18.09");
  await page.reload();
  await expect(page.locator(".order-line")).toHaveCount(3);
  await page.screenshot({
    path: `${evidence}/order-board.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your order" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toHaveCSS("opacity", "1");
  await page.screenshot({ path: `${evidence}/review.png`, fullPage: true });
  const submitMs = performance.now();
  await page
    .getByRole("button", { name: "Confirm order", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your order is in." }),
  ).toBeVisible({ timeout: 15000 });
  const ackMs = Math.round(performance.now() - submitMs);
  const orderText = await page.locator(".board-title p").innerText();
  const number = orderText.match(/#(\d+)/)![1];
  const kitchen = await context.newPage();
  await kitchen.goto("/kitchen");
  const ticket = kitchen.locator(".ticket").filter({
    has: kitchen.getByRole("heading", { name: `#${number}`, exact: true }),
  });
  await expect(ticket).toContainText("No onions · No cheese");
  await expect(ticket).toContainText("Large");
  await kitchen.screenshot({ path: `${evidence}/kitchen.png`, fullPage: true });
  await ticket.getByRole("button", { name: "Start preparing" }).click();
  await expect(ticket).toContainText("preparing");
  await ticket.getByRole("button", { name: "Mark ready" }).click();
  await expect(ticket).toContainText("ready");
  await page.getByText("Operator controls", { exact: true }).click();
  await page.getByRole("button", { name: "Vehicle departed" }).click();
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await expect(page.locator(".order-line")).toHaveCount(0);
  await expect(ticket).toContainText("No onions · No cheese");
  await kitchen.setViewportSize({ width: 390, height: 844 });
  await kitchen.screenshot({
    path: `${evidence}/kitchen-mobile.png`,
    fullPage: true,
  });
  expect(
    await kitchen.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(
    `${evidence}/local-timings.json`,
    JSON.stringify(
      {
        measured_at: new Date().toISOString(),
        mode: "local no-key fixture over real MCP",
        browser_click_to_authoritative_cart_ms: cartMs,
        apply_cart_changes_mcp_round_trip_ms: firstResult.timing.tool_ms,
        browser_confirmation_to_accepted_board_ms: ackMs,
        notes:
          "Single local run includes browser/assertion overhead and polling. Not provider latency, SLA, or benchmark.",
      },
      null,
      2,
    ),
  );
});
test("staff takeover preserves cart and allows controlled correction", async ({
  page,
  context,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Start example order" }).click();
  await expect(page.locator(".order-line")).toHaveCount(3);
  await page.getByRole("button", { name: "Ask staff" }).click();
  await expect(
    page.getByRole("heading", { name: "Staff is on the way." }),
  ).toBeVisible();
  const crew = await context.newPage();
  await crew.goto("/crew");
  await crew.getByRole("button", { name: "Take control" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re with our crew." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start example order" }),
  ).toHaveCount(0);
  await crew
    .getByLabel("Staff message to the customer")
    .fill("I have your order. Let’s check that change together.");
  await crew.getByRole("button", { name: "Send staff message" }).click();
  await expect(
    page.getByText("I have your order. Let’s check that change together."),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/staff-takeover.png`,
    fullPage: true,
  });
  await crew
    .getByRole("button", {
      name: "Edit Harbor Cheeseburger No onions",
      exact: true,
    })
    .click();
  await crew.getByLabel("No cheese", { exact: true }).check();
  await crew.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("No onions · No cheese", { exact: true }),
  ).toBeVisible();
  await crew.getByRole("button", { name: "Mark staff review handled" }).click();
  await crew.getByRole("button", { name: "Release to SayGo" }).click();
  await expect(
    page.getByRole("heading", { name: "Looking good?" }),
  ).toBeVisible();
  await crew.setViewportSize({ width: 390, height: 844 });
  await crew.screenshot({
    path: `${evidence}/crew-mobile.png`,
    fullPage: true,
  });
  expect(
    await crew.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("control changes close stale editors; a departed customer's staff editor cannot follow the next draft", async ({
  page,
  context,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Start example order" }).click();
  await page
    .getByRole("button", {
      name: "Edit Harbor Cheeseburger No onions",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const crew = await context.newPage();
  await crew.goto("/crew");
  let takeoverRequests = 0;
  crew.on("request", (request) => {
    if (
      request.url().endsWith("/api/crew/action") &&
      request.postDataJSON()?.action === "takeover"
    )
      takeoverRequests++;
  });
  // Two synchronous clicks exercise the ref guard, before disabled re-renders.
  await crew
    .getByRole("button", { name: "Take control", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(
    page.getByRole("heading", { name: "You’re with our crew." }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(takeoverRequests).toBe(1);
  await expect(
    page.getByRole("button", { name: "Undo last change", exact: true }),
  ).toBeDisabled();
  await crew
    .getByRole("button", {
      name: "Edit Harbor Cheeseburger No onions",
      exact: true,
    })
    .click();
  await crew.getByLabel("No cheese", { exact: true }).check();
  await crew.getByRole("button", { name: "Save changes", exact: true }).click();
  await crew
    .getByRole("button", { name: "Release to SayGo", exact: true })
    .click();
  await expect(
    page.getByText("No onions · No cheese", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "You’re back in control. Check the draft, then start voice when you’re ready.",
    ),
  ).toBeVisible();
  await crew.getByRole("button", { name: "Take control", exact: true }).click();
  await crew
    .getByLabel("Staff message to the customer")
    .fill("Previous customer only");
  await crew.getByRole("button", { name: "Add an item", exact: true }).click();
  await crew
    .locator(".menu-item")
    .filter({ has: crew.getByText("Lemonade", { exact: true }) })
    .click();
  await expect(crew.getByRole("dialog")).toBeVisible();
  await page.getByText("Operator controls", { exact: true }).click();
  await page
    .getByRole("button", { name: "Vehicle departed", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Begin customer session", exact: true })
    .click();
  await expect(crew.getByRole("dialog")).toHaveCount(0);
  await expect(crew.getByLabel("Staff message to the customer")).toHaveValue(
    "",
  );
  await expect(
    crew.getByRole("button", { name: "Add an item", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".order-line")).toHaveCount(0);
});
test("stock change invalidates review, blocks confirmation, then recovers", async ({
  page,
  context,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Start example order" }).click();
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toBeVisible();
  const admin = await context.newPage();
  await admin.goto("/admin");
  const lemonade = admin.locator("form.admin-product").filter({
    has: admin.getByRole("heading", { name: "Lemonade", exact: true }),
  });
  try {
    await lemonade.getByLabel("Available", { exact: true }).uncheck();
    await lemonade
      .getByRole("button", { name: "Save Lemonade", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm order", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Lemonade is unavailable. Please choose a replacement or remove it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review order", exact: true }),
    ).toBeDisabled();
  } finally {
    await lemonade.getByLabel("Available", { exact: true }).check();
    await lemonade
      .getByRole("button", { name: "Save Lemonade", exact: true })
      .click();
  }
  await expect(
    page.getByRole("button", { name: "Review order", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(
      "Your review changed or expired. Please review the current order again.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({
    path: `${evidence}/order-tablet.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a failed draft save preserves selected modifiers for an explicit retry", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Start example order" }).click();
  await page
    .getByRole("button", {
      name: "Edit Harbor Cheeseburger No onions",
      exact: true,
    })
    .click();
  await page.getByLabel("No cheese", { exact: true }).check();
  let failNext = true;
  await page.route("**/api/lane/tool", async (route) => {
    if (
      route.request().postDataJSON()?.name === "apply_cart_changes" &&
      failNext
    ) {
      failNext = false;
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic save failure; try again." },
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".global-error[role=alert]")).toContainText(
    "Synthetic save failure",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("No cheese", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("No onions · No cheese", { exact: true }),
  ).toBeVisible();
});
