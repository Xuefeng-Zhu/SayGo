import express from "express";
import { z } from "zod";
import { store, config, RESTAURANT, transaction } from "@saygo/db";
import {
  DomainError,
  assert,
  beginInteraction,
  endInteraction,
  getView,
  getMealSavings,
  applyMealSavings,
  undoCartChange,
  activeScope,
  approve,
  staffAction,
  updateProduct,
  kitchenTransition,
  tool,
  resetDemo,
} from "@saygo/domain";
import {
  recoveryFor,
  toolSchemas,
  type ToolName,
  type Scope,
} from "@saygo/contracts";
import {
  openMcp,
  runFixture,
  fixtures,
  McpCallError,
} from "@saygo/integrations";
import { agentToken, laneScope, login, setCookie, staff } from "./auth.js";
import { handleMcp } from "./mcp.js";
import { stopVoice } from "./voice.js";
export const app = express();
app.disable("x-powered-by");
const rates = new Map<string, { count: number; until: number }>();
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const host = req.headers.host ?? "";
  const hosts = [
    `localhost:${config.SAYGO_RUNTIME_PORT}`,
    `127.0.0.1:${config.SAYGO_RUNTIME_PORT}`,
    new URL(config.SAYGO_WEB_ORIGIN).host,
  ];
  if (!hosts.includes(host)) {
    res.status(403).json({ error: "Host not allowed" });
    return;
  }
  if (req.headers.origin && req.headers.origin !== config.SAYGO_WEB_ORIGIN) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  if (
    req.method === "POST" &&
    req.path !== "/mcp" &&
    req.headers.origin !== config.SAYGO_WEB_ORIGIN
  ) {
    res.status(403).json({ error: "Same-origin action required" });
    return;
  }
  if (req.method === "POST") {
    const key = `${req.socket.remoteAddress}:${req.path === "/api/login" ? "login" : "write"}`;
    const now = Date.now();
    let r = rates.get(key);
    if (!r || r.until < now) {
      r = { count: 0, until: now + 60000 };
      rates.set(key, r);
    }
    if (++r.count > (req.path === "/api/login" ? 20 : 240)) {
      const retryAfter = Math.max(1, Math.ceil((r.until - now) / 1000));
      res
        .status(429)
        .set("Retry-After", String(retryAfter))
        .json({
          error: "Please wait before trying again.",
          recovery: {
            code: "RATE_LIMITED",
            message:
              "Please wait before trying again. Preserve the original request identity and check canonical state before retrying writes.",
            retryable: false,
            next_action: "wait_then_retry",
            retry_after_ms: retryAfter * 1000,
          },
        });
      return;
    }
    if (rates.size > 10000)
      for (const [k, v] of rates) if (v.until < now) rates.delete(k);
  }
  next();
});
// Parse MCP separately so JSON syntax failures keep JSON-RPC error semantics.
// strict:false lets valid JSON primitives reach the protocol envelope validator.
app.post("/mcp", express.json({ limit: "64kb", strict: false }), handleMcp);
app.all("/mcp", (_req, res) => {
  res.set("Allow", "POST").status(405).end();
});
app.use(express.json({ limit: "64kb" }));
app.get("/health", async (_req, res) => {
  await store.health();
  res.json({
    ok: true,
    pos: "sandbox",
    voice: config.SAYGO_VOICE_ENABLED === "true",
  });
});
app.get("/api/config", (_req, res) => {
  res.json({
    demo: config.SAYGO_DEMO === "true",
    voice: config.SAYGO_VOICE_ENABLED === "true",
    voice_url: `${config.SAYGO_WEB_ORIGIN.startsWith("https:") ? "wss" : "ws"}://${new URL(config.SAYGO_WEB_ORIGIN).hostname}:${config.SAYGO_RUNTIME_PORT}/voice`,
    fixtures,
  });
});
app.post("/api/login", async (req, res) => {
  const a = z
    .object({ username: z.string().max(60), password: z.string().max(200) })
    .strict()
    .parse(req.body);
  setCookie(res, "saygo_staff", await login(a.username, a.password), 8 * 3600);
  res.json({ ok: true });
});
app.post("/api/logout", async (req, res) => {
  await staff(req);
  setCookie(res, "saygo_staff", "", 0);
  res.json({ ok: true });
});
app.get("/api/me", async (req, res) => {
  res.json(await staff(req));
});
app.post("/api/lane/start", async (req, res) => {
  await staff(req, ["admin", "crew"]);
  const a = z
    .object({ lane_id: z.literal("lane-1") })
    .strict()
    .parse(req.body);
  const result = await beginInteraction(a.lane_id);
  setCookie(res, "saygo_lane", result.token);
  res.json(await getView(result.scope));
});
app.post("/api/lane/depart", async (req, res) => {
  await staff(req, ["admin", "crew"]);
  const scope = await laneScope(req);
  await endInteraction(scope);
  setCookie(res, "saygo_lane", "", 0);
  res.json({ ok: true });
});
app.get("/api/lane/state", async (req, res) => {
  res.json(await getView(await laneScope(req)));
});
app.get("/api/lane/meal-savings", async (req, res) => {
  res.json(await getMealSavings(await laneScope(req)));
});
app.post("/api/lane/meal-savings/apply", async (req, res) => {
  const a = z
    .object({
      proposal_id: z.string().regex(/^[a-f0-9]{64}$/),
      expected_version: z.number().int().nonnegative(),
      request_id: z.string().uuid(),
    })
    .strict()
    .parse(req.body);
  res.json(await applyMealSavings(await laneScope(req), a));
});
app.post("/api/lane/undo", async (req, res) => {
  const a = z
    .object({
      receipt_id: z.string().uuid(),
      expected_version: z.number().int().nonnegative(),
      request_id: z.string().uuid(),
    })
    .strict()
    .parse(req.body);
  res.json(await undoCartChange(await laneScope(req), a));
});
// Every customer conversational action crosses HTTP MCP initialize -> list -> call.
async function laneResult(scope: Scope, result: Record<string, unknown>) {
  // Canonical UI state is fetched separately; never spread arbitrary model/tool
  // data into it. Compact MCP responses cannot remove menu or consent UI fields.
  return {
    ...(await getView(scope)),
    ...(typeof result.summary === "string" ? { summary: result.summary } : {}),
    ...(typeof result.reset_token === "string"
      ? { reset_token: result.reset_token }
      : {}),
    ...(result.timing ? { timing: result.timing } : {}),
  };
}
app.post("/api/lane/tool", async (req, res) => {
  const a = z
    .object({
      name: z.enum(Object.keys(toolSchemas) as [ToolName, ...ToolName[]]),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(req.body);
  assert(
    a.name !== "cancel_draft_order" || !a.arguments.reset_token,
    "RESET",
    "Use the customer reset confirmation action.",
    403,
  );
  const scope = await laneScope(req);
  if (["prepare_order_review", "request_staff_help"].includes(a.name))
    await stopVoice(scope.session_id);
  const mcp = await openMcp(agentToken(scope));
  try {
    res.json(await laneResult(scope, await mcp.call(a.name, a.arguments)));
  } finally {
    await mcp.close();
  }
});
app.post("/api/lane/fixture", async (req, res) => {
  assert(
    config.SAYGO_DEMO === "true",
    "DEMO_DISABLED",
    "Fixture mode is disabled.",
    403,
  );
  const a = z
    .object({ text: z.string().max(500) })
    .strict()
    .parse(req.body);
  const scope = await laneScope(req),
    mcp = await openMcp(agentToken(scope));
  try {
    res.json(await laneResult(scope, await runFixture(a.text, mcp.call)));
  } finally {
    await mcp.close();
  }
});
app.post("/api/lane/confirm", async (req, res) => {
  const a = z.object({ quote_id: z.string().uuid() }).strict().parse(req.body);
  const scope = await laneScope(req);
  await approve(scope, a.quote_id);
  const mcp = await openMcp(agentToken(scope));
  try {
    res.json(
      await laneResult(
        scope,
        await mcp.call("submit_order", { quote_id: a.quote_id }),
      ),
    );
  } finally {
    await mcp.close();
  }
});
app.post("/api/lane/reset", async (req, res) => {
  const a = toolSchemas.cancel_draft_order.parse(req.body);
  assert(a.reset_token, "RESET", "Request a reset proposal first.", 400);
  res.json(await tool(await laneScope(req), "cancel_draft_order", a));
});
app.get("/api/crew", async (req, res) => {
  await staff(req, ["admin", "crew"]);
  const scope = await activeScope();
  const view = scope ? await getView(scope) : null;
  const handoffs = scope
    ? (
        await store.list("handoffs", (h) => h.session_id === scope.session_id)
      ).sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];
  res.json({ view, handoffs });
});
app.post("/api/crew/action", async (req, res) => {
  await staff(req, ["admin", "crew"]);
  const a = z
    .object({
      session_id: z.string().uuid(),
      action: z.enum(["takeover", "release", "resolve", "message"]),
      message: z.string().max(300).optional(),
    })
    .strict()
    .parse(req.body);
  const scope = await activeScope();
  assert(
    scope && scope.session_id === a.session_id,
    "SESSION",
    "This customer has departed. Refresh.",
  );
  res.json(await staffAction(scope, a.action, a.message));
});
app.post("/api/crew/cart", async (req, res) => {
  await staff(req, ["admin", "crew"]);
  const a = z
    .object({
      session_id: z.string().uuid(),
      changes: toolSchemas.apply_cart_changes,
    })
    .strict()
    .parse(req.body);
  const scope = await activeScope();
  assert(
    scope && scope.session_id === a.session_id,
    "SESSION",
    "This customer has departed.",
  );
  res.json(await tool(scope, "apply_cart_changes", a.changes));
});
app.get("/api/kitchen", async (req, res) => {
  await staff(req);
  res.json({
    orders: (
      await store.list(
        "orders",
        (o) =>
          o.restaurant_id === RESTAURANT &&
          ["accepted", "preparing", "ready"].includes(o.status),
      )
    )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(({ id, number, status, snapshot, created_at, updated_at }) => ({
        id,
        number,
        status,
        snapshot,
        created_at,
        updated_at,
      })),
  });
});
app.post("/api/kitchen/transition", async (req, res) => {
  await staff(req, ["admin", "kitchen"]);
  const a = z
    .object({
      order_id: z.string().uuid(),
      status: z.enum(["preparing", "ready", "handed_off"]),
    })
    .strict()
    .parse(req.body);
  await kitchenTransition(a.order_id, a.status);
  res.json({ ok: true });
});
app.get("/api/admin", async (req, res) => {
  await staff(req, ["admin"]);
  res.json(
    await transaction(async (tx) => {
      const products = (await tx.list("products"))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((r) => r.data);
      const restaurant = (await tx.get("restaurants", RESTAURANT))!;
      const settings = {
        instructions: restaurant.instructions,
        upsell_enabled: restaurant.upsell_enabled,
        pos_mode: restaurant.pos_mode,
      };
      const users = (await tx.list("staff_users")).map(
        ({ id, role, enabled }) => ({ id, role, enabled }),
      );
      return { products, settings, users };
    }),
  );
});
const group = z.object({
  label: z.string().max(60),
  min: z.number().int().min(0),
  max: z.number().int().min(0).max(8),
  options: z.record(
    z.string(),
    z.object({
      label: z.string().max(60),
      price: z.number().int().min(0).max(50000),
    }),
  ),
});
app.post("/api/admin/product", async (req, res) => {
  await staff(req, ["admin"]);
  const a = z
    .object({
      id: z.string(),
      patch: z
        .object({
          available: z.boolean().optional(),
          variants: z.record(z.string(), z.number().int()).optional(),
          groups: z.record(z.string(), group).optional(),
        })
        .strict(),
    })
    .strict()
    .parse(req.body);
  res.json(await updateProduct(a.id, a.patch));
});
app.post("/api/admin/settings", async (req, res) => {
  await staff(req, ["admin"]);
  const a = z
    .object({
      instructions: z.string().min(1).max(300),
      upsell_enabled: z.boolean(),
    })
    .strict()
    .parse(req.body);
  await store.update("restaurants", RESTAURANT, a);
  res.json({ ok: true });
});
app.post("/api/admin/user", async (req, res) => {
  await staff(req, ["admin"]);
  const a = z
    .object({ id: z.enum(["crew", "kitchen"]), enabled: z.boolean() })
    .strict()
    .parse(req.body);
  await store.update("staff_users", a.id, { enabled: a.enabled });
  res.json({ ok: true });
});
app.post("/api/demo", async (req, res) => {
  await staff(req, ["admin"]);
  assert(
    config.SAYGO_DEMO === "true",
    "DEMO_DISABLED",
    "Demo controls are disabled.",
    403,
  );
  const a = z
    .object({
      action: z.enum([
        "accept",
        "reject",
        "delay",
        "unknown",
        "retry",
        "reset",
      ]),
      confirmation: z.string().optional(),
    })
    .strict()
    .parse(req.body);
  if (a.action === "retry") {
    for (const job of await store.list("jobs", (j) => j.state === "pending"))
      await store.update("jobs", job.id, {
        available_at: new Date().toISOString(),
      });
  } else if (a.action === "reset") {
    assert(
      a.confirmation === "RESET HARBOR DEMO",
      "RESET",
      "Type RESET HARBOR DEMO to clear fictional orders.",
      400,
    );
    await resetDemo();
  } else await store.update("restaurants", RESTAURANT, { pos_mode: a.action });
  res.json({ ok: true });
});
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const parserType =
      err instanceof Error && "type" in err ? err.type : undefined;
    if (
      req.path === "/mcp" &&
      [
        "entity.parse.failed",
        "entity.too.large",
        "charset.unsupported",
        "encoding.unsupported",
      ].includes(String(parserType))
    ) {
      const tooLarge = parserType === "entity.too.large";
      const unsupported =
        parserType === "charset.unsupported" ||
        parserType === "encoding.unsupported";
      res.status(tooLarge ? 413 : unsupported ? 415 : 400).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: tooLarge || unsupported ? -32000 : -32700,
          message: tooLarge
            ? "Request exceeds the 64 KiB limit."
            : unsupported
              ? "Unsupported JSON encoding."
              : "Parse error: invalid JSON.",
        },
      });
      return;
    }
    const status =
      err instanceof DomainError
        ? err.status
        : err instanceof z.ZodError || err instanceof McpCallError
          ? 400
          : 500;
    if (req.path === "/mcp" && status === 401)
      res.set("WWW-Authenticate", 'Bearer realm="saygo-local"');
    res.status(status).json({
      ...(err instanceof McpCallError
        ? { recovery: err.recovery }
        : err instanceof DomainError
          ? { recovery: recoveryFor(err.code, err.message) }
          : err instanceof z.ZodError
            ? {
                recovery: recoveryFor(
                  "INVALID_ARGUMENTS",
                  "Check the required fields and input schema.",
                ),
              }
            : {}),
      error:
        err instanceof DomainError || err instanceof McpCallError
          ? err.message
          : err instanceof z.ZodError
            ? "Invalid input. Check the required fields."
            : "The operation did not complete. Refresh the canonical cart and retry; do not create a replacement order.",
    });
  },
);
