import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { Scope, View } from "@saygo/contracts";
import { config, entities, RESTAURANT, store, transaction } from "@saygo/db";
import {
  applyMealSavings,
  approve,
  beginInteraction,
  getMealSavings,
  getView,
  resetDemo,
  scopeForToken,
  staffAction,
  tool,
  undoCartChange,
  updateProduct,
  voiceLease,
} from "@saygo/domain";
import { seedProducts } from "../../packages/db/src/menu.js";
import { app } from "../../apps/runtime/src/app.js";
const server = createServer(app);

let scope: Scope, token: string;
const asView = (value: Record<string, unknown>) => value as unknown as View;
async function change(commands: unknown[], clarification?: string) {
  return asView(
    await tool(scope, "apply_cart_changes", {
      expected_version: (await getView(scope)).cart_version,
      request_id: randomUUID(),
      commands,
      ...(clarification ? { clarification } : {}),
    }),
  );
}
async function combo() {
  return change([
    {
      type: "add",
      product_id: "cheeseburger",
      quantity: 1,
      choices: { remove: ["onions"], extra: ["cheese"] },
    },
    {
      type: "add",
      product_id: "fries",
      quantity: 1,
      variant: "medium",
      choices: {},
    },
    {
      type: "add",
      product_id: "lemonade",
      quantity: 1,
      variant: "large",
      choices: {},
    },
  ]);
}
async function approvedReview() {
  const quote = asView(
    await tool(scope, "prepare_order_review", {
      expected_version: (await getView(scope)).cart_version,
      request_id: randomUUID(),
    }),
  ).quote!;
  await approve(scope, quote.id);
  return quote;
}
const undoInput = (view: View) => ({
  receipt_id: view.last_change!.id,
  expected_version: view.cart_version,
  request_id: randomUUID(),
});
const savingsInput = (view: View) => ({
  proposal_id: view.meal_savings!.id,
  expected_version: view.cart_version,
  request_id: randomUUID(),
});
const entitySnapshot = () =>
  transaction(async (tx) =>
    Object.fromEntries(
      await Promise.all(
        entities.map(async (entity) => [entity, await tx.list(entity)]),
      ),
    ),
  );

beforeAll(async () => {
  expect(config.DYNAMODB_NAMESPACE).toBe("saygo_test");
  // Permit an isolated local QA port while keeping production endpoints out.
  expect(config.DYNAMODB_ENDPOINT).toMatch(
    /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/,
  );
  await new Promise<void>((resolve) =>
    server.listen(config.SAYGO_RUNTIME_PORT, "127.0.0.1", resolve),
  );
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await store.close();
});
beforeEach(async () => {
  await resetDemo();
  await transaction(async (tx) => {
    for (const data of seedProducts)
      await tx.update("products", data.id, { data });
    await tx.update("restaurants", RESTAURANT, {
      menu_version: 1,
      price_version: 1,
      pos_mode: "accept",
    });
  });
  const started = await beginInteraction("lane-1");
  scope = started.scope;
  token = started.token;
});

