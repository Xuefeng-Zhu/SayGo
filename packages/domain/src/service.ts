import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type {
  Cart,
  CartReceipt,
  MealSavingsProposal,
  Menu,
  Order,
  Product,
  Quote,
  QuoteSnapshot,
  Scope,
  View,
} from "@saygo/contracts";
import { toolSchemas } from "@saygo/contracts";
import type { ToolName } from "@saygo/contracts";
import {
  config,
  RESTAURANT,
  transaction,
  maintenance,
  clearEntities,
  type Tx,
} from "@saygo/db";
import type { SessionRow, CartUndo } from "../../db/src/schema.js";
import { applyCommands, assert, priceCart, product } from "./engine.js";
import { compareMenuPrices } from "./menu-prices.js";
import { cartReceipt } from "./cart-receipt.js";
import { findMealSavings } from "./meal-savings.js";
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
// DynamoDB map ordering is not stable across persistence; identities bind values,
// not their in-memory property insertion order.
function draftHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, v]) => [key, canonical(v)]),
      );
    return item;
  };
  return hash(canonical(value));
}
type Session = SessionRow;
type Context = {
  tx: Tx;
  s: Session;
  cart: Cart;
  menu: Menu;
  scope: Scope;
  lastChange: CartReceipt | null;
  undo: CartUndo | null;
};
async function loadMenu(tx: Tx): Promise<Menu> {
  const r = await tx.get("restaurants", RESTAURANT);
  assert(r, "NOT_SEEDED", "Run pnpm db:seed.", 503);
  const rows = await tx.list("products", (p) => p.restaurant_id === RESTAURANT);
  return {
    version: r.menu_version,
    price_version: r.price_version,
    currency: "USD",
    products: rows.sort((a, b) => a.id.localeCompare(b.id)).map((r) => r.data),
    instructions: r.instructions,
    upsell_enabled: r.upsell_enabled,
  };
}
async function context(tx: Tx, scope: Scope): Promise<Context> {
  assert(
    scope.restaurant_id === RESTAURANT,
    "SCOPE",
    "Unauthorized restaurant.",
    403,
  );
  const menu = await loadMenu(tx);
  const lane = await tx.get("lanes", scope.lane_id);
  const candidate = await tx.get("interactions", scope.session_id);
  const s =
    candidate &&
    lane?.current_session === candidate.id &&
    candidate.lane_id === scope.lane_id &&
    candidate.restaurant_id === scope.restaurant_id &&
    candidate.epoch === scope.epoch &&
    candidate.status === "active" &&
    new Date(candidate.expires_at).getTime() > Date.now()
      ? candidate
      : null;
  assert(
    s,
    "SESSION_EXPIRED",
    "This customer interaction has ended. Begin a new one.",
    401,
  );
  if (scope.actor === "agent")
    assert(
      scope.fence === s.fence && s.owner === "ai",
      "FENCED",
      "Staff control or session changes stopped this agent.",
      403,
    );
  const row = await tx.get("carts", s.id);
  assert(row, "CART", "This interaction has no cart.", 503);
  return {
    tx,
    s,
    cart: { version: row.version, lines: row.lines, issues: row.issues },
    lastChange: row.last_change ?? null,
    undo: row.undo ?? null,
    menu,
    scope,
  };
}
export async function withScope<T>(
  scope: Scope,
  fn: (c: Context) => Promise<T>,
): Promise<T> {
  return transaction(async (tx) => fn(await context(tx, scope)));
}
async function invalidate(c: Context) {
  if (c.s.active_quote_id) {
    const q = await c.tx.get("quotes", c.s.active_quote_id);
    if (q) await c.tx.update("quotes", q.id, { valid: false });
    c.s.active_quote_id = null;
    await c.tx.update("interactions", c.s.id, { active_quote_id: null });
  }
}
async function audit(c: Context, kind: string, details: object = {}) {
  c.tx.put("audit", {
    id: randomUUID(),
    session_id: c.s.id,
    kind,
    details,
    created_at: new Date().toISOString(),
  });
}
async function saveCart(
  c: Context,
  before: Cart,
  kind: CartReceipt["kind"] = "correction",
) {
  await invalidate(c);
  c.lastChange = cartReceipt(before, c.cart, c.menu, {
    id: randomUUID(),
    kind,
    created_at: new Date().toISOString(),
  });
  c.undo =
    c.lastChange && kind !== "undo"
      ? {
          receipt_id: c.lastChange.id,
          before,
          menu_version: c.menu.version,
          price_version: c.menu.price_version,
          fence: c.s.fence,
          cart_hash: draftHash(c.cart),
        }
      : null;
  c.tx.put("carts", {
    session_id: c.s.id,
    ...c.cart,
    last_change: c.lastChange,
    undo: c.undo,
  });
}
function undoUnavailable(c: Context, hasOrder: boolean): string | undefined {
  if (!c.undo || !c.lastChange || c.undo.receipt_id !== c.lastChange.id)
    return "Only the latest change can be undone once.";
  if (hasOrder) return "Submitted orders need staff assistance.";
  if (c.s.owner !== "ai" || c.s.needs_staff_review)
    return "Staff must finish handling this order first.";
  if (c.undo.fence !== c.s.fence)
    return "Staff control changed since this correction.";
  if (c.s.voice_until && new Date(c.s.voice_until).getTime() >= Date.now())
    return "Stop voice before undoing this change.";
  if (
    c.undo.menu_version !== c.menu.version ||
    c.undo.price_version !== c.menu.price_version
  )
    return "The menu changed. Make a new correction using current prices.";
  if (
    c.lastChange.cart_version !== c.cart.version ||
    c.undo.cart_hash !== draftHash(c.cart)
  )
    return "The cart changed since this correction.";
  return undefined;
}
function savingsProposal(
  c: Context,
): { proposal: MealSavingsProposal; cart: Cart } | null {
  if (c.s.owner !== "ai" || c.s.needs_staff_review) return null;
  const plan = findMealSavings(c.cart, c.menu);
  if (!plan) return null;
  const { cart, ...details } = plan;
  return {
    cart,
    proposal: {
      id: draftHash({
        session_id: c.s.id,
        fence: c.s.fence,
        menu_version: c.menu.version,
        price_version: c.menu.price_version,
        before: c.cart,
        plan,
      }),
      cart_version: c.cart.version,
      menu_version: c.menu.version,
      price_version: c.menu.price_version,
      ...details,
    },
  };
}
async function mealSavingsResult(c: Context) {
  const proposal = (await c.tx.get("orders", c.s.id))
    ? null
    : (savingsProposal(c)?.proposal ?? null);
  return {
    proposal,
    summary: proposal
      ? "Equivalent meals can lower this order's total. Check the displayed proposal and choose Apply savings to accept."
      : "No equivalent meal savings are available for this draft. Keep the requested items, sizes, and customizations.",
  };
}
export async function getMealSavings(scope: Scope) {
  return withScope(scope, (c) => mealSavingsResult(c));
}
export type UndoInput = {
  receipt_id: string;
  expected_version: number;
  request_id: string;
};
export type ApplyMealSavingsInput = {
  proposal_id: string;
  expected_version: number;
  request_id: string;
};
async function customerDraft(c: Context) {
  assert(
    c.scope.actor === "customer",
    "CONSENT",
    "Only the customer screen can accept this change.",
    403,
  );
  editable(c);
  voiceIdle(c);
  await noOrder(c);
}
async function customerRetry(
  c: Context,
  operation: string,
  input: UndoInput | ApplyMealSavingsInput,
) {
  const key = `${c.s.id}:customer:${operation}:${input.request_id}`;
  const payload_hash = draftHash(input);
  const prior = await c.tx.get("idempotency", key);
  if (prior)
    assert(
      prior.payload_hash === payload_hash,
      "IDEMPOTENCY_MISMATCH",
      "This request ID was already used for a different change.",
    );
  return { prior, key, payload_hash };
}
export async function undoCartChange(
  scope: Scope,
  input: UndoInput,
): Promise<View> {
  return withScope(scope, async (c) => {
    await customerDraft(c);
    const { prior, key, payload_hash } = await customerRetry(c, "undo", input);
    if (prior) return view(c, "Already undone. Showing the latest cart.");
    version(c, input.expected_version);
    assert(
      c.lastChange?.id === input.receipt_id,
      "STALE_RECEIPT",
      "Only the latest change can be undone. Refresh the order.",
    );
    const reason = undoUnavailable(c, false);
    assert(
      !reason,
      "UNDO_UNAVAILABLE",
      reason ?? "This change cannot be undone.",
    );
    const before = c.cart;
    c.cart = {
      ...structuredClone(c.undo!.before),
      version: before.version + 1,
    };
    await saveCart(c, before, "undo");
    c.tx.put("idempotency", {
      key,
      payload_hash,
      created_at: new Date().toISOString(),
    });
    await audit(c, "cart_change_undone", {
      receipt_id: input.receipt_id,
      version: c.cart.version,
    });
    return view(
      c,
      "Undid the latest change. Review this order again before confirming.",
    );
  });
}
export async function applyMealSavings(
  scope: Scope,
  input: ApplyMealSavingsInput,
): Promise<View> {
  return withScope(scope, async (c) => {
    await customerDraft(c);
    const { prior, key, payload_hash } = await customerRetry(
      c,
      "meal-savings",
      input,
    );
    if (prior)
      return view(c, "Savings already applied. Showing the latest cart.");
    version(c, input.expected_version);
    const current = savingsProposal(c);
    assert(
      current && current.proposal.id === input.proposal_id,
      "STALE_SAVINGS",
      "This meal proposal changed. Check the current items and savings before accepting.",
    );
    const before = c.cart;
    c.cart = { ...current.cart, version: before.version + 1 };
    await saveCart(c, before, "meal_savings");
    c.tx.put("idempotency", {
      key,
      payload_hash,
      created_at: new Date().toISOString(),
    });
    await audit(c, "meal_savings_accepted", {
      proposal_id: input.proposal_id,
      savings_cents: current.proposal.savings_cents,
    });
    return view(
      c,
      "Applied the displayed meal savings. Your items and customizations are preserved. Review the new total before confirming.",
    );
  });
}
function editable(c: Context) {
  if (c.scope.actor === "staff")
    assert(c.s.owner === "staff", "TAKEOVER", "Take control before editing.");
  else
    assert(
      c.s.owner === "ai" && !c.s.needs_staff_review,
      "STAFF_REVIEW",
      "Staff needs to handle this interaction first.",
    );
}
async function noOrder(c: Context) {
  assert(
    !(await c.tx.get("orders", c.s.id)),
    "ORDER_LOCKED",
    "This order has been submitted. Ask staff for changes; the kitchen ticket was not changed.",
  );
}
function version(c: Context, expected: number) {
  assert(
    c.cart.version === expected,
    "VERSION_CONFLICT",
    "The cart changed. Re-read it before applying this correction.",
  );
}
async function view(c: Context, summary = ""): Promise<View> {
  const priced = priceCart(c.cart, c.menu);
  const candidate = c.s.active_quote_id
    ? await c.tx.get("quotes", c.s.active_quote_id)
    : null;
  const q =
    candidate &&
    candidate.valid &&
    candidate.fence === c.s.fence &&
    candidate.snapshot.cart_version === c.cart.version &&
    candidate.snapshot.menu_version === c.menu.version &&
    candidate.snapshot.price_version === c.menu.price_version &&
    new Date(candidate.expires_at).getTime() > Date.now()
      ? candidate
      : null;
  const approval = q ? await c.tx.get("approvals", q.id) : null;
  const order = await c.tx.get("orders", c.s.id);
  const undoReason = undoUnavailable(c, Boolean(order));
  const quote: Quote | null = q
    ? {
        id: q.id,
        expires_at: new Date(q.expires_at).toISOString(),
        snapshot: q.snapshot,
        approved: Boolean(approval),
      }
    : null;
  return {
    session: {
      id: c.s.id,
      epoch: c.s.epoch,
      fence: c.s.fence,
      owner: c.s.owner,
      status: c.s.status,
      staff_message: c.s.staff_message,
      needs_staff_review: c.s.needs_staff_review,
    },
    cart: c.cart,
    cart_version: c.cart.version,
    lines: priced.lines,
    totals: priced.totals,
    unresolved_choices: priced.issues,
    quote,
    order: order
      ? {
          id: order.id,
          number: order.number,
          status: order.status as Order["status"],
          snapshot: order.snapshot,
          created_at: new Date(order.created_at).toISOString(),
          updated_at: new Date(order.updated_at).toISOString(),
        }
      : null,
    menu: c.menu,
    last_change: c.lastChange
      ? {
          ...c.lastChange,
          undo_available: !undoReason,
          ...(undoReason ? { undo_unavailable_reason: undoReason } : {}),
        }
      : null,
    meal_savings: order ? null : (savingsProposal(c)?.proposal ?? null),
    summary,
  };
}
export async function getView(scope: Scope) {
  return withScope(scope, (c) => view(c));
}
export async function beginInteraction(laneId: string) {
  return transaction(async (tx) => {
    await loadMenu(tx);
    const lane = await tx.get("lanes", laneId);
    assert(lane, "LANE", "Unknown lane.", 404);
    if (lane.current_session) {
      const prior = await tx.get("interactions", lane.current_session);
      if (prior) {
        if (prior.active_quote_id)
          await tx.update("quotes", prior.active_quote_id, { valid: false });
        await tx.update("interactions", prior.id, {
          status: "ended",
          fence: prior.fence + 1,
          staff_message: null,
          active_quote_id: null,
        });
      }
    }
    const session = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      epoch = lane.epoch + 1;
    tx.put("interactions", {
      id: session,
      lane_id: laneId,
      restaurant_id: RESTAURANT,
      epoch,
      fence: 0,
      owner: "ai",
      status: "active",
      token_hash: hash(token),
      active_quote_id: null,
      needs_staff_review: false,
      staff_message: null,
      voice_until: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
    });
    tx.put("carts", { session_id: session, version: 0, lines: [], issues: [] });
    await tx.update("lanes", laneId, { current_session: session, epoch });
    return {
      token,
      scope: {
        restaurant_id: RESTAURANT,
        lane_id: laneId,
        session_id: session,
        epoch,
        fence: 0,
        actor: "customer" as const,
      },
    };
  });
}
export async function scopeForToken(token: string): Promise<Scope> {
  const s = await transaction(async (tx) => {
    const lane = await tx.get("lanes", "lane-1");
    const row = lane?.current_session
      ? await tx.get("interactions", lane.current_session)
      : null;
    return row?.token_hash === hash(token) &&
      row.status === "active" &&
      new Date(row.expires_at).getTime() > Date.now()
      ? row
      : null;
  });
  assert(s, "UNAUTHORIZED", "Begin a customer interaction first.", 401);
  return {
    restaurant_id: s.restaurant_id,
    lane_id: s.lane_id,
    session_id: s.id,
    epoch: s.epoch,
    fence: s.fence,
    actor: "customer",
  };
}
export async function activeScope(): Promise<Scope | null> {
  const s = await transaction(async (tx) => {
    const lane = await tx.get("lanes", "lane-1");
    const row = lane?.current_session
      ? await tx.get("interactions", lane.current_session)
      : null;
    return row?.status === "active" &&
      new Date(row.expires_at).getTime() > Date.now()
      ? row
      : null;
  });
  return s
    ? {
        restaurant_id: RESTAURANT,
        lane_id: s.lane_id,
        session_id: s.id,
        epoch: s.epoch,
        fence: s.fence,
        actor: "staff",
      }
    : null;
}
export async function endInteraction(scope: Scope) {
  return withScope(scope, async (c) => {
    await invalidate(c);
    await c.tx.update("interactions", c.s.id, {
      status: "ended",
      fence: c.s.fence + 1,
      staff_message: null,
    });
    await audit(c, "vehicle_departed");
  });
}
function snapshot(c: Context): QuoteSnapshot {
  const p = priceCart(c.cart, c.menu);
  assert(c.cart.lines.length > 0, "EMPTY", "Add an item first.");
  assert(
    p.issues.length === 0,
    "UNRESOLVED",
    p.issues[0]?.message ?? "Complete the selections first.",
  );
  assert(
    !c.s.needs_staff_review,
    "STAFF_REVIEW",
    "Staff must resolve this concern before review.",
  );
  return {
    cart_version: c.cart.version,
    menu_version: c.menu.version,
    price_version: c.menu.price_version,
    lines: p.lines,
    totals: p.totals,
    fulfillment: "drive_through",
    payment: "due_at_window",
  };
}
function voiceIdle(c: Context) {
  assert(
    !c.s.voice_until || new Date(c.s.voice_until).getTime() < Date.now(),
    "VOICE_PENDING",
    "Stop voice and wait for pending corrections before confirming.",
  );
}
async function validQuote(c: Context, id: string) {
  const q = await c.tx.get("quotes", id);
  assert(
    q &&
      q.session_id === c.s.id &&
      q.valid &&
      c.s.active_quote_id === q.id &&
      new Date(q.expires_at).getTime() > Date.now() &&
      q.fence === c.s.fence,
    "STALE_QUOTE",
    "Review this order again; the quote expired or changed.",
  );
  assert(
    hash(snapshot(c)) === q.payload_hash,
    "STALE_QUOTE",
    "The selection or menu changed. Review the new quote.",
  );
  return q;
}
export async function approve(scope: Scope, quoteId: string) {
  assert(
    scope.actor === "customer",
    "CONSENT",
    "Only the customer confirmation action can approve.",
    403,
  );
  return withScope(scope, async (c) => {
    const existing = await c.tx.get("orders", c.s.id);
    if (existing) {
      assert(
        existing.quote_id === quoteId,
        "IDEMPOTENCY_MISMATCH",
        "Another quote was submitted. Ask staff.",
      );
      return view(c);
    }
    editable(c);
    voiceIdle(c);
    await noOrder(c);
    await validQuote(c, quoteId);
    if (!(await c.tx.get("approvals", quoteId)))
      c.tx.put("approvals", {
        quote_id: quoteId,
        session_id: c.s.id,
        created_at: new Date().toISOString(),
        consumed_at: null,
      });
    await audit(c, "customer_approved");
    return view(c, "You approved the displayed quote.");
  });
}
export async function tool(
  scope: Scope,
  name: ToolName,
  input: unknown,
): Promise<Record<string, unknown>> {
  const args = toolSchemas[name].parse(input);
  return withScope(scope, async (c) => {
    if (name === "get_menu")
      return {
        menu: c.menu,
        summary:
          "Fictional Harbor Burger menu. Prices are USD cents. Ingredient data is not allergen certification.",
      };
    if (name === "get_item_details")
      return {
        product: product(c.menu, (args as { product_id: string }).product_id),
        summary:
          "Use only the listed choices. Ask staff about allergies or cross-contact.",
      };
    if (name === "compare_menu_prices") return compareMenuPrices(c.menu, args);
    if (name === "find_meal_savings") return mealSavingsResult(c);
    if (name === "get_cart" || name === "get_order_status")
      return { ...(await view(c)) };
    if (name === "request_staff_help") {
      const a = toolSchemas.request_staff_help.parse(args);
      const alreadyPending = c.s.needs_staff_review;
      if (
        alreadyPending &&
        (
          await c.tx.list(
            "handoffs",
            (row) =>
              row.session_id === c.s.id &&
              !row.resolved &&
              row.reason === a.reason &&
              row.concern === (a.concern ?? null),
          )
        ).length > 0
      )
        return {
          ...(await view(
            c,
            a.reason === "allergy"
              ? "Staff will review your allergy concern. I cannot guarantee allergen safety."
              : "Staff has already been requested. Your order is preserved.",
          )),
        };
      c.tx.put("handoffs", {
        id: randomUUID(),
        session_id: c.s.id,
        reason: a.reason,
        concern: a.concern ?? null,
        resolved: false,
        created_at: new Date().toISOString(),
      });
      if (!alreadyPending) {
        await c.tx.update("interactions", c.s.id, {
          needs_staff_review: true,
          fence: c.s.fence + 1,
        });
        c.s.needs_staff_review = true;
        c.s.fence++;
        await invalidate(c);
      }
      await audit(c, "handoff_requested", { reason: a.reason });
      return {
        ...(await view(
          c,
          a.reason === "allergy"
            ? "Staff will review your allergy concern. I cannot guarantee allergen safety."
            : "Staff has been requested. Your order is preserved.",
        )),
      };
    }
    if (name === "submit_order") {
      const a = toolSchemas.submit_order.parse(args);
      const existing = await c.tx.get("orders", c.s.id);
      if (existing) {
        assert(
          existing.quote_id === a.quote_id,
          "IDEMPOTENCY_MISMATCH",
          "An order already exists for a different quote. Ask staff.",
        );
        return {
          ...(await view(
            c,
            "This is the existing order; no duplicate was sent.",
          )),
        };
      }
      editable(c);
      voiceIdle(c);
      const q = await validQuote(c, a.quote_id);
      const approval = await c.tx.get("approvals", q.id);
      assert(
        approval && approval.session_id === c.s.id && !approval.consumed_at,
        "CONSENT_REQUIRED",
        "Use the customer Confirm order button for this exact quote.",
        403,
      );
      const orderId = randomUUID();
      await c.tx.update("approvals", q.id, {
        consumed_at: new Date().toISOString(),
      });
      const restaurant = (await c.tx.get("restaurants", RESTAURANT))!;
      const number = restaurant.order_number + 1;
      await c.tx.update("restaurants", RESTAURANT, { order_number: number });
      const now = new Date().toISOString();
      c.tx.put("orders", {
        id: orderId,
        number,
        session_id: c.s.id,
        restaurant_id: RESTAURANT,
        quote_id: q.id,
        external_key: `saygo:${c.s.id}:submit`,
        payload_hash: q.payload_hash,
        snapshot: q.snapshot,
        status: "submitted",
        created_at: now,
        updated_at: now,
      });
      c.tx.put("jobs", {
        id: randomUUID(),
        order_id: orderId,
        state: "pending",
        attempts: 0,
        available_at: now,
        lease_until: null,
        lease_token: null,
      });
      await invalidate(c);
      await audit(c, "order_submitted");
      return {
        ...(await view(
          c,
          "Sent to the POS sandbox. Restaurant acceptance is pending; payment is due at the window.",
        )),
      };
    }
    editable(c);
    await noOrder(c);
    if (name === "apply_cart_changes") {
      if (scope.actor === "staff")
        assert(
          scope.fence === c.s.fence,
          "FENCED",
          "Control changed. Refresh before editing the draft.",
          409,
        );
      const a = toolSchemas.apply_cart_changes.parse(args);
      const key = `${c.s.id}:${scope.actor}:cart:${a.request_id}`,
        payloadHash = hash(a);
      const duplicate = await c.tx.get("idempotency", key);
      if (duplicate) {
        assert(
          duplicate.payload_hash === payloadHash,
          "IDEMPOTENCY_MISMATCH",
          "This request ID was already used for different changes.",
        );
        return {
          ...(await view(c, "Already applied. Showing the latest cart.")),
        };
      }
      version(c, a.expected_version);
      const before = c.cart;
      c.cart = applyCommands(c.cart, c.menu, a.commands, a.clarification);
      await saveCart(c, before);
      c.tx.put("idempotency", {
        key,
        payload_hash: payloadHash,
        created_at: new Date().toISOString(),
      });
      await audit(c, "cart_changed", {
        version: c.cart.version,
        commands: a.commands.length,
      });
      return {
        ...(await view(
          c,
          a.clarification
            ? c.cart.issues[0].message
            : "Updated your order. Please check the board.",
        )),
      };
    }
    if (name === "prepare_order_review") {
      const a = toolSchemas.prepare_order_review.parse(args);
      const requestHash = hash(a);
      const key = `${c.s.id}:${scope.actor}:review:${a.request_id}`;
      const identity = await c.tx.get("idempotency", key);
      const previous = identity?.quote_id
        ? await c.tx.get("quotes", identity.quote_id)
        : null;
      if (previous) {
        assert(
          previous.request_hash === requestHash,
          "IDEMPOTENCY_MISMATCH",
          "This review request ID was already used with different arguments.",
        );
        // Revalidate expiry, selection, price and ownership. Never extend expiry
        // or revive an invalidated quote, even if the request body is identical.
        await validQuote(c, previous.id);
        return {
          ...(await view(
            c,
            "This is the existing review; its expiry and customer approval are unchanged.",
          )),
        };
      }
      version(c, a.expected_version);
      const snap = snapshot(c);
      await invalidate(c);
      const id = randomUUID();
      c.tx.put("quotes", {
        id,
        session_id: c.s.id,
        snapshot: snap,
        payload_hash: hash(snap),
        fence: c.s.fence,
        valid: true,
        expires_at: new Date(Date.now() + 2 * 60000).toISOString(),
        request_id: a.request_id,
        request_actor: scope.actor,
        request_hash: requestHash,
      });
      c.tx.put("idempotency", {
        key,
        payload_hash: requestHash,
        quote_id: id,
        created_at: new Date().toISOString(),
      });
      c.s.active_quote_id = id;
      await c.tx.update("interactions", c.s.id, { active_quote_id: id });
      return {
        ...(await view(
          c,
          "Review these exact items and prices. Confirm on the screen when ready. Payment is due at the window.",
        )),
      };
    }
    const a = toolSchemas.cancel_draft_order.parse(args);
    version(c, a.expected_version);
    const reset = createHmac("sha256", config.SAYGO_TOKEN_SECRET)
      .update(`reset:${c.s.id}:${c.cart.version}:${c.s.fence}`)
      .digest("hex");
    if (a.reset_token !== reset)
      return {
        ...(await view(
          c,
          "Start over and remove every item? Confirm reset on the screen.",
        )),
        reset_token: reset,
      };
    assert(
      scope.actor === "customer",
      "RESET_CONSENT",
      "Only the customer reset action can use the reset token.",
      403,
    );
    const before = c.cart;
    c.cart = { version: c.cart.version + 1, lines: [], issues: [] };
    await saveCart(c, before);
    return {
      ...(await view(c, "Draft reset. No submitted order was cancelled.")),
    };
  });
}
export type StaffActionOptions = {
  expected_fence: number;
  request_id: string;
};
export async function staffAction(
  scope: Scope,
  action: "takeover" | "release" | "resolve" | "message",
  message?: string,
  options?: StaffActionOptions,
) {
  return withScope(scope, async (c) => {
    assert(
      scope.actor === "staff",
      "STAFF",
      "Staff authorization required.",
      403,
    );
    const identity = options && {
      key: `${c.s.id}:staff:${options.request_id}`,
      payload_hash: draftHash({ action, message: message ?? "", ...options }),
    };
    if (identity && options) {
      const prior = await c.tx.get("idempotency", identity.key);
      if (prior) {
        assert(
          prior.payload_hash === identity.payload_hash,
          "IDEMPOTENCY_MISMATCH",
          "This request ID was already used for a different staff action.",
        );
        // A delayed retry must return current state, even after control changed
        // again; it must never repeat an earlier ownership transition.
        return view(c);
      }
      assert(
        options.expected_fence === c.s.fence,
        "FENCED",
        "Control changed. Refresh before taking another staff action.",
        409,
      );
    }
    let changed = false;
    if (action === "takeover" && c.s.owner !== "staff") {
      c.s.owner = "staff";
      c.s.fence++;
      await invalidate(c);
      changed = true;
    }
    if (action === "release") {
      assert(
        !c.s.needs_staff_review,
        "STAFF_REVIEW",
        "Resolve the handoff before releasing control.",
      );
      if (c.s.owner === "staff") {
        voiceIdle(c);
        c.s.owner = "ai";
        c.s.fence++;
        await invalidate(c);
        changed = true;
      }
    }
    if (action === "resolve") {
      assert(c.s.owner === "staff", "TAKEOVER", "Take control first.");
      const handoffs = await c.tx.list(
        "handoffs",
        (h) => h.session_id === c.s.id && !h.resolved,
      );
      for (const row of handoffs)
        await c.tx.update("handoffs", row.id, { resolved: true });
      changed = c.s.needs_staff_review || handoffs.length > 0;
      c.s.needs_staff_review = false;
      if (changed) await invalidate(c);
    }
    if (action === "message") {
      assert(c.s.owner === "staff", "TAKEOVER", "Take control first.");
      const next = (message ?? "").slice(0, 300);
      changed = next !== c.s.staff_message;
      c.s.staff_message = next;
    }
    if (changed) {
      await c.tx.update("interactions", c.s.id, {
        owner: c.s.owner,
        fence: c.s.fence,
        needs_staff_review: c.s.needs_staff_review,
        staff_message: c.s.staff_message,
      });
      await audit(c, `staff_${action}`);
    }
    if (identity)
      c.tx.put("idempotency", {
        ...identity,
        created_at: new Date().toISOString(),
      });
    return view(c);
  });
}
export async function updateProduct(
  id: string,
  patch: {
    available?: boolean;
    variants?: Record<string, number>;
    groups?: Product["groups"];
  },
) {
  return transaction(async (tx) => {
    const menu = await loadMenu(tx),
      p = product(menu, id);
    const next = { ...p, ...patch };
    if (patch.variants) {
      assert(
        Object.keys(patch.variants).sort().join() ===
          Object.keys(p.variants).sort().join(),
        "VARIANTS",
        "Existing variants must be preserved.",
        400,
      );
      for (const price of Object.values(patch.variants))
        assert(
          Number.isSafeInteger(price) && price >= 0 && price <= 50000,
          "PRICE",
          "Use integer cents between 0 and 50000.",
          400,
        );
    }
    if (patch.groups)
      for (const [key, g] of Object.entries(patch.groups)) {
        assert(
          p.groups[key] &&
            g.min >= 0 &&
            g.max >= g.min &&
            g.max <= 8 &&
            Object.keys(g.options).length >= g.min,
          "GROUPS",
          "Invalid choice group.",
          400,
        );
        for (const [option, v] of Object.entries(g.options))
          assert(
            p.groups[key].options[option] &&
              Number.isSafeInteger(v.price) &&
              v.price >= 0 &&
              v.price <= 50000,
            "GROUPS",
            "Only existing, priced modifier options are supported.",
            400,
          );
      }
    await tx.update("products", id, { data: next });
    await tx.update("restaurants", RESTAURANT, {
      menu_version: menu.version + 1,
      price_version:
        menu.price_version + (patch.variants || patch.groups ? 1 : 0),
    });
    // Every quote carries these versions. Validation and projection invalidate
    // old reviews atomically, without an unbounded fan-out write.
    return next;
  });
}
export async function kitchenTransition(orderId: string, next: string) {
  const from: { [key: string]: string } = {
    preparing: "accepted",
    ready: "preparing",
    handed_off: "ready",
  };
  assert(from[next], "TRANSITION", "Unsupported kitchen state.", 400);
  await transaction(async (tx) => {
    const order = (
      await tx.list(
        "orders",
        (o) => o.id === orderId && o.restaurant_id === RESTAURANT,
      )
    )[0];
    assert(
      order?.status === from[next],
      "TRANSITION",
      "Order state changed. Refresh the kitchen.",
    );
    await tx.update("orders", order.session_id, {
      status: next,
      updated_at: new Date().toISOString(),
    });
  });
}

export async function resetDemo() {
  await maintenance(
    async (run) => {
      await clearEntities(
        [
          "pos_attempts",
          "jobs",
          "pos_receipts",
          "orders",
          "approvals",
          "quotes",
          "handoffs",
          "carts",
          "audit",
          "idempotency",
          "interactions",
        ],
        run,
      );
      await run(async (tx) => {
        for (const lane of await tx.list("lanes"))
          await tx.update("lanes", lane.id, {
            current_session: null,
            epoch: lane.epoch + 1,
          });
      });
    },
    false,
    async (tx) => {
      assert(
        !(await tx.list("jobs")).some((j) => j.state === "leased"),
        "WORKER_BUSY",
        "Wait for the current sandbox attempt to finish before resetting.",
      );
    },
  );
}

export async function voiceLease(sessionId: string, until: string | null) {
  await transaction(async (tx) => {
    const session = await tx.get("interactions", sessionId);
    if (session)
      await tx.update("interactions", sessionId, { voice_until: until });
  });
}
