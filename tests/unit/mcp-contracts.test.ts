import { describe, expect, it } from "vitest";
import {
  recoveryFor,
  toolDataSchemas,
  toolOutputSchemas,
  toolSchemas,
  type ToolName,
} from "@saygo/contracts";
import {
  decodeToolResult,
  McpCallError,
} from "../../packages/integrations/src/mcp-client.js";
import { seedProducts } from "../../packages/db/src/menu.js";
import { toolData } from "../../apps/runtime/src/mcp-results.js";

describe("MCP contracts", () => {
  it("requires an explicit review request ID and disallows model consent flags", () => {
    expect(
      toolSchemas.prepare_order_review.safeParse({ expected_version: 1 })
        .success,
    ).toBe(false);
    expect(
      toolSchemas.prepare_order_review.safeParse({
        expected_version: 1,
        request_id: crypto.randomUUID(),
      }).success,
    ).toBe(true);
    expect(
      toolSchemas.submit_order.safeParse({
        quote_id: crypto.randomUUID(),
        confirmed: true,
      }).success,
    ).toBe(false);
  });
  it("validates success outputs strictly at both root and nested levels", () => {
    const value = {
      result: { ok: true, data: { order: null, summary: "No order" } },
    };
    expect(decodeToolResult("get_order_status", value)).toEqual(
      value.result.data,
    );
    expect(() =>
      decodeToolResult("get_order_status", { ...value, secret: "no" }),
    ).toThrow(McpCallError);
    expect(() =>
      decodeToolResult("get_order_status", {
        result: { ok: true, data: { ...value.result.data, menu: {} } },
      }),
    ).toThrow(McpCallError);
    expect(() =>
      decodeToolResult("get_order_status", {
        result: { ok: true, data: { summary: "missing order" } },
      }),
    ).toThrow(McpCallError);
  });
  it("checks exact menu/product fields and integer money", () => {
    const data = { product: seedProducts[0], summary: "Fictional" };
    expect(toolDataSchemas.get_item_details.safeParse(data).success).toBe(true);
    expect(
      toolDataSchemas.get_item_details.safeParse({
        ...data,
        product: { ...data.product, private_note: "hidden" },
      }).success,
    ).toBe(false);
    expect(
      toolDataSchemas.get_item_details.safeParse({
        ...data,
        product: { ...data.product, variants: { regular: 1.25 } },
      }).success,
    ).toBe(false);
  });
  it("advertises a validated recovery variant for every tool", () => {
    const error = recoveryFor("VERSION_CONFLICT", "Refresh the cart.");
    for (const name of Object.keys(toolOutputSchemas) as ToolName[]) {
      const payload = { result: { ok: false, error } };
      expect(toolOutputSchemas[name].safeParse(payload).success).toBe(true);
      try {
        decodeToolResult(name, payload, true);
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ recovery: error });
      }
    }
  });
  it("rejects contradictory success and isError flags", () => {
    expect(() =>
      decodeToolResult(
        "get_order_status",
        { result: { ok: true, data: { order: null, summary: "" } } },
        true,
      ),
    ).toThrow("invalid result");
    expect(() =>
      decodeToolResult(
        "get_order_status",
        { result: { ok: false, error: recoveryFor("FENCED", "Paused") } },
        false,
      ),
    ).toThrow("invalid result");
  });
  it("provides distinct recovery actions without authorizing blind write retries", () => {
    for (const [code, action] of [
      ["VERSION_CONFLICT", "refresh_cart"],
      ["STALE_QUOTE", "review_order"],
      ["CONSENT_REQUIRED", "confirm_order"],
      ["FENCED", "wait_for_staff"],
      ["SESSION_EXPIRED", "start_session"],
      ["IDEMPOTENCY_MISMATCH", "new_request_id"],
    ])
      expect(recoveryFor(code, "safe message")).toMatchObject({
        retryable: false,
        next_action: action,
      });
  });
  it("projects order status without leaking the full UI view", () => {
    expect(
      toolData("get_order_status", {
        order: null,
        summary: "",
        menu: { private: true },
        session: { id: "secret" },
        lines: [],
      }),
    ).toEqual({ order: null, summary: "" });
  });
});
