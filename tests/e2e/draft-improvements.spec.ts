import { test, expect, type Page } from "./operator-fixture";
import { mkdir } from "node:fs/promises";
import type { View } from "@saygo/contracts";

const evidence =
  process.env.SAYGO_E2E_EVIDENCE_DIR ?? "/private/tmp/saygo-draft-features";

async function start(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/lane/lane-1");
  await expect(page).toHaveTitle("SayGo · Harbor Burger");
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your order", exact: true }),
  ).toBeVisible();
}

async function state(page: Page): Promise<View> {
  const response = await page.request.get("/api/lane/state");
  expect(response.ok()).toBe(true);
  return response.json();
}

async function addItem(
  page: Page,
  name: string,
  size?: string,
  choice?: string,
) {
  // Empty state and the conversation rail both offer Browse menu.
  await page
    .getByRole("button", { name: "Browse menu", exact: true })
    .first()
    .click();
  await page
    .locator(".menu-item")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  if (size) await dialog.getByLabel("Size", { exact: true }).selectOption(size);
  if (choice) await dialog.getByLabel(choice, { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Add to order", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
});

test("correction receipt survives reload; Undo restores identities and requires fresh review", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  // Signed-out /me and /lane/state requests intentionally return 401.
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.getByRole("button", { name: "Start example order" }).click();
  await expect(page.locator(".order-line")).toHaveCount(3);
  const before = await state(page);
  await page
    .getByRole("button", { name: "Apply correction", exact: true })
    .click();
  const receipt = page.getByRole("region", {
    name: "Order updated",
    exact: true,
  });
  await expect(receipt).toContainText("Medium → Large");
  await expect(receipt).toContainText("No onions → No onions · No cheese");
  await expect(receipt).toContainText("Total +$0.54");
  await expect(page.locator(".order-line.recently-changed")).toHaveCount(2);
  await page.reload();
  await expect(receipt).toContainText("Medium → Large");
  await page.screenshot({
    path: `${evidence}/correction-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await receipt.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${evidence}/correction-mobile.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your order", exact: true }),
  ).toBeVisible();
  const quote = (await state(page)).quote!;
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Change undone", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Undo last change", exact: true }),
  ).toHaveCount(0);
  const undone = await state(page);
  expect(undone.cart.lines).toEqual(before.cart.lines);
  expect(undone.totals).toEqual(before.totals);
  expect(undone.cart_version).toBe(before.cart_version + 2);
  expect(undone.quote).toBeNull();
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your order", exact: true }),
  ).toBeVisible();
  expect((await state(page)).quote?.id).not.toBe(quote.id);
  expect(errors).toEqual([]);
});

test("equivalent meal proposal is read-only, preserves customized sandwich and large drink, applies and undoes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await addItem(page, "Harbor Cheeseburger", undefined, "No onions");
  await addItem(page, "Sea-salt Fries", "medium");
  await addItem(page, "Lemonade", "large");
  const offer = page.getByRole("region", {
    name: "Save $1.08 with meals",
    exact: true,
  });
  await expect(offer).toBeVisible();
  await expect(offer).toContainText("large Lemonade");
  await expect(offer).toContainText("$14.85");
  await expect(offer).toContainText("$13.77");
  const before = await state(page);
  expect(before.cart.lines).toHaveLength(3);
  await offer.getByRole("button", { name: "Keep items separate" }).click();
  await page.getByRole("button", { name: "Check meal savings" }).click();
  await expect(offer).toBeVisible();
  expect((await state(page)).cart).toEqual(before.cart);
  await page.reload();
  await expect(offer).toBeVisible();
  expect((await state(page)).cart).toEqual(before.cart);
  await page.screenshot({
    path: `${evidence}/meal-savings-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await offer.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${evidence}/meal-savings-mobile.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await offer
    .getByRole("button", { name: "Apply meal savings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Meal savings applied", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".order-line")).toHaveCount(1);
  const applied = await state(page);
  expect(applied.cart.lines[0]).toMatchObject({
    id: before.cart.lines[0].id,
    choices: { remove: ["onions"] },
    meal: { drink: "lemonade", drink_variant: "large" },
  });
  expect(applied.totals.total).toBe(1377);
  expect(applied.order).toBeNull();
  expect(applied.quote).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Meal savings applied", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.locator(".order-line")).toHaveCount(3);
  expect((await state(page)).cart.lines).toEqual(before.cart.lines);
  expect((await state(page)).totals).toEqual(before.totals);
  expect(errors).toEqual([]);
});

test("modified drink gets no meal proposal and checking savings never changes the draft", async ({
  page,
}) => {
  await start(page);
  await addItem(page, "Harbor Cheeseburger");
  await addItem(page, "Sea-salt Fries", "medium");
  await addItem(page, "Lemonade", "large", "No ice");
  const before = await state(page);
  expect(before.meal_savings).toBeNull();
  await page.getByRole("button", { name: "Check meal savings" }).click();
  await expect(
    page.getByText(/No equivalent meal savings are available/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply meal savings" }),
  ).toHaveCount(0);
  expect((await state(page)).cart).toEqual(before.cart);
});