describe("durable correction receipts and undo", () => {
  it("survives reload, undoes only the targeted correction, retains IDs and requires a new quote", async () => {
    const original = await combo();
    const drink = original.cart.lines.find(
      (line) => line.product_id === "lemonade",
    )!;
    const edited = await change([
      { type: "update", line_id: drink.id, variant: "small" },
    ]);
    expect(edited.last_change).toMatchObject({
      undo_available: true,
      changes: [
        {
          line_id: drink.id,
          before: { variant: "large" },
          after: { variant: "small" },
        },
      ],
    });
    const reloaded = await getView(await scopeForToken(token));
    expect(reloaded.last_change).toEqual(edited.last_change);
    const quote = await approvedReview();
    const request = undoInput(reloaded);
    const restored = await undoCartChange(scope, request);
    expect(restored.cart.lines).toEqual(original.cart.lines);
    expect(restored.cart_version).toBe(edited.cart_version + 1);
    expect(restored.quote).toBeNull();
    expect(restored.last_change).toMatchObject({
      kind: "undo",
      undo_available: false,
    });
    await expect(approve(scope, quote.id)).rejects.toMatchObject({
      code: "STALE_QUOTE",
    });
    const retry = await undoCartChange(scope, request);
    expect(retry.cart).toEqual(restored.cart);
    expect(retry.last_change).toEqual(restored.last_change);
    await expect(
      undoCartChange(scope, { ...request, receipt_id: randomUUID() }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(
      undoCartChange(scope, undoInput(restored)),
    ).rejects.toMatchObject({ code: "UNDO_UNAVAILABLE" });
  });
  it("rejects old receipts and clears an obsolete receipt on clarification-only changes", async () => {
    const first = await combo();
    await change([{ type: "remove", line_id: first.cart.lines[2].id }]);
    await expect(undoCartChange(scope, undoInput(first))).rejects.toMatchObject(
      { code: "VERSION_CONFLICT" },
    );
    const clarified = await change([], "ambiguous_line");
    expect(clarified.last_change).toBeNull();
    expect((await store.get("carts", scope.session_id))!.undo).toBeNull();
  });
  it("cannot restore old menu prices or undo across a staff fence", async () => {
    const initial = await combo();
    await updateProduct("lemonade", {
      variants: { small: 310, medium: 360, large: 410 },
    });
    expect((await getView(scope)).last_change!.undo_available).toBe(false);
    await expect(
      undoCartChange(scope, undoInput(initial)),
    ).rejects.toMatchObject({ code: "UNDO_UNAVAILABLE" });
    const fresh = await change([
      { type: "update", line_id: initial.cart.lines[2].id, variant: "small" },
    ]);
    const staff = { ...scope, actor: "staff" as const };
    await staffAction(staff, "takeover");
    await expect(undoCartChange(scope, undoInput(fresh))).rejects.toMatchObject(
      { code: "STAFF_REVIEW" },
    );
    await staffAction(staff, "release");
    await expect(
      undoCartChange(await scopeForToken(token), undoInput(fresh)),
    ).rejects.toMatchObject({ code: "UNDO_UNAVAILABLE" });
  });
  it("serializes concurrent undo and correction so exactly one wins", async () => {
    const initial = await combo();
    const outcomes = await Promise.allSettled([
      undoCartChange(scope, undoInput(initial)),
      tool(scope, "apply_cart_changes", {
        expected_version: initial.cart_version,
        request_id: randomUUID(),
        commands: [
          {
            type: "update",
            line_id: initial.cart.lines[2].id,
            variant: "small",
          },
        ],
      }),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await getView(scope)).cart_version).toBe(initial.cart_version + 1);
  });
});

describe("meal savings require exact customer acceptance", () => {
  it("finds savings without writes, keeps ingredients/sizes on acceptance and supports one-step undo", async () => {
    const initial = await combo();
    const quote = await approvedReview();
    const before = await entitySnapshot();
    expect((await getMealSavings(scope)).proposal).toEqual(
      initial.meal_savings,
    );
    expect(await entitySnapshot()).toEqual(before);
    expect((await getView(scope)).quote).toMatchObject({
      id: quote.id,
      approved: true,
    });
    const input = savingsInput(initial);
    const accepted = await applyMealSavings(scope, input);
    expect(accepted.cart_version).toBe(initial.cart_version + 1);
    expect(accepted.quote).toBeNull();
    expect(accepted.totals.total).toBe(
      initial.totals.total - initial.meal_savings!.savings_cents,
    );
    expect(accepted.cart.lines).toHaveLength(1);
    expect(accepted.cart.lines[0]).toMatchObject({
      id: initial.cart.lines[0].id,
      choices: initial.cart.lines[0].choices,
      meal: { drink: "lemonade", drink_variant: "large" },
    });
    expect(accepted.last_change).toMatchObject({
      kind: "meal_savings",
      undo_available: true,
    });
    expect(accepted.meal_savings).toBeNull();
    expect((await applyMealSavings(scope, input)).cart).toEqual(accepted.cart);
    const loaded = await getView(await scopeForToken(token));
    const undone = await undoCartChange(scope, undoInput(loaded));
    expect(undone.cart.lines).toEqual(initial.cart.lines);
    expect(undone.meal_savings).not.toBeNull();
    await expect(approve(scope, quote.id)).rejects.toMatchObject({
      code: "STALE_QUOTE",
    });
    const newQuote = await approvedReview();
    expect(newQuote.id).not.toBe(quote.id);
  });
  it("rejects acceptance after menu/cart changes and mismatched retry payloads", async () => {
    const initial = await combo();
    await updateProduct("lemonade", {
      variants: { small: 310, medium: 360, large: 410 },
    });
    await expect(
      applyMealSavings(scope, savingsInput(initial)),
    ).rejects.toMatchObject({ code: "STALE_SAVINGS" });
    const current = await getView(scope);
    await change([
      { type: "update", line_id: current.cart.lines[2].id, variant: "small" },
    ]);
    await expect(
      applyMealSavings(scope, savingsInput(current)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const fresh = await getView(scope),
      input = savingsInput(fresh);
    await applyMealSavings(scope, input);
    await expect(
      applyMealSavings(scope, { ...input, proposal_id: "a".repeat(64) }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });
  it("does not give agents or staff the customer's acceptance authority", async () => {
    const initial = await combo();
    await expect(
      applyMealSavings({ ...scope, actor: "agent" }, savingsInput(initial)),
    ).rejects.toMatchObject({ code: "CONSENT" });
    await expect(
      undoCartChange({ ...scope, actor: "agent" }, undoInput(initial)),
    ).rejects.toMatchObject({ code: "CONSENT" });
    await expect(
      applyMealSavings({ ...scope, actor: "staff" }, savingsInput(initial)),
    ).rejects.toMatchObject({ code: "CONSENT" });
    expect((await getView(scope)).cart).toEqual(initial.cart);
  });
  it("blocks voice, allergy handoffs, staff control, submitted orders and prior interactions", async () => {
    const initial = await combo();
    await voiceLease(
      scope.session_id,
      new Date(Date.now() + 60000).toISOString(),
    );
    await expect(
      applyMealSavings(scope, savingsInput(initial)),
    ).rejects.toMatchObject({ code: "VOICE_PENDING" });
    await expect(
      undoCartChange(scope, undoInput(initial)),
    ).rejects.toMatchObject({ code: "VOICE_PENDING" });
    await voiceLease(scope.session_id, null);
    await tool(scope, "request_staff_help", { reason: "allergy" });
    await expect(
      applyMealSavings(scope, savingsInput(initial)),
    ).rejects.toMatchObject({ code: "STAFF_REVIEW" });
    await expect(
      undoCartChange(scope, undoInput(initial)),
    ).rejects.toMatchObject({ code: "STAFF_REVIEW" });
    const staff = { ...scope, actor: "staff" as const };
    await staffAction(staff, "takeover");
    await staffAction(staff, "resolve");
    await staffAction(staff, "release");
    scope = await scopeForToken(token);
    await expect(
      applyMealSavings(scope, savingsInput(initial)),
    ).rejects.toMatchObject({ code: "STALE_SAVINGS" });
    const quote = await approvedReview();
    await tool(scope, "submit_order", { quote_id: quote.id });
    await expect(
      applyMealSavings(scope, savingsInput(initial)),
    ).rejects.toMatchObject({ code: "ORDER_LOCKED" });
    await expect(
      undoCartChange(scope, undoInput(initial)),
    ).rejects.toMatchObject({ code: "ORDER_LOCKED" });
    expect((await getView(scope)).meal_savings).toBeNull();
    await beginInteraction("lane-1");
    await expect(
      undoCartChange(scope, undoInput(initial)),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });
});

describe("customer draft HTTP boundary", () => {
  it("requires the lane cookie and same-origin action, rejects client cart snapshots, and supports reload/retries", async () => {
    const initial = await combo();
    const base = `http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}`;
    const post = (
      path: string,
      body: object,
      headers: Record<string, string> = {},
    ) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: config.SAYGO_WEB_ORIGIN,
          Cookie: `saygo_lane=${token}`,
          ...headers,
        },
        body: JSON.stringify(body),
      });
    const input = savingsInput(initial);
    expect(
      (await post("/api/lane/meal-savings/apply", input, { Cookie: "" }))
        .status,
    ).toBe(401);
    expect(
      (
        await post("/api/lane/meal-savings/apply", input, {
          Origin: "https://untrusted.invalid",
        })
      ).status,
    ).toBe(403);
    const proposal = await fetch(`${base}/api/lane/meal-savings`, {
      headers: { Cookie: `saygo_lane=${token}` },
    });
    expect((await proposal.json()).proposal).toEqual(initial.meal_savings);
    const appliedResponse = await post("/api/lane/meal-savings/apply", input);
    expect(appliedResponse.status).toBe(200);
    const applied = (await appliedResponse.json()) as View;
    const retry = await post("/api/lane/meal-savings/apply", input);
    expect((await retry.json()).cart).toEqual(applied.cart);
    const undo = undoInput(applied);
    expect(
      (await post("/api/lane/undo", { ...undo, cart: initial.cart })).status,
    ).toBe(400);
    const restored = await post("/api/lane/undo", undo);
    expect(restored.status).toBe(200);
    expect((await restored.json()).cart.lines).toEqual(initial.cart.lines);
    const loaded = await fetch(`${base}/api/lane/state`, {
      headers: { Cookie: `saygo_lane=${token}` },
    });
    expect((await loaded.json()).last_change).toMatchObject({
      kind: "undo",
      undo_available: false,
    });
  });
});

describe("repairing drafts after menu price changes", () => {
  it.each(["remove", "reset"])(
    "allows %s when historical receipt prices cannot be reconstructed",
    async (operation) => {
      const initial = await combo();
      const meal = await applyMealSavings(scope, savingsInput(initial));
      const reset = await tool(scope, "cancel_draft_order", {
        expected_version: meal.cart_version,
      });
      // The existing conversion discount now exceeds component prices. This is
      // allowed by admin price edits; customers must still be able to remove it.
      await updateProduct("cheeseburger", { variants: { regular: 0 } });
      await updateProduct("fries", {
        variants: { small: 0, medium: 0, large: 0 },
      });
      await updateProduct("lemonade", {
        variants: { small: 0, medium: 0, large: 0 },
      });
      await expect(getView(scope)).rejects.toMatchObject({ code: "PRICE" });
      const repaired = asView(
        operation === "remove"
          ? await tool(scope, "apply_cart_changes", {
              expected_version: meal.cart_version,
              request_id: randomUUID(),
              commands: [{ type: "remove", line_id: meal.cart.lines[0].id }],
            })
          : await tool(scope, "cancel_draft_order", {
              expected_version: meal.cart_version,
              reset_token: reset.reset_token,
            }),
      );
      expect(repaired.cart.lines).toEqual([]);
      expect(repaired.cart_version).toBe(meal.cart_version + 1);
      expect(repaired.totals.total).toBe(0);
      expect(repaired.last_change).toBeNull();
      expect((await store.get("carts", scope.session_id))!.undo).toBeNull();
    },
  );
});
