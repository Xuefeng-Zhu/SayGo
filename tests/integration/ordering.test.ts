import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { createServer, request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { store, config, transaction, RESTAURANT } from "@saygo/db";
import {
  beginInteraction,
  scopeForToken,
  tool,
  approve,
  getView,
  staffAction,
  resetDemo,
  updateProduct,
  kitchenTransition,
} from "@saygo/domain";
import {
  openMcp,
  runFixture,
  runOneJob,
  SandboxPos,
} from "@saygo/integrations";
import { app } from "../../apps/runtime/src/app.js";
import { agentToken, sign } from "../../apps/runtime/src/auth.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { seedProducts } from "../../packages/db/src/menu.js";
import {
  toolOutputSchemas,
  type Scope,
  type View,
  type ToolName,
} from "@saygo/contracts";
import golden from "../golden-utterances.json";
import { mcpEvaluations, evaluationXml } from "../mcp-evaluations.js";
import { inspectMcp } from "../inspector-check.js";
import { readFile, writeFile } from "node:fs/promises";
import { toolDataSchemas, type Product } from "@saygo/contracts";
const server = createServer(app);
let scope: Scope, token: string;
const v = (x: Record<string, unknown>) => x as unknown as View;
const add = () =>
  tool(scope, "apply_cart_changes", {
    expected_version: 0,
    request_id: randomUUID(),
    commands: [
      { type: "add", product_id: "cheeseburger", quantity: 1, choices: {} },
    ],
  });
async function review() {
  return v(
    await tool(scope, "prepare_order_review", {
      expected_version: (await getView(scope)).cart_version,
      request_id: randomUUID(),
    }),
  ).quote!;
}
async function submit() {
  const q = await review();
  await approve({ ...scope, actor: "customer" }, q.id);
  return v(await tool(scope, "submit_order", { quote_id: q.id }));
}
beforeAll(async () => {
  expect(config.DYNAMODB_NAMESPACE).toBe("saygo_test");
  expect(config.DYNAMODB_ENDPOINT).toBeTruthy();
  await new Promise<void>((r) =>
    server.listen(config.SAYGO_RUNTIME_PORT, "127.0.0.1", r),
  );
});
afterAll(async () => {
  await new Promise<void>((r, e) =>
    server.close((err) => (err ? e(err) : r())),
  );
  await store.close();
});
beforeEach(async () => {
  await resetDemo();
  await transaction(async (tx) => {
    for (const data of seedProducts)
      await tx.update("products", data.id, { data });
    await tx.update("restaurants", RESTAURANT, {
      pos_mode: "accept",
      menu_version: 1,
      price_version: 1,
    });
  });
  const started = await beginInteraction("lane-1");
  scope = { ...started.scope, actor: "agent" };
  token = started.token;
});
describe("DynamoDB, real MCP and durable ordering", () => {
  it("rolls back an interrupted multi-entity transaction", async () => {
    const before = await store.get("restaurants", RESTAURANT);
    await expect(
      transaction(async (tx) => {
        await tx.update("restaurants", RESTAURANT, { pos_mode: "reject" });
        tx.put("audit", {
          id: "rollback-test",
          session_id: scope.session_id,
          kind: "must-not-commit",
          details: {},
          created_at: new Date().toISOString(),
        });
        throw new Error("Interrupted before commit");
      }),
    ).rejects.toThrow("Interrupted");
    expect(await store.get("restaurants", RESTAURANT)).toEqual(before);
    expect(await store.get("audit", "rollback-test")).toBeNull();
  });
  it("serializes independent concurrent writes without losing updates", async () => {
    const start = (await store.get("restaurants", RESTAURANT))!.order_number;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        transaction(async (tx) => {
          const row = (await tx.get("restaurants", RESTAURANT))!;
          await tx.update("restaurants", RESTAURANT, {
            order_number: row.order_number + 1,
          });
        }),
      ),
    );
    expect((await store.get("restaurants", RESTAURANT))!.order_number).toBe(
      start + 8,
    );
  });
  it("resets more than 100 records with bounded batches and preserves menu and staff", async () => {
    const products = await store.list("products"),
      users = await store.list("staff_users");
    for (let batch = 0; batch < 2; batch++)
      await transaction(async (tx) => {
        for (let i = 0; i < 80; i++)
          tx.put("audit", {
            id: `bulk-${batch}-${i}`,
            session_id: scope.session_id,
            kind: "bulk-reset",
            details: {},
            created_at: new Date().toISOString(),
          });
      });
    await resetDemo();
    expect(await store.list("audit")).toEqual([]);
    expect(await store.list("interactions")).toEqual([]);
    expect(await store.list("products")).toEqual(products);
    expect(await store.list("staff_users")).toEqual(users);
    await expect(scopeForToken(token)).rejects.toThrow();
  });
  it("rejects reset during a live worker lease without leaving a maintenance fence", async () => {
    await add();
    await submit();
    const job = (await store.list("jobs"))[0];
    await store.update("jobs", job.id, {
      state: "leased",
      lease_token: randomUUID(),
      lease_until: new Date(Date.now() + 30000).toISOString(),
    });
    await expect(resetDemo()).rejects.toThrow("Wait for");
    expect((await getView(scope)).order).not.toBeNull();
    await store.update("jobs", job.id, { state: "pending", lease_until: null });
  });
  it.each(mcpEvaluations)(
    "verifies read-only guide evaluation: $id",
    async (item) => {
      const m = await openMcp(agentToken(scope));
      const before = await getView(scope);
      try {
        const { timing: _timing, ...menuResult } = await m.call("get_menu", {});
        const menu = toolDataSchemas.get_menu.parse(menuResult).menu;
        const products: Record<string, Product> = {};
        for (const id of item.products) {
          expect(menu.products.some((p) => p.id === id)).toBe(true);
          const { timing: _timing, ...details } = await m.call(
            "get_item_details",
            { product_id: id },
          );
          products[id] =
            toolDataSchemas.get_item_details.parse(details).product;
        }
        expect(item.solve(products)).toBe(item.answer);
        expect(await getView(scope)).toEqual(before);
        expect(await readFile("tests/mcp-evaluation.xml", "utf8")).toBe(
          evaluationXml(),
        );
      } finally {
        await m.close();
      }
    },
  );
  it.skipIf(process.env.SAYGO_INSPECTOR_TEST !== "1")(
    "passes independent Inspector initialization, strict discovery and a read-only call",
    async () => {
      const result = await inspectMcp(
        `http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/mcp`,
        agentToken(scope),
      );
      expect(result.initialized.result.protocolVersion).toBe("2025-11-25");
      expect(result.listed.result.tools).toHaveLength(9);
      const errors = (result.listed.schemaFindings ?? [])
        .flatMap((t: { findings: { severity: string }[] }) => t.findings)
        .filter((f: { severity: string }) => f.severity === "error");
      expect(errors).toEqual([]);
      expect(result.called.result.isError).toBe(false);
      expect(
        toolOutputSchemas.get_cart.parse(
          result.called.result.structuredContent,
        ),
      ).toMatchObject({
        result: { ok: true, data: { cart_version: 0, lines: [] } },
      });
      await writeFile(
        "docs/evidence/mcp-inspector.json",
        JSON.stringify(
          {
            measured_at: new Date().toISOString(),
            inspector_version: "2.10.1",
            protocol_version: result.initialized.result.protocolVersion,
            tools_discovered: result.listed.result.tools.length,
            strict_schema_findings: result.listed.schemaFindings ?? [],
            read_only_call: "get_cart",
            result_validated: true,
            scope:
              "Isolated saygo_test database on loopback; no OAuth or live provider calls.",
          },
          null,
          2,
        ) + "\n",
      );
    },
    60000,
  );
  const rpc = (body: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${agentToken(scope)}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
        ...headers,
      },
      body,
    });
  it("rejects malformed JSON, invalid envelopes, batches and oversized bodies without mutation or input echo", async () => {
    const change = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "apply_cart_changes",
        arguments: {
          expected_version: 0,
          request_id: randomUUID(),
          commands: [{ type: "add", product_id: "classic" }],
        },
      },
    };
    for (const [body, status, code] of [
      ['{"secret-marker":', 400, -32700],
      ['"secret-marker"', 400, -32600],
      [JSON.stringify({ secret: "secret-marker" }), 400, -32600],
      [JSON.stringify([change]), 400, -32600],
      [
        JSON.stringify({ secret: "secret-marker" + "x".repeat(65536) }),
        413,
        -32000,
      ],
    ] as const) {
      const response = await rpc(body);
      expect(response.status).toBe(status);
      const result = await response.json();
      expect(result).toMatchObject({
        jsonrpc: "2.0",
        id: null,
        error: { code },
      });
      expect(JSON.stringify(result)).not.toContain("secret-marker");
    }
    expect((await getView(scope)).cart_version).toBe(0);
  });
  it("validates transport headers and acknowledges notifications without a body", async () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    for (const [headers, status] of [
      [{ Accept: "application/json" }, 406],
      [{ "Content-Type": "text/plain" }, 415],
      [{ "MCP-Protocol-Version": "unknown" }, 400],
      [{ Origin: "https://invalid.example" }, 403],
    ] as [Record<string, string>, number][]) {
      expect((await rpc(request, headers)).status).toBe(status);
    }
    // Fetch implementations can replace Host. Use Node HTTP to send it literally.
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        `http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/mcp`,
        { headers: { Host: "attacker.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(badHost).toBe(403);
    const notification = await rpc(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe("");
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(
        `http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/mcp`,
        { method },
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });
  it("requires Bearer scheme, rejects invalid scope and audience, and accepts case-insensitive scheme", async () => {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    for (const auth of [
      agentToken(scope),
      `Basic ${agentToken(scope)}`,
      `Bearer ${sign({ aud: "mcp", exp: Date.now() + 60000 })}`,
      `Bearer ${sign([])}`,
    ]) {
      const response = await rpc(request, { Authorization: auth });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer realm="saygo-local"',
      );
      expect(await response.json()).toMatchObject({
        recovery: { code: "AUTH", next_action: "refresh_credentials" },
      });
    }
    expect(
      (await rpc(request, { Authorization: `bearer ${agentToken(scope)}` }))
        .status,
    ).toBe(200);
    expect(
      (
        await rpc(request, {
          Authorization: `Bearer ${sign({ ...scope, aud: "staff", exp: Date.now() + 60000 })}`,
        })
      ).status,
    ).toBe(403);
  });
  it("rejects unknown cursors, methods and tools as protocol errors, without advertising unsupported capabilities", async () => {
    const m = await openMcp(agentToken(scope));
    try {
      expect(m.client.getServerCapabilities()).toEqual({
        tools: { listChanged: false },
      });
      expect(m.client.getInstructions()).toContain("Customer confirmation");
      await expect(
        m.client.listTools({ cursor: "invented" }),
      ).rejects.toMatchObject({ code: -32602 });
      await expect(
        m.client.callTool({ name: "invented", arguments: {} }),
      ).rejects.toMatchObject({ code: -32602 });
      const response = await rpc(
        JSON.stringify({ jsonrpc: "2.0", id: 7, method: "resources/list" }),
      );
      expect(await response.json()).toMatchObject({
        id: 7,
        error: { code: -32601 },
      });
    } finally {
      await m.close();
    }
  });
  it("publishes descriptive input schemas that accept omitted defaults and strict outputs with explicit dialects", async () => {
    const m = await openMcp(agentToken(scope));
    try {
      const validator = new AjvJsonSchemaValidator();
      for (const tool of m.tools) {
        expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
        expect(tool.title).toBeTruthy();
        expect(tool.inputSchema.$schema).toBe(
          "http://json-schema.org/draft-07/schema#",
        );
        expect(tool.outputSchema?.$schema).toBe(
          "http://json-schema.org/draft-07/schema#",
        );
        expect(tool.annotations).toEqual(
          expect.objectContaining({
            readOnlyHint: expect.any(Boolean),
            destructiveHint: expect.any(Boolean),
            idempotentHint: expect.any(Boolean),
            openWorldHint: false,
          }),
        );
        for (const property of Object.values(tool.inputSchema.properties ?? {}))
          expect(property).toHaveProperty("description");
      }
      const inputSchema = m.tools.find(
        (t) => t.name === "apply_cart_changes",
      )!.inputSchema;
      const args = {
        expected_version: 0,
        request_id: randomUUID(),
        commands: [{ type: "add", product_id: "classic" }],
      };
      expect(validator.getValidator(inputSchema)(args).valid).toBe(true);
      expect(await m.call("apply_cart_changes", args)).toMatchObject({
        cart_version: 1,
        lines: [{ quantity: 1 }],
      });
    } finally {
      await m.close();
    }
  });
  it("advertises and validates every tool's compact success/error contract over HTTP", async () => {
    const m = await openMcp(agentToken(scope));
    const called = new Set<ToolName>();
    const call = async (name: ToolName, args: Record<string, unknown> = {}) => {
      const raw = await m.client.callTool({ name, arguments: args });
      const parsed = toolOutputSchemas[name].parse(raw.structuredContent);
      expect(raw.isError).toBe(false);
      expect(parsed.result.ok).toBe(true);
      expect(JSON.parse((raw.content as { text: string }[])[0].text)).toEqual(
        raw.structuredContent,
      );
      called.add(name);
      return parsed.result.ok ? parsed.result.data : expect.unreachable();
    };
    try {
      for (const t of m.tools) {
        expect(t.outputSchema?.additionalProperties).toBe(false);
        expect(t.outputSchema?.required).toEqual(["result"]);
      }
      const reviewTool = m.tools.find(
        (t) => t.name === "prepare_order_review",
      )!;
      expect(reviewTool.inputSchema.required).toContain("request_id");
      expect(reviewTool.annotations?.idempotentHint).toBe(true);
      await call("get_menu");
      await call("get_item_details", { product_id: "cheeseburger" });
      await call("apply_cart_changes", {
        expected_version: 0,
        request_id: randomUUID(),
        commands: [
          { type: "add", product_id: "cheeseburger", quantity: 1, choices: {} },
        ],
      });
      const cart = await call("get_cart");
      expect(cart).not.toHaveProperty("menu");
      expect(cart).not.toHaveProperty("cart");
      expect(cart).not.toHaveProperty("session");
      expect(JSON.stringify(cart).length).toBeLessThan(
        JSON.stringify(await getView(scope)).length / 2,
      );
      await call("cancel_draft_order", { expected_version: 1 });
      await call("prepare_order_review", {
        expected_version: 1,
        request_id: randomUUID(),
      });
      const quote = (await getView(scope)).quote!;
      await approve({ ...scope, actor: "customer" }, quote.id);
      await call("submit_order", { quote_id: quote.id });
      const status = await call("get_order_status");
      expect(Object.keys(status).sort()).toEqual(["order", "summary"]);
      expect(status).not.toHaveProperty("order.snapshot");
      await call("request_staff_help", {
        reason: "allergy",
        concern: "Restricted test concern",
      });
      expect(called.size).toBe(9);
    } finally {
      await m.close();
    }
  });
  it("concurrent review retries reuse one quote and preserve its expiry and approval", async () => {
    await add();
    const m = await openMcp(agentToken(scope));
    try {
      const args = { expected_version: 1, request_id: randomUUID() };
      const results = await Promise.all(
        Array.from({ length: 4 }, () => m.call("prepare_order_review", args)),
      );
      const quotes = results.map((r) => r.quote as View["quote"]);
      expect(new Set(quotes.map((q) => q!.id)).size).toBe(1);
      expect(new Set(quotes.map((q) => q!.expires_at)).size).toBe(1);
      await approve({ ...scope, actor: "customer" }, quotes[0]!.id);
      expect(await m.call("prepare_order_review", args)).toMatchObject({
        quote: {
          id: quotes[0]!.id,
          expires_at: quotes[0]!.expires_at,
          approved: true,
        },
      });
      expect((await store.list("quotes")).length).toBe(1);
    } finally {
      await m.close();
    }
  });
  it("a lost review response can be retried by a fresh MCP client without renewing the quote", async () => {
    await add();
    const m = await openMcp(agentToken(scope));
    const args = { expected_version: 1, request_id: randomUUID() };
    const realFetch = globalThis.fetch;
    let dropped = false;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const response = await realFetch(input, init);
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (
          !dropped &&
          body.method === "tools/call" &&
          body.params.name === "prepare_order_review"
        ) {
          dropped = true;
          await response.text();
          throw new TypeError("Injected lost response after commit");
        }
        return response;
      });
    try {
      await expect(m.call("prepare_order_review", args)).rejects.toMatchObject({
        recovery: {
          code: "TRANSPORT_ERROR",
          retryable: false,
          next_action: "refresh_cart",
        },
      });
    } finally {
      fetchSpy.mockRestore();
      await m.close();
    }
    expect(dropped).toBe(true);
    const original = (await getView(scope)).quote!;
    const fresh = await openMcp(agentToken(scope));
    try {
      expect(await fresh.call("prepare_order_review", args)).toMatchObject({
        quote: { id: original.id, expires_at: original.expires_at },
      });
      expect((await store.list("quotes")).length).toBe(1);
    } finally {
      await fresh.close();
    }
  });
  it("does not resurrect an expired review or accept changed arguments under its request ID", async () => {
    await add();
    const m = await openMcp(agentToken(scope));
    try {
      const args = { expected_version: 1, request_id: randomUUID() };
      await m.call("prepare_order_review", args);
      const original = (await getView(scope)).quote!;
      await expect(
        m.call("prepare_order_review", { ...args, expected_version: 2 }),
      ).rejects.toMatchObject({
        recovery: { code: "IDEMPOTENCY_MISMATCH", retryable: false },
      });
      await store.update("quotes", original.id, {
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      await expect(m.call("prepare_order_review", args)).rejects.toMatchObject({
        recovery: {
          code: "STALE_QUOTE",
          next_action: "review_order",
          retryable: false,
        },
      });
      expect((await getView(scope)).quote).toBeNull();
      const renewed = await m.call("prepare_order_review", {
        ...args,
        request_id: randomUUID(),
      });
      expect(renewed).toMatchObject({ quote: { approved: false } });
      expect((renewed.quote as View["quote"])!.id).not.toBe(original.id);
    } finally {
      await m.close();
    }
  });
  it("invalidated reviews stay invalid after cart or menu changes", async () => {
    await add();
    const args = { expected_version: 1, request_id: randomUUID() };
    await tool(scope, "prepare_order_review", args);
    await updateProduct("cheeseburger", { variants: { regular: 700 } });
    await expect(
      tool(scope, "prepare_order_review", args),
    ).rejects.toMatchObject({ code: "STALE_QUOTE" });
    const next = { expected_version: 1, request_id: randomUUID() };
    await tool(scope, "prepare_order_review", next);
    await tool(scope, "apply_cart_changes", {
      expected_version: 1,
      request_id: randomUUID(),
      commands: [
        { type: "add", product_id: "classic", quantity: 1, choices: {} },
      ],
    });
    await expect(
      tool(scope, "prepare_order_review", next),
    ).rejects.toMatchObject({ code: "STALE_QUOTE" });
    expect((await getView(scope)).quote).toBeNull();
  });
  it("returns actionable errors for invalid arguments, stale carts, missing consent and ownership fences", async () => {
    const m = await openMcp(agentToken(scope));
    try {
      const bad = await m.client.callTool({
        name: "get_item_details",
        arguments: { secret: "MUST-NOT-ECHO" },
      });
      expect(bad.isError).toBe(true);
      expect(bad.structuredContent).toMatchObject({
        result: {
          ok: false,
          error: {
            code: "INVALID_ARGUMENTS",
            next_action: "correct_arguments",
            retryable: false,
          },
        },
      });
      expect(JSON.stringify(bad)).not.toContain("MUST-NOT-ECHO");
      await add();
      await expect(
        m.call("apply_cart_changes", {
          expected_version: 0,
          request_id: randomUUID(),
          commands: [
            { type: "add", product_id: "classic", quantity: 1, choices: {} },
          ],
        }),
      ).rejects.toMatchObject({
        recovery: {
          code: "VERSION_CONFLICT",
          next_action: "refresh_cart",
          retryable: false,
        },
      });
      const q = await review();
      await expect(
        m.call("submit_order", { quote_id: q.id }),
      ).rejects.toMatchObject({
        recovery: {
          code: "CONSENT_REQUIRED",
          next_action: "confirm_order",
          retryable: false,
        },
      });
      const reset = await m.call("cancel_draft_order", { expected_version: 1 });
      await expect(
        m.call("cancel_draft_order", {
          expected_version: 1,
          reset_token: reset.reset_token,
        }),
      ).rejects.toMatchObject({
        recovery: { code: "RESET_CONSENT", next_action: "confirm_reset" },
      });
      await staffAction({ ...scope, actor: "staff" }, "takeover");
      await expect(
        m.call("prepare_order_review", {
          expected_version: 1,
          request_id: randomUUID(),
        }),
      ).rejects.toMatchObject({
        recovery: {
          code: "FENCED",
          next_action: "wait_for_staff",
          retryable: false,
        },
      });
    } finally {
      await m.close();
    }
  });
  it("a superseded worker cannot overwrite a newer lease result", async () => {
    await add();
    await submit();
    let arrived!: () => void;
    const entered = new Promise<void>((r) => {
      arrived = r;
    });
    let release!: (value: { status: "rejected" }) => void;
    const late = new Promise<{ status: "rejected" }>((r) => {
      release = r;
    });
    const first = runOneJob({
      lookup: async () => null,
      submit: async () => {
        arrived();
        return late;
      },
    });
    await entered;
    for (const job of await store.list("jobs"))
      await store.update("jobs", job.id, {
        lease_until: new Date(Date.now() - 1000).toISOString(),
      });
    await runOneJob();
    release({ status: "rejected" });
    await first;
    expect((await getView(scope)).order?.status).toBe("accepted");
  });
  it("matches the golden structured utterance dataset through MCP", async () => {
    const m = await openMcp(agentToken(scope));
    try {
      for (const item of golden) {
        await runFixture(item.utterance, m.call);
        const state = await getView(scope);
        expect(state.totals.total).toBe(item.expected.total_cents);
        if (item.expected.product_ids) {
          expect(state.lines.map((l) => l.product_id)).toEqual(
            item.expected.product_ids,
          );
          expect(state.lines.map((l) => l.quantity)).toEqual(
            item.expected.quantity,
          );
          expect(state.lines.map((l) => l.choices.remove ?? [])).toEqual(
            item.expected.removals,
          );
          expect(state.lines.map((l) => l.variant)).toEqual(
            item.expected.variants,
          );
        }
        if (item.expected.issues) {
          expect(state.unresolved_choices.map((i) => i.code)).toEqual(
            item.expected.issues,
          );
          expect(state.lines).toHaveLength(item.expected.line_count!);
        }
      }
    } finally {
      await m.close();
    }
  });
  it("concurrent conflicting mutations serialize; exactly one expected version wins", async () => {
    const command = {
      type: "add",
      product_id: "classic",
      quantity: 1,
      choices: {},
    };
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        tool(scope, "apply_cart_changes", {
          expected_version: 0,
          request_id: randomUUID(),
          commands: [command],
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getView(scope)).cart_version).toBe(1);
  });
  it("rejects forged/expired bearer, cross-origin writes, and crew admin actions", async () => {
    const base = `http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}`;
    const body = JSON.stringify({
      username: "crew",
      password: "harbor-demo-only",
    });
    const cross = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: {
        Origin: "https://invalid.example",
        "Content-Type": "application/json",
      },
      body,
    });
    expect(cross.status).toBe(403);
    const logged = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: {
        Origin: config.SAYGO_WEB_ORIGIN,
        "Content-Type": "application/json",
      },
      body,
    });
    expect(logged.status).toBe(200);
    const cookie = logged.headers.get("set-cookie")!.split(";")[0];
    const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
    const identity = await me.json();
    expect(me.status).toBe(200);
    expect(Object.keys(identity).sort()).toEqual(["id", "restaurant_id", "role"]);
    expect(identity.role).toBe("crew");
    const admin = await fetch(`${base}/api/admin`, {
      headers: { Cookie: cookie },
    });
    expect(admin.status).toBe(403);
    const forged = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer forged.bad",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(forged.status).toBe(401);
    expect((await fetch(`${base}/api/kitchen`)).status).toBe(401);
  });
  it("negotiates MCP 2025-11-25, discovers nine tools and calls get_cart", async () => {
    const response = await fetch(
      `http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/mcp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${agentToken(scope)}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "protocol-test", version: "1" },
          },
        }),
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).result.protocolVersion).toBe("2025-11-25");
    const m = await openMcp(agentToken(scope));
    try {
      expect(m.tools).toHaveLength(9);
      expect((await m.call("get_cart", {})).cart_version).toBe(0);
    } finally {
      await m.close();
    }
  });
  it("runs multi-item utterance and correction through actual HTTP MCP", async () => {
    const m = await openMcp(agentToken(scope));
    try {
      await runFixture("first", m.call);
      const first = await getView(scope);
      await runFixture("correct", m.call);
      const final = await getView(scope);
      expect(final.lines).toHaveLength(3);
      expect(final.lines.map((l) => l.id)).toEqual(
        first.lines.map((l) => l.id),
      );
      expect(final.lines[1].modifiers).toEqual(["No onions", "No cheese"]);
      expect(final.lines[2].variant).toBe("large");
      expect(final.totals.total).toBe(1809);
    } finally {
      await m.close();
    }
  });
  it("keeps cart and pending ambiguity through side questions", async () => {
    const m = await openMcp(agentToken(scope));
    try {
      await runFixture("first", m.call);
      await runFixture("meal", m.call);
      const before = await getView(scope);
      await runFixture("side", m.call);
      expect((await getView(scope)).cart).toEqual(before.cart);
      await expect(review()).rejects.toThrow("Which item");
    } finally {
      await m.close();
    }
  });
  it("required choices block quote until completed", async () => {
    const result = v(
      await tool(scope, "apply_cart_changes", {
        expected_version: 0,
        request_id: randomUUID(),
        commands: [
          { type: "add", product_id: "tenders", quantity: 1, choices: {} },
        ],
      }),
    );
    await expect(review()).rejects.toThrow("dip");
    await tool(scope, "apply_cart_changes", {
      expected_version: 1,
      request_id: randomUUID(),
      commands: [
        {
          type: "update",
          line_id: result.lines[0].id,
          choices: { dip: ["ranch"] },
        },
      ],
    });
    expect((await review()).snapshot.lines[0].modifiers).toContain("Ranch");
  });
  it("blocks model self-approval and missing consent", async () => {
    await add();
    const q = await review();
    await expect(approve(scope, q.id)).rejects.toThrow("customer");
    await expect(
      tool(scope, "submit_order", { quote_id: q.id }),
    ).rejects.toThrow("Confirm order");
  });
  it("invalidates consent on any cart mutation", async () => {
    await add();
    const q = await review();
    await approve({ ...scope, actor: "customer" }, q.id);
    const state = await getView(scope);
    await tool(scope, "apply_cart_changes", {
      expected_version: state.cart_version,
      request_id: randomUUID(),
      commands: [
        {
          type: "update",
          line_id: state.lines[0].id,
          choices: { remove: ["onions"] },
        },
      ],
    });
    await expect(
      tool(scope, "submit_order", { quote_id: q.id }),
    ).rejects.toThrow("quote");
  });
  it("invalidates on stock/price change and never substitutes", async () => {
    await add();
    const q = await review();
    await approve({ ...scope, actor: "customer" }, q.id);
    await updateProduct("cheeseburger", { available: false });
    await expect(
      tool(scope, "submit_order", { quote_id: q.id }),
    ).rejects.toThrow();
    const state = await getView(scope);
    expect(state.quote).toBeNull();
    expect(state.lines[0].product_id).toBe("cheeseburger");
    expect(state.unresolved_choices[0].code).toBe("unavailable");
    await updateProduct("cheeseburger", {
      available: true,
      variants: { regular: 700 },
    });
    expect((await review()).snapshot.totals.subtotal).toBe(700);
  });
  it("one approval, concurrent duplicates, one logical order, one POS receipt", async () => {
    await add();
    const q = await review();
    await approve({ ...scope, actor: "customer" }, q.id);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        tool(scope, "submit_order", { quote_id: q.id }),
      ),
    );
    expect(new Set(results.map((r) => v(r).order!.id)).size).toBe(1);
    await Promise.all([runOneJob(), runOneJob()]);
    expect((await store.list("orders")).length).toBe(1);
    expect((await store.list("pos_receipts")).length).toBe(1);
    expect((await getView(scope)).order?.status).toBe("accepted");
  });
  it("reconciles timeout after acceptance with same key and no second submit", async () => {
    await store.update("restaurants", RESTAURANT, { pos_mode: "unknown" });
    await add();
    await submit();
    await runOneJob();
    expect((await getView(scope)).order?.status).toBe("unknown");
    for (const row of await store.list("pos_receipts"))
      await store.update("pos_receipts", row.external_key, {
        visible_at: new Date().toISOString(),
      });
    for (const row of await store.list("jobs"))
      await store.update("jobs", row.id, {
        available_at: new Date().toISOString(),
      });
    await runOneJob();
    expect((await getView(scope)).order?.status).toBe("accepted");
    expect((await store.list("pos_receipts")).length).toBe(1);
    expect(
      (
        await store.list(
          "pos_attempts",
          (p) => p.operation === "lookup" && p.outcome === "accepted",
        )
      ).length,
    ).toBe(1);
  });
  it("reclaims an expired worker lease after a restart", async () => {
    await add();
    await submit();
    for (const row of await store.list("jobs"))
      await store.update("jobs", row.id, {
        state: "leased",
        lease_until: new Date(Date.now() - 1000).toISOString(),
        lease_token: randomUUID(),
      });
    expect(await runOneJob()).toBe(true);
    expect((await getView(scope)).order?.status).toBe("accepted");
  });
  it("rejects payload mismatch at the POS idempotency boundary", async () => {
    const pos = new SandboxPos();
    await pos.submit("test-key", "hash-a");
    await expect(pos.submit("test-key", "hash-b")).rejects.toThrow("mismatch");
  });
  it("fences a late AI mutation after staff takeover; preserves newest cart", async () => {
    await add();
    await staffAction({ ...scope, actor: "staff" }, "takeover");
    await expect(
      tool(scope, "apply_cart_changes", {
        expected_version: 1,
        request_id: randomUUID(),
        commands: [
          { type: "add", product_id: "classic", quantity: 1, choices: {} },
        ],
      }),
    ).rejects.toThrow("stopped");
    const current = await getView({ ...scope, actor: "customer" });
    expect(current.lines).toHaveLength(1);
    expect(current.session.owner).toBe("staff");
    expect(current.session.fence).toBe(1);
  });
  it("allergy pauses approval, protects concern and requires staff resolution", async () => {
    await add();
    await tool(scope, "request_staff_help", {
      reason: "allergy",
      concern: "Sensitive fictional test concern",
    });
    const customer = { ...scope, actor: "customer" as const };
    expect(JSON.stringify(await getView(customer))).not.toContain(
      "Sensitive fictional",
    );
    await expect(
      tool(customer, "prepare_order_review", {
        expected_version: 1,
        request_id: randomUUID(),
      }),
    ).rejects.toThrow("Staff");
    await staffAction({ ...scope, actor: "staff" }, "takeover");
    await staffAction({ ...scope, actor: "staff" }, "resolve");
    await staffAction({ ...scope, actor: "staff" }, "release");
    const fresh = await scopeForToken(token);
    expect(
      v(
        await tool({ ...fresh, actor: "agent" }, "prepare_order_review", {
          expected_version: 1,
          request_id: randomUUID(),
        }),
      ).quote,
    ).not.toBeNull();
  });
  it("new vehicle revokes prior access but preserves accepted kitchen ticket", async () => {
    await add();
    await submit();
    await runOneJob();
    const next = await beginInteraction("lane-1");
    await expect(scopeForToken(token)).rejects.toThrow();
    await expect(getView(scope)).rejects.toThrow("ended");
    expect((await getView(next.scope)).lines).toEqual([]);
    expect(
      (await store.list("orders", (o) => o.status === "accepted")).length,
    ).toBe(1);
  });
  it("denies cross-session, cross-restaurant and unauthenticated MCP", async () => {
    await expect(
      getView({ ...scope, restaurant_id: "another" }),
    ).rejects.toThrow("restaurant");
    await expect(
      getView({ ...scope, session_id: randomUUID() }),
    ).rejects.toThrow("ended");
    const res = await fetch(
      `http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/mcp`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    expect(res.status).toBe(401);
  });
  it("stale versions fail; duplicate mutation keys do not re-add and mismatches fail", async () => {
    const args = {
      expected_version: 0,
      request_id: randomUUID(),
      commands: [
        { type: "add", product_id: "classic", quantity: 1, choices: {} },
      ],
    };
    await tool(scope, "apply_cart_changes", args);
    await tool(scope, "apply_cart_changes", args);
    expect((await getView(scope)).lines).toHaveLength(1);
    await expect(
      tool(scope, "apply_cart_changes", {
        ...args,
        commands: [
          { type: "add", product_id: "double", quantity: 1, choices: {} },
        ],
      }),
    ).rejects.toThrow("different");
    await expect(
      tool(scope, "apply_cart_changes", { ...args, request_id: randomUUID() }),
    ).rejects.toThrow("changed");
  });
  it("expired quotes, pending voice and model reset tokens are rejected", async () => {
    await add();
    const q = await review();
    await store.update("interactions", scope.session_id, {
      voice_until: new Date(Date.now() + 20000).toISOString(),
    });
    await expect(
      approve({ ...scope, actor: "customer" }, q.id),
    ).rejects.toThrow("Stop voice");
    await store.update("interactions", scope.session_id, { voice_until: null });
    for (const row of await store.list("quotes"))
      await store.update("quotes", row.id, {
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
    await expect(
      approve({ ...scope, actor: "customer" }, q.id),
    ).rejects.toThrow("expired");
    const reset = await tool(scope, "cancel_draft_order", {
      expected_version: 1,
    });
    await expect(
      tool(scope, "cancel_draft_order", {
        expected_version: 1,
        reset_token: reset.reset_token,
      }),
    ).rejects.toThrow("customer");
  });
  it("enforces kitchen transitions; submitted order is not accepted", async () => {
    await add();
    const state = await submit();
    expect(state.order?.status).toBe("submitted");
    await expect(kitchenTransition(state.order!.id, "ready")).rejects.toThrow();
    await runOneJob();
    await kitchenTransition(state.order!.id, "preparing");
    await kitchenTransition(state.order!.id, "ready");
    expect((await getView(scope)).order?.status).toBe("ready");
    await expect(
      tool(scope, "apply_cart_changes", {
        expected_version: 1,
        request_id: randomUUID(),
        commands: [{ type: "remove", line_id: state.lines[0].id }],
      }),
    ).rejects.toThrow("submitted");
  });
});
