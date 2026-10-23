import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoveryFor, type Scope, type ToolName } from "@saygo/contracts";
import { McpCallError } from "@saygo/integrations";
import {
  CustomerMcpLog,
  customerMcpInputSummary,
  customerMcpResultSummary,
  customerMcpLog,
  openCustomerMcp,
} from "../../apps/runtime/src/customer-mcp-log.js";

const mock = vi.hoisted(() => ({ open: vi.fn(), token: vi.fn() }));
vi.mock("@saygo/integrations", async (original) => ({
  ...(await original<typeof import("@saygo/integrations")>()),
  openMcp: mock.open,
}));
vi.mock("../../apps/runtime/src/auth.js", () => ({ agentToken: mock.token }));

const scope: Scope = {
  restaurant_id: "harbor-demo",
  lane_id: "lane-1",
  session_id: "00000000-0000-4000-8000-000000000001",
  epoch: 1,
  fence: 2,
  actor: "customer",
};
const secret = "PRIVATE_TEST_SENTINEL_NEVER_RENDER";
const cart = {
  lines: [{ quantity: 1 }, { quantity: 2 }],
  totals: { total: 972 },
  summary: secret,
  reset_token: secret,
  session_id: secret,
};
const deferred = () => {
  let resolve!: (value: Record<string, unknown>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Record<string, unknown>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
function harness(
  options: ConstructorParameters<typeof CustomerMcpLog>[0] = {},
) {
  let wall = 0;
  let monotonic = 100;
  let id = 0;
  const log = new CustomerMcpLog({
    now: () => wall,
    monotonicNow: () => monotonic,
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    ...options,
  });
  return {
    log,
    clock: (now: number, elapsed = now) => {
      wall = now;
      monotonic = 100 + elapsed;
    },
    call: (
      name: ToolName = "get_cart",
      result: Record<string, unknown> = cart,
      s = scope,
    ) => log.call(s, "fixture", name, {}, async () => result),
  };
}

describe("current-customer MCP call history", () => {
  it("tracks one invocation from pending through success with measured duration", async () => {
    const h = harness(),
      job = deferred(),
      invoke = vi.fn(() => job.promise);
    const pending = h.log.call(scope, "voice", "get_cart", {}, invoke);
    const first = h.log.read(scope).entries[0];
    expect(first).toMatchObject({
      tool: "get_cart",
      source: "voice",
      status: "pending",
    });
    expect(first.duration_ms).toBeUndefined();
    expect(first.result_summary).toBeUndefined();
    h.clock(32, 32.6);
    job.resolve(cart);
    expect(await pending).toBe(cart);
    const snapshot = h.log.read(scope);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      id: first.id,
      status: "succeeded",
      duration_ms: 33,
      input_summary: "Read current draft",
      result_summary: "3 items · $9.72",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it("keeps failed calls static and rethrows the same error without exposing its text", async () => {
    const h = harness(),
      error = new McpCallError(recoveryFor("INVALID_ARGUMENTS", secret));
    const invoke = vi.fn(async () => {
      throw error;
    });
    await expect(
      h.log.call(
        scope,
        "screen",
        "apply_cart_changes",
        {
          Authorization: secret,
          concern: secret,
          request_id: secret,
          commands: [
            { type: "update", line_id: secret, choices: { secret: [secret] } },
          ],
        },
        invoke,
      ),
    ).rejects.toBe(error);
    expect(h.log.read(scope).entries[0]).toMatchObject({
      status: "failed",
      input_summary: "Update 1 item",
      result_summary: "Call failed. Check the current draft or ask staff.",
    });
    expect(JSON.stringify(h.log.read(scope))).not.toContain(secret);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("marks uncertain transport outcomes without replaying or claiming rollback", async () => {
    const h = harness(),
      error = new McpCallError(recoveryFor("TRANSPORT_ERROR", secret));
    const invoke = vi.fn(async () => {
      throw error;
    });
    await expect(
      h.log.call(scope, "screen", "submit_order", { quote_id: secret }, invoke),
    ).rejects.toBe(error);
    expect(h.log.read(scope).entries[0]).toMatchObject({
      status: "unknown",
      result_summary:
        "Result not confirmed. Check the current order before retrying.",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.log.read(scope))).not.toContain(secret);
  });

  it("also records a rejection with an undefined reason as failure", async () => {
    const h = harness();
    await expect(
      h.log.call(scope, "fixture", "get_cart", {}, () =>
        Promise.reject(undefined),
      ),
    ).rejects.toBeUndefined();
    expect(h.log.read(scope).entries[0].status).toBe("failed");
  });

  it("keeps malformed write results uncertain without replaying or claiming rollback", async () => {
    const h = harness();
    const error = new McpCallError(recoveryFor("INVALID_TOOL_RESULT", secret));
    const invoke = vi.fn(async () => {
      throw error;
    });
    await expect(
      h.log.call(scope, "screen", "submit_order", { quote_id: secret }, invoke),
    ).rejects.toBe(error);
    expect(h.log.read(scope).entries[0]).toMatchObject({
      status: "unknown",
      result_summary:
        "Result not confirmed. Check the current order before retrying.",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.log.read(scope))).not.toContain(secret);
  });

  it.each(
    (["INTERNAL_ERROR", "PROTOCOL_ERROR"] as const).flatMap((code) =>
      (["voice", "screen", "fixture", "mcp"] as const).map((source) => ({
        code,
        source,
      })),
    ),
  )(
    "keeps $source $code results uncertain and never repeats them",
    async ({ code, source }) => {
      const h = harness();
      const error = new McpCallError(recoveryFor(code, secret));
      const invoke = vi.fn(async () => {
        throw error;
      });
      await expect(
        h.log.call(scope, source, "apply_cart_changes", {}, invoke),
      ).rejects.toBe(error);
      expect(h.log.read(scope).entries[0]).toMatchObject({
        source,
        status: "unknown",
        result_summary:
          "Result not confirmed. Check the current order before retrying.",
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(h.log.read(scope))).not.toContain(secret);
    },
  );

  it("isolates restaurant, lane, customer and interaction epoch", async () => {
    const h = harness();
    await h.call();
    for (const changed of [
      { restaurant_id: "another-restaurant" },
      { lane_id: "lane-2" },
      { session_id: randomUUID() },
      { epoch: 2 },
    ])
      expect(h.log.read({ ...scope, ...changed }).entries).toEqual([]);
    expect(
      h.log.read({ ...scope, fence: 9, actor: "staff" }).entries,
    ).toHaveLength(1);
    expect(h.log.read(scope)).toMatchObject({
      session_id: scope.session_id,
      epoch: 1,
      limit: 30,
    });
  });

  it("returns copies and stable IDs across repeated reads", async () => {
    const h = harness();
    await h.call();
    const first = h.log.read(scope),
      second = h.log.read(scope);
    expect(first.entries).toEqual(second.entries);
    first.entries[0].input_summary = "local edit";
    first.entries.length = 0;
    expect(h.log.read(scope).entries).toHaveLength(1);
    expect(h.log.read(scope).entries[0].input_summary).toBe(
      "Read current draft",
    );
  });

  it("retains only the last 30 actual calls, including repeated business retries", async () => {
    const h = harness();
    for (let i = 0; i < 35; i++) await h.call();
    const entries = h.log.read(scope).entries;
    expect(entries).toHaveLength(30);
    expect(new Set(entries.map((x) => x.id)).size).toBe(30);
    expect(entries[0].id.endsWith("000000000006")).toBe(true);
    expect(entries.at(-1)!.id.endsWith("000000000035")).toBe(true);
  });

  it("expires without read-polling extending retention", async () => {
    const h = harness();
    await h.call();
    h.clock(14 * 60_000);
    expect(h.log.read(scope).entries).toHaveLength(1);
    h.clock(15 * 60_000);
    expect(h.log.read(scope).entries).toEqual([]);
  });

  it("never resurrects a cleared call or attaches its completion to a new bucket", async () => {
    const h = harness(),
      job = deferred();
    const running = h.log.call(
      scope,
      "voice",
      "get_cart",
      {},
      () => job.promise,
    );
    h.log.clear(scope);
    await h.call();
    const current = h.log.read(scope).entries[0].id;
    job.resolve(cart);
    await running;
    expect(h.log.read(scope).entries.map((x) => x.id)).toEqual([current]);
  });

  it("does not restore pending calls evicted by the per-session history bound", async () => {
    const h = harness({ maxEntries: 1 }),
      job = deferred();
    const running = h.log.call(
      scope,
      "voice",
      "get_cart",
      {},
      () => job.promise,
    );
    await h.call("get_menu", { menu: { products: [] } });
    job.resolve(cart);
    await running;
    expect(h.log.read(scope).entries.map((x) => x.tool)).toEqual(["get_menu"]);
  });

  it("bounds sessions and ignores completions for evicted sessions", async () => {
    const h = harness({ maxSessions: 2 }),
      job = deferred();
    const running = h.log.call(
      scope,
      "voice",
      "get_cart",
      {},
      () => job.promise,
    );
    const two = { ...scope, session_id: randomUUID() },
      three = { ...scope, session_id: randomUUID() };
    await h.call("get_cart", cart, two);
    await h.call("get_cart", cart, three);
    job.resolve(cart);
    await running;
    expect(h.log.read(scope).entries).toEqual([]);
    expect(h.log.read(two).entries).toHaveLength(1);
    expect(h.log.read(three).entries).toHaveLength(1);
  });

  it("does not restore a call that completed after its retention expired", async () => {
    const h = harness(),
      job = deferred();
    const running = h.log.call(
      scope,
      "voice",
      "get_cart",
      {},
      () => job.promise,
    );
    h.clock(15 * 60_000);
    job.resolve(cart);
    await running;
    expect(h.log.read(scope).entries).toEqual([]);
  });

  it("does not prevent or repeat operations if optional log allocation fails", async () => {
    const h = harness({
      createId: () => {
        throw Error("optional log unavailable");
      },
    });
    const invoke = vi.fn(async () => cart);
    expect(await h.log.call(scope, "screen", "get_cart", {}, invoke)).toBe(
      cart,
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(h.log.read(scope).entries).toEqual([]);
  });

  it("does not fabricate entries for unknown tool names", async () => {
    const h = harness(),
      invoke = vi.fn(async () => cart);
    expect(await h.log.call(scope, "voice", secret, {}, invoke)).toBe(cart);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(h.log.read(scope).entries).toEqual([]);
  });

  it("omits duration rather than inventing one for an invalid monotonic clock", async () => {
    const h = harness(),
      job = deferred();
    const pending = h.log.call(
      scope,
      "voice",
      "get_cart",
      {},
      () => job.promise,
    );
    h.clock(1, -10);
    job.resolve(cart);
    await pending;
    expect(h.log.read(scope).entries[0].duration_ms).toBeUndefined();
  });
});

describe("allowlisted customer summaries", () => {
  it("describes only selected operations/counts, never free-form input", () => {
    expect(
      customerMcpInputSummary("apply_cart_changes", {
        commands: [
          { type: "add", quantity: 2, product_id: secret },
          { type: "update", line_id: secret, choices: { remove: [secret] } },
          { type: "remove", line_id: secret },
          { type: "meal", drink: secret },
        ],
      }),
    ).toBe("Add 2 items · Update 1 item · Remove 1 item · Convert 1 meal");
    for (const name of [
      "get_item_details",
      "request_staff_help",
      "submit_order",
      "cancel_draft_order",
    ] as const)
      expect(
        customerMcpInputSummary(name, {
          product_id: secret,
          concern: secret,
          quote_id: secret,
          reset_token: secret,
        }),
      ).not.toContain(secret);
  });

  it("does not render arbitrary result prose, IDs, product names or nested tokens", () => {
    const data = {
      ...cart,
      summary: secret,
      menu: { products: [{ name: secret }] },
      product: { name: secret },
      quote: { id: secret, snapshot: { totals: { total: 972 } } },
      control: { concern: secret },
    };
    for (const name of [
      "get_menu",
      "get_item_details",
      "get_cart",
      "apply_cart_changes",
      "prepare_order_review",
      "request_staff_help",
      "cancel_draft_order",
    ] as const)
      expect(customerMcpResultSummary(name, data)).not.toContain(secret);
  });

  it("preserves proposal/review/acceptance boundaries", () => {
    expect(
      customerMcpResultSummary("prepare_order_review", {
        quote: { approved: false, snapshot: { totals: { total: 972 } } },
      }),
    ).toBe("$9.72 · Review ready; customer approval required");
    expect(
      customerMcpResultSummary("prepare_order_review", {
        quote: { approved: true },
      }),
    ).toBe("Review ready; customer approval recorded");
    expect(
      customerMcpResultSummary("cancel_draft_order", { reset_token: secret }),
    ).toContain("draft unchanged until customer confirmation");
    expect(
      customerMcpResultSummary("submit_order", {
        order: { status: "submitted" },
      }),
    ).toContain("waiting for kitchen acceptance");
    expect(
      customerMcpResultSummary("submit_order", {
        order: { status: "unknown" },
      }),
    ).toContain("do not submit again");
    expect(customerMcpResultSummary("get_order_status", { order: null })).toBe(
      "No order submitted",
    );
  });

  it("marks an unresolved draft as needing clarification without copying the message", () => {
    expect(
      customerMcpResultSummary("apply_cart_changes", {
        ...cart,
        unresolved_choices: [{ message: secret }],
      }),
    ).toBe("Needs clarification · 3 items · $9.72");
  });

  it("does not format invalid or unbounded counts and monetary values", () => {
    expect(
      customerMcpResultSummary("get_cart", {
        lines: [{ quantity: secret }],
        totals: { total: Infinity },
      }),
    ).toBe("Draft read completed");
    expect(
      customerMcpResultSummary("get_cart", {
        lines: [],
        totals: { total: -972 },
      }),
    ).toBe("0 items");
    expect(
      customerMcpInputSummary("apply_cart_changes", {
        commands: new Array(21).fill({ type: "add", quantity: 10 }),
      }),
    ).toBe("Change current draft");
    expect(
      customerMcpResultSummary("get_order_status", {
        order: { status: secret },
      }),
    ).toBe("Check current order status");
  });
});

describe("opened customer MCP connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerMcpLog.clear(scope);
    mock.token.mockReturnValue("test-only-scoped-token");
  });
  it("does not record catalog/connection failures before an invocation", async () => {
    const error = Error("test-only connection failure");
    mock.open.mockRejectedValue(error);
    await expect(openCustomerMcp(scope, "voice")).rejects.toBe(error);
    expect(customerMcpLog.read(scope).entries).toEqual([]);
  });

  it("does not record a known tool missing from the discovered catalog", async () => {
    const error = new McpCallError(recoveryFor("UNKNOWN_TOOL", secret));
    const call = vi.fn(async () => {
      throw error;
    });
    mock.open.mockResolvedValue({
      call,
      close: vi.fn(async () => {}),
      tools: [{ name: "get_menu" }],
      client: {},
    });
    const wrapped = await openCustomerMcp(scope, "voice");
    await expect(wrapped.call("get_cart", {})).rejects.toBe(error);
    expect(call).toHaveBeenCalledExactlyOnceWith("get_cart", {});
    expect(customerMcpLog.read(scope).entries).toEqual([]);
  });

  it("preserves the MCP client/close/result and binds calls to the original scope", async () => {
    const ready = deferred();
    const call = vi.fn(async () => cart),
      close = vi.fn(async () => {}),
      client = { call, close, tools: [{ name: "get_cart" }], client: {} };
    mock.open.mockReturnValue(ready.promise);
    const mutable = { ...scope },
      opened = openCustomerMcp(mutable, "screen");
    mutable.session_id = randomUUID();
    ready.resolve(client);
    const wrapped = await opened;
    expect(mock.token).toHaveBeenCalledExactlyOnceWith(scope, "screen");
    expect(wrapped.client).toBe(client.client);
    expect(wrapped.close).toBe(close);
    expect(await wrapped.call("get_cart", {})).toBe(cart);
    expect(call).toHaveBeenCalledTimes(1);
    expect(customerMcpLog.read(scope).entries).toHaveLength(1);
    expect(customerMcpLog.read(mutable).entries).toEqual([]);
    await wrapped.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("signed MCP log provenance", () => {
  const actualAuth = () =>
    vi.importActual<typeof import("../../apps/runtime/src/auth.js")>(
      "../../apps/runtime/src/auth.js",
    );
  const request = (token: string) =>
    ({ headers: { authorization: `Bearer ${token}` } }) as Request;

  it.each(["voice", "screen", "fixture"] as const)(
    "signs and verifies the gateway's %s source for duplicate suppression",
    async (source) => {
      const auth = await actualAuth();
      const token = auth.agentToken(scope, source);
      expect(auth.verify(token).mcp_log_origin).toBe(source);
      expect(auth.mcpContext(request(token))).toEqual({
        scope: { ...scope, actor: "agent" },
        origin: source,
      });
      expect(auth.mcpScope(request(token))).toEqual({
        ...scope,
        actor: "agent",
      });
    },
  );

  it("keeps ordinary scoped clients external and ignores inherited reserved claims", async () => {
    const auth = await actualAuth();
    const extraScope = { ...scope, mcp_log_origin: "voice" };
    const token = auth.agentToken(extraScope);
    expect(auth.verify(token)).not.toHaveProperty("mcp_log_origin");
    expect(auth.mcpContext(request(token)).origin).toBe("external");
  });

  it("does not let unrecognized signed metadata suppress direct logging", async () => {
    const auth = await actualAuth();
    const token = auth.sign({
      ...scope,
      actor: "agent",
      aud: "mcp",
      exp: Date.now() + 60_000,
      mcp_log_origin: "mcp",
    });
    expect(auth.mcpContext(request(token)).origin).toBe("external");
  });

  it("rejects an unsigned source change instead of trusting the modified claim", async () => {
    const auth = await actualAuth();
    const token = auth.agentToken(scope);
    const data = { ...auth.verify(token), mcp_log_origin: "voice" };
    const modified = `${Buffer.from(JSON.stringify(data)).toString("base64url")}.${token.split(".")[1]}`;
    expect(() => auth.mcpContext(request(modified))).toThrow();
  });
});
