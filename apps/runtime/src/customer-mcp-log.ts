import { randomUUID } from "node:crypto";
import {
  toolSchemas,
  type CustomerMcpLogEntry,
  type Scope,
  type ToolName,
} from "@saygo/contracts";
import { McpCallError, openMcp } from "@saygo/integrations";
import { agentToken } from "./auth.js";

type Source = CustomerMcpLogEntry["source"];
type GatewaySource = Exclude<Source, "mcp">;
type Result = Record<string, unknown>;
type Bucket = { touched: number; entries: CustomerMcpLogEntry[] };
type Options = {
  now?: () => number;
  monotonicNow?: () => number;
  createId?: () => string;
  maxEntries?: number;
  maxSessions?: number;
  ttlMs?: number;
};
const object = (value: unknown): Result | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Result)
    : undefined;
const integer = (value: unknown, max: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= max
    ? value
    : undefined;
const money = (value: unknown) => {
  const cents = integer(value, 100_000_000);
  return cents === undefined ? undefined : `$${(cents / 100).toFixed(2)}`;
};
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Deliberately select only operation categories and bounded numbers. Never
// serialize raw arguments, IDs, free-form notes, model prose or exceptions.
export function customerMcpInputSummary(name: ToolName, args: Result): string {
  switch (name) {
    case "get_menu":
      return "Read current menu";
    case "get_item_details":
      return "Read menu item";
    case "get_cart":
      return "Read current draft";
    case "get_order_status":
      return "Read current order status";
    case "compare_menu_prices":
      return Array.isArray(args.options) && args.options.length <= 8
        ? `Compare ${count(args.options.length, "menu option")}`
        : "Compare menu prices";
    case "find_meal_savings":
      return "Check current draft for meal savings";
    case "prepare_order_review":
      return "Review current draft";
    case "submit_order":
      return "Submit customer-approved quote";
    case "request_staff_help":
      return "Request staff help";
    case "cancel_draft_order":
      return "Request draft reset";
    case "apply_cart_changes": {
      if (!Array.isArray(args.commands) || args.commands.length > 20)
        return "Change current draft";
      const totals = { add: 0, update: 0, remove: 0, meal: 0 };
      for (const raw of args.commands) {
        const command = object(raw);
        if (!command) continue;
        if (command.type === "add") {
          const n =
            command.quantity === undefined ? 1 : integer(command.quantity, 10);
          if (n && n > 0) totals.add += n;
        } else if (
          command.type === "update" ||
          command.type === "remove" ||
          command.type === "meal"
        ) {
          totals[command.type]++;
        }
      }
      return (
        [
          totals.add ? `Add ${count(totals.add, "item")}` : "",
          totals.update ? `Update ${count(totals.update, "item")}` : "",
          totals.remove ? `Remove ${count(totals.remove, "item")}` : "",
          totals.meal ? `Convert ${count(totals.meal, "meal")}` : "",
        ]
          .filter(Boolean)
          .join(" · ") ||
        (args.commands.length
          ? "Change current draft"
          : "Clarify current draft")
      );
    }
  }
}

function pricedDraft(data: Result, fallback: string) {
  const lines = data.lines;
  let items: number | undefined;
  if (Array.isArray(lines) && lines.length <= 1000) {
    const quantities = lines.map((line) => integer(object(line)?.quantity, 10));
    if (quantities.every((n) => n !== undefined && n > 0))
      items = quantities.reduce<number>((sum, n) => sum + n!, 0);
  }
  const total = money(object(data.totals)?.total);
  return [items === undefined ? fallback : count(items, "item"), total]
    .filter(Boolean)
    .join(" · ");
}

const statuses: Record<string, string> = {
  submitted: "Submitted; waiting for kitchen acceptance",
  unknown: "Kitchen result not confirmed; do not submit again",
  accepted: "Accepted by the mock kitchen",
  rejected: "Rejected by the mock kitchen; ask staff",
  preparing: "Kitchen is preparing the order",
  ready: "Order ready",
  handed_off: "Order handed off",
};
export function customerMcpResultSummary(name: ToolName, data: Result): string {
  switch (name) {
    case "get_menu": {
      const products = object(data.menu)?.products;
      return Array.isArray(products) && products.length <= 1000
        ? `${count(products.length, "menu item")} returned`
        : "Menu read completed";
    }
    case "get_item_details":
      return "Menu item details read";
    case "get_cart":
    case "apply_cart_changes": {
      const draft = pricedDraft(data, "Draft read completed");
      return Array.isArray(data.unresolved_choices) &&
        data.unresolved_choices.length
        ? `Needs clarification · ${draft}`
        : draft;
    }
    case "compare_menu_prices":
      return "Menu price comparison completed; draft unchanged";
    case "find_meal_savings":
      return data.proposal
        ? "Savings proposal ready; customer approval still required"
        : "No equivalent meal savings found";
    case "prepare_order_review": {
      const quote = object(data.quote);
      const total = money(object(object(quote?.snapshot)?.totals)?.total);
      return [
        total,
        quote?.approved === true
          ? "Review ready; customer approval recorded"
          : "Review ready; customer approval required",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "submit_order":
    case "get_order_status": {
      const order = object(data.order);
      const state =
        typeof order?.status === "string" &&
        Object.hasOwn(statuses, order.status)
          ? statuses[order.status]
          : order
            ? "Check current order status"
            : "No order submitted";
      return state;
    }
    case "request_staff_help":
      return "Staff help requested; automated ordering paused";
    case "cancel_draft_order":
      return "Reset proposed; draft unchanged until customer confirmation";
  }
}

/** Ephemeral diagnostics for an authenticated customer's own session only.
 * Reads do not refresh retention. This is not a durable backend/audit log.
 */
export class CustomerMcpLog {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly createId: () => string;
  readonly limit: number;
  private readonly maxSessions: number;
  private readonly ttlMs: number;

  constructor(options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.createId = options.createId ?? randomUUID;
    this.limit = Math.min(30, Math.max(1, options.maxEntries ?? 30));
    this.maxSessions = Math.min(100, Math.max(1, options.maxSessions ?? 100));
    this.ttlMs = Math.min(
      15 * 60_000,
      Math.max(1, options.ttlMs ?? 15 * 60_000),
    );
  }

  private key(scope: Scope) {
    return JSON.stringify([
      scope.restaurant_id,
      scope.lane_id,
      scope.session_id,
      scope.epoch,
    ]);
  }

  private prune() {
    const now = this.now();
    for (const [key, value] of this.buckets)
      if (now - value.touched >= this.ttlMs) this.buckets.delete(key);
  }

  read(scope: Scope) {
    this.prune();
    return {
      session_id: scope.session_id,
      epoch: scope.epoch,
      entries: (this.buckets.get(this.key(scope))?.entries ?? []).map(
        (entry) => ({ ...entry }),
      ),
      limit: this.limit,
    };
  }

  clear(scope: Scope) {
    this.buckets.delete(this.key(scope));
  }

  async call(
    scope: Scope,
    source: Source,
    name: string,
    args: Result,
    invoke: () => Promise<Result>,
  ): Promise<Result> {
    if (!Object.hasOwn(toolSchemas, name)) return invoke();
    let pending:
      | {
          key: string;
          bucket: Bucket;
          entry: CustomerMcpLogEntry;
          started: number;
        }
      | undefined;
    // Observability must never suppress or repeat the actual order operation.
    try {
      this.prune();
      const key = this.key(scope);
      const bucket = this.buckets.get(key) ?? { touched: 0, entries: [] };
      const entry: CustomerMcpLogEntry = {
        id: this.createId(),
        tool: name as ToolName,
        source,
        status: "pending",
        input_summary: customerMcpInputSummary(name as ToolName, args),
      };
      bucket.touched = this.now();
      bucket.entries.push(entry);
      bucket.entries.splice(0, Math.max(0, bucket.entries.length - this.limit));
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
      while (this.buckets.size > this.maxSessions)
        this.buckets.delete(this.buckets.keys().next().value!);
      pending = { key, bucket, entry, started: this.monotonicNow() };
    } catch {
      // The log is optional; no raw input or error is sent to another logger.
    }
    const finish = (outcome: { result: Result } | { error: unknown }) => {
      try {
        this.prune();
        if (
          !pending ||
          this.buckets.get(pending.key) !== pending.bucket ||
          !pending.bucket.entries.includes(pending.entry)
        )
          return;
        const { entry } = pending;
        const elapsed = this.monotonicNow() - pending.started;
        if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 3_600_000)
          entry.duration_ms = Math.round(elapsed);
        if ("error" in outcome) {
          const unknown =
            outcome.error instanceof McpCallError &&
            [
              "TRANSPORT_ERROR",
              "INVALID_TOOL_RESULT",
              "INTERNAL_ERROR",
              "PROTOCOL_ERROR",
            ].includes(outcome.error.recovery.code);
          entry.status = unknown ? "unknown" : "failed";
          entry.result_summary = unknown
            ? "Result not confirmed. Check the current order before retrying."
            : "Call failed. Check the current draft or ask staff.";
        } else {
          entry.status = "succeeded";
          entry.result_summary = customerMcpResultSummary(
            name as ToolName,
            outcome.result,
          );
        }
      } catch {
        // Formatting must not change a completed operation's outcome.
      }
    };
    try {
      const result = await invoke();
      finish({ result });
      return result;
    } catch (error) {
      finish({ error });
      throw error;
    }
  }
}

export const customerMcpLog = new CustomerMcpLog();

export async function openCustomerMcp(scope: Scope, source: GatewaySource) {
  // Snapshot the scope once; owner/fence changes must not retarget old calls to
  // a different customer. Fence changes within one customer retain that history.
  const boundScope = { ...scope };
  const mcp = await openMcp(agentToken(boundScope, source));
  return {
    ...mcp,
    call: (name: string, args: Result) =>
      mcp.tools.some((tool) => tool.name === name)
        ? customerMcpLog.call(boundScope, source, name, args, () =>
            mcp.call(name, args),
          )
        : mcp.call(name, args),
  };
}
