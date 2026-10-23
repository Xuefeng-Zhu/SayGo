import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  customerMcpLogSchema,
  type CustomerMcpLogSnapshot,
  type Scope,
  type View,
} from "@saygo/contracts";
import { config, RESTAURANT, store, transaction } from "@saygo/db";
import {
  beginInteraction,
  getView,
  resetDemo,
  staffAction,
} from "@saygo/domain";
import { openMcp } from "@saygo/integrations";
import { app } from "../../apps/runtime/src/app.js";
import { agentToken, sign } from "../../apps/runtime/src/auth.js";
import { seedProducts } from "../../packages/db/src/menu.js";

// These tests exercise the real local HTTP MCP boundary using finite,
// explicitly selected fixtures. They do not open a voice/provider session.
const server = createServer(app);
const base = `http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}`;
let scope: Scope, token: string;
const laneCookie = () => `saygo_lane=${token}`;
const crewCookie = () =>
  `saygo_staff=${sign({ aud: "staff", id: "crew", exp: Date.now() + 60_000 })}`;

const post = (path: string, body: unknown, cookie = laneCookie()) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: config.SAYGO_WEB_ORIGIN,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
const read = (cookie = laneCookie(), query = "") =>
  fetch(`${base}/api/lane/mcp-log${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
async function log(): Promise<CustomerMcpLogSnapshot> {
  const response = await read();
  expect(response.status).toBe(200);
  return customerMcpLogSchema.parse(await response.json());
}
async function invoke(name: string, args: Record<string, unknown> = {}) {
  return post("/api/lane/tool", { name, arguments: args });
}
async function fixture() {
  const response = await post("/api/lane/fixture", { text: "first" });
  expect(response.status).toBe(200);
  return (await response.json()) as View;
}
async function noOrder() {
  expect(await store.list("orders")).toHaveLength(0);
  expect(await store.list("approvals")).toHaveLength(0);
  expect(await store.list("jobs")).toHaveLength(0);
  expect(await store.list("pos_receipts")).toHaveLength(0);
}

beforeAll(async () => {
  expect(config.DYNAMODB_NAMESPACE).toBe("saygo_test");
  expect(config.DYNAMODB_ENDPOINT).toMatch(
    /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/,
  );
  expect(config.SAYGO_DEMO).toBe("true");
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

describe("current-customer MCP call log over HTTP", () => {
  it("requires the active customer's cookie, even when a staff cookie or session selector is supplied", async () => {
    for (const cookie of ["", "saygo_lane=invalid", crewCookie()]) {
      const response = await read(cookie, `?session_id=${scope.session_id}`);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(scope.session_id);
    }
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(customerMcpLogSchema.parse(await response.json())).toEqual({
      session_id: scope.session_id,
      epoch: scope.epoch,
      entries: [],
      limit: 30,
    });
  });

  it("records actual fixture MCP calls once and keeps their IDs stable across polling/reconnect reads", async () => {
    const view = await fixture();
    expect(view.cart.lines).toHaveLength(3);
    const first = await log();
    expect(first.entries.map(({ tool }) => tool)).toEqual([
      "get_cart",
      "apply_cart_changes",
    ]);
    expect(first.entries.every((entry) => entry.source === "fixture")).toBe(
      true,
    );
    expect(first.entries.every((entry) => entry.status === "succeeded")).toBe(
      true,
    );
    for (const entry of first.entries) {
      expect(entry.duration_ms).toEqual(expect.any(Number));
      expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(entry.duration_ms)).toBe(true);
      expect(entry.input_summary.length).toBeGreaterThan(0);
      expect(entry.result_summary?.length).toBeGreaterThan(0);
    }
    expect(new Set(first.entries.map(({ id }) => id)).size).toBe(2);
    expect(await log()).toEqual(first);
    expect(await log()).toEqual(first);
    await noOrder();
  });

  it("does not turn review or log reads into order consent and records an explicit screen-confirmed submit", async () => {
    await fixture();
    const requestId = randomUUID();
    const reviewResponse = await invoke("prepare_order_review", {
      expected_version: (await getView(scope)).cart_version,
      request_id: requestId,
    });
    expect(reviewResponse.status).toBe(200);
    const review = (await reviewResponse.json()) as View;
    expect(review.quote).toMatchObject({ approved: false });
    const quoteId = review.quote!.id;
    expect((await log()).entries.at(-1)).toMatchObject({
      tool: "prepare_order_review",
      source: "screen",
      status: "succeeded",
    });
    await log();
    await noOrder();

    // An MCP submission attempt cannot create the missing customer approval.
    const rejected = await invoke("submit_order", { quote_id: quoteId });
    expect(rejected.status).toBe(400);
    expect((await log()).entries.at(-1)).toMatchObject({
      tool: "submit_order",
      source: "screen",
      status: "failed",
    });
    await noOrder();

    const confirmed = await post("/api/lane/confirm", { quote_id: quoteId });
    expect(confirmed.status).toBe(200);
    const confirmedView = (await confirmed.json()) as View;
    expect(confirmedView.order).not.toBeNull();
    expect(await store.list("orders")).toHaveLength(1);
    expect(await store.list("approvals")).toHaveLength(1);
    const snapshot = await log();
    expect(snapshot.entries.at(-1)).toMatchObject({
      tool: "submit_order",
      source: "screen",
      status: "succeeded",
    });
    const serialized = JSON.stringify(snapshot.entries);
    for (const privateValue of [requestId, quoteId, token])
      expect(serialized).not.toContain(privateValue);
    expect(await log()).toEqual(snapshot);
    expect(await store.list("orders")).toHaveLength(1);
  });

  it("logs sanitized failures and reset proposals without leaking inputs or claiming the draft was reset", async () => {
    const view = await fixture();
    const privateProductId = "private-invalid-product-for-log-test";
    const failed = await invoke("get_item_details", {
      product_id: privateProductId,
    });
    expect(failed.status).toBe(400);
    const failureBody = (await failed.json()) as { error: string };
    expect(failureBody.error.length).toBeGreaterThan(0);
    const proposed = await invoke("cancel_draft_order", {
      expected_version: view.cart_version,
    });
    expect(proposed.status).toBe(200);
    const proposal = (await proposed.json()) as View & { reset_token: string };
    expect(proposal.reset_token).toEqual(expect.any(String));
    expect(proposal.cart).toEqual(view.cart);
    expect((await getView(scope)).cart).toEqual(view.cart);
    const snapshot = await log();
    expect(snapshot.entries.slice(-2)).toMatchObject([
      { tool: "get_item_details", status: "failed", source: "screen" },
      { tool: "cancel_draft_order", status: "succeeded", source: "screen" },
    ]);
    expect(snapshot.entries.at(-1)?.result_summary).toMatch(/propos|confirm/i);
    const serialized = JSON.stringify(snapshot.entries);
    for (const privateValue of [
      privateProductId,
      failureBody.error,
      proposal.reset_token,
      ...view.cart.lines.map(({ id }) => id),
      token,
    ])
      expect(serialized).not.toContain(privateValue);
    await noOrder();
  });

  it("retains only the current customer's metadata through staff handoff and takeover", async () => {
    await fixture();
    const privateConcern =
      "private-note-qa-only-do-not-echo-Authorization-Bearer";
    const handoff = await invoke("request_staff_help", {
      reason: "assistance",
      concern: privateConcern,
    });
    expect(handoff.status).toBe(200);
    const snapshot = await log();
    expect(snapshot.entries.at(-1)).toMatchObject({
      tool: "request_staff_help",
      status: "succeeded",
      source: "screen",
    });
    expect(JSON.stringify(snapshot)).not.toContain(privateConcern);
    expect(JSON.stringify(snapshot)).not.toContain("Authorization");
    expect(snapshot.session_id).toBe(scope.session_id);
    await staffAction({ ...scope, actor: "staff" }, "takeover");
    expect(await log()).toEqual(snapshot);
    expect((await getView({ ...scope, actor: "staff" })).session.owner).toBe(
      "staff",
    );
    const unauthorized = await read(crewCookie());
    expect(unauthorized.status).toBe(401);
    await noOrder();
  });

  it("records direct authenticated MCP tool calls without logging initialization or exposing another customer's history", async () => {
    const requestId = randomUUID();
    const privateProductId = "private-direct-mcp-product-qa-only";
    const mcp = await openMcp(agentToken(scope));
    try {
      // openMcp already initialized the protocol and listed the tools. Those
      // exchanges are not tool invocations and must not fabricate activity.
      expect(mcp.tools.some(({ name }) => name === "get_cart")).toBe(true);
      expect((await log()).entries).toEqual([]);
      await mcp.call("get_cart", {});
      await mcp.call("apply_cart_changes", {
        expected_version: 0,
        request_id: requestId,
        commands: [
          {
            type: "add",
            product_id: "classic",
            quantity: 1,
            choices: { remove: ["onions"] },
          },
        ],
      });
      const actual = await getView(scope);
      expect(actual.cart.lines).toHaveLength(1);
      expect(actual.cart.lines[0]).toMatchObject({
        product_id: "classic",
        quantity: 1,
        choices: { remove: ["onions"] },
      });
      const snapshot = await log();
      expect(snapshot.entries).toHaveLength(2);
      expect(snapshot.entries.map(({ tool }) => tool)).toEqual([
        "get_cart",
        "apply_cart_changes",
      ]);
      expect(new Set(snapshot.entries.map(({ id }) => id)).size).toBe(2);
      expect(
        snapshot.entries.every(
          ({ source, status }) => source === "mcp" && status === "succeeded",
        ),
      ).toBe(true);
      expect(JSON.stringify(snapshot.entries)).not.toContain(requestId);
      expect(await log()).toEqual(snapshot);

      await expect(
        mcp.call("get_item_details", { product_id: privateProductId }),
      ).rejects.toBeInstanceOf(Error);
      const failed = await log();
      expect(failed.entries).toHaveLength(3);
      expect(failed.entries.at(-1)).toMatchObject({
        tool: "get_item_details",
        source: "mcp",
        status: "failed",
      });
      expect(JSON.stringify(failed.entries)).not.toContain(privateProductId);
      expect(JSON.stringify(failed.entries)).not.toContain(requestId);
      expect(await log()).toEqual(failed);
      await noOrder();
    } finally {
      await mcp.close();
    }

    const priorCookie = laneCookie();
    const prior = await log();
    const next = await beginInteraction("lane-1");
    scope = next.scope;
    token = next.token;
    const response = await read(
      laneCookie(),
      `?session_id=${prior.session_id}`,
    );
    expect(response.status).toBe(200);
    expect(customerMcpLogSchema.parse(await response.json())).toEqual({
      session_id: scope.session_id,
      epoch: scope.epoch,
      entries: [],
      limit: 30,
    });
    expect((await read(priorCookie)).status).toBe(401);
  });

  it("revokes departed customer access and starts a new customer with no prior call history", async () => {
    await fixture();
    const priorCookie = laneCookie();
    const prior = await log();
    const departed = await post(
      "/api/lane/depart",
      {},
      `${priorCookie}; ${crewCookie()}`,
    );
    expect(departed.status).toBe(200);
    expect((await read(priorCookie)).status).toBe(401);
    const started = await beginInteraction("lane-1");
    scope = started.scope;
    token = started.token;
    const next = await read(laneCookie(), `?session_id=${prior.session_id}`);
    expect(next.status).toBe(200);
    expect(customerMcpLogSchema.parse(await next.json())).toEqual({
      session_id: scope.session_id,
      epoch: scope.epoch,
      entries: [],
      limit: 30,
    });
    const oldSession = await read(
      priorCookie,
      `?session_id=${scope.session_id}`,
    );
    expect(oldSession.status).toBe(401);
    expect(await oldSession.text()).not.toContain(prior.entries[0].id);
  });

  it("bounds actual invocation history at 30 without generating calls from snapshot reads", async () => {
    for (let index = 0; index < 32; index++) {
      const response = await invoke("get_cart");
      expect(response.status).toBe(200);
    }
    const snapshot = await log();
    expect(snapshot.entries).toHaveLength(30);
    expect(new Set(snapshot.entries.map(({ id }) => id)).size).toBe(30);
    expect(snapshot.entries.every(({ tool }) => tool === "get_cart")).toBe(
      true,
    );
    expect(await log()).toEqual(snapshot);
    await noOrder();
  }, 40_000);
});
