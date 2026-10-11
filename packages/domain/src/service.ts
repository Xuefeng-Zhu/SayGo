import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type {
  Cart,
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
import { config, RESTAURANT, pool, transaction, type Tx } from "@saygo/db";
import { applyCommands, assert, priceCart, product } from "./engine.js";
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
type Session = {
  id: string;
  restaurant_id: string;
  lane_id: string;
  epoch: number;
  fence: number;
  owner: "ai" | "staff";
  status: string;
  staff_message: string | null;
  needs_staff_review: boolean;
  expires_at: Date;
  token_hash: string;
  voice_until: Date | null;
};
type Context = { tx: Tx; s: Session; cart: Cart; menu: Menu; scope: Scope };
async function loadMenu(tx: Tx): Promise<Menu> {
  const r = (
    await tx.query("SELECT * FROM restaurants WHERE id=$1 FOR UPDATE", [
      RESTAURANT,
    ])
  ).rows[0];
  assert(r, "NOT_SEEDED", "Run pnpm db:seed.", 503);
  const rows = await tx.query<{ data: Product }>(
    "SELECT data FROM products WHERE restaurant_id=$1 ORDER BY id",
    [RESTAURANT],
  );
  return {
    version: r.menu_version,
    price_version: r.price_version,
    currency: "USD",
    products: rows.rows.map((r) => r.data),
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
  const s = (
    await tx.query<Session>(
      `SELECT i.* FROM interactions i JOIN lanes l ON l.current_session=i.id WHERE i.id=$1 AND i.lane_id=$2 AND i.restaurant_id=$3 AND i.epoch=$4 AND i.status='active' AND i.expires_at>now() FOR UPDATE OF i`,
      [scope.session_id, scope.lane_id, scope.restaurant_id, scope.epoch],
    )
  ).rows[0];
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
  const row = (
    await tx.query("SELECT * FROM carts WHERE session_id=$1 FOR UPDATE", [s.id])
  ).rows[0];
  return {
    tx,
    s,
    cart: { version: row.version, lines: row.lines, issues: row.issues },
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
  await c.tx.query("UPDATE quotes SET valid=false WHERE session_id=$1", [
    c.s.id,
  ]);
}
async function audit(c: Context, kind: string, details: object = {}) {
  await c.tx.query(
    "INSERT INTO audit(session_id,kind,details) VALUES($1,$2,$3)",
    [c.s.id, kind, JSON.stringify(details)],
  );
}
async function saveCart(c: Context) {
  await invalidate(c);
  await c.tx.query(
    "UPDATE carts SET version=$2,lines=$3,issues=$4 WHERE session_id=$1",
    [
      c.s.id,
      c.cart.version,
      JSON.stringify(c.cart.lines),
      JSON.stringify(c.cart.issues),
    ],
  );
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
    !(await c.tx.query("SELECT 1 FROM orders WHERE session_id=$1", [c.s.id]))
      .rowCount,
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
  const q = (
    await c.tx.query(
      `SELECT q.*,a.quote_id IS NOT NULL AS approved FROM quotes q LEFT JOIN approvals a ON a.quote_id=q.id WHERE q.session_id=$1 AND q.valid AND q.expires_at>now() ORDER BY q.expires_at DESC LIMIT 1`,
      [c.s.id],
    )
  ).rows[0];
  const order =
    (
      await c.tx.query<Order>(
        "SELECT id,number,status,snapshot,created_at,updated_at FROM orders WHERE session_id=$1",
        [c.s.id],
      )
    ).rows[0] ?? null;
  const quote: Quote | null = q
    ? {
        id: q.id,
        expires_at: new Date(q.expires_at).toISOString(),
        snapshot: q.snapshot,
        approved: q.approved,
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
          ...order,
          created_at: new Date(order.created_at).toISOString(),
          updated_at: new Date(order.updated_at).toISOString(),
        }
      : null,
    menu: c.menu,
    summary,
  };
}
export async function getView(scope: Scope) {
  return withScope(scope, (c) => view(c));
}
export async function beginInteraction(laneId: string) {
  return transaction(async (tx) => {
    await loadMenu(tx);
    const lane = (
      await tx.query(
        "SELECT * FROM lanes WHERE id=$1 AND restaurant_id=$2 FOR UPDATE",
        [laneId, RESTAURANT],
      )
    ).rows[0];
    assert(lane, "LANE", "Unknown lane.", 404);
    if (lane.current_session) {
      await tx.query(
        "UPDATE interactions SET status='ended',fence=fence+1,staff_message=NULL WHERE id=$1",
        [lane.current_session],
      );
      await tx.query("UPDATE quotes SET valid=false WHERE session_id=$1", [
        lane.current_session,
      ]);
    }
    const session = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      epoch = lane.epoch + 1;
    await tx.query(
      "INSERT INTO interactions(id,lane_id,restaurant_id,epoch,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes')",
      [session, laneId, RESTAURANT, epoch, hash(token)],
    );
    await tx.query("INSERT INTO carts(session_id) VALUES($1)", [session]);
    await tx.query("UPDATE lanes SET current_session=$2,epoch=$3 WHERE id=$1", [
      laneId,
      session,
      epoch,
    ]);
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
  const s = (
    await pool.query<Session>(
      `SELECT i.* FROM interactions i JOIN lanes l ON l.current_session=i.id WHERE i.token_hash=$1 AND i.status='active' AND i.expires_at>now()`,
      [hash(token)],
    )
  ).rows[0];
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
  const s = (
    await pool.query<Session>(
      `SELECT i.* FROM lanes l JOIN interactions i ON i.id=l.current_session WHERE l.restaurant_id=$1 AND i.status='active' AND i.expires_at>now()`,
      [RESTAURANT],
    )
  ).rows[0];
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
    await c.tx.query(
      "UPDATE interactions SET status='ended',fence=fence+1,staff_message=NULL WHERE id=$1",
      [c.s.id],
    );
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
  const q = (
    await c.tx.query(
      "SELECT * FROM quotes WHERE id=$1 AND session_id=$2 AND valid AND expires_at>now() FOR UPDATE",
      [id, c.s.id],
    )
  ).rows[0];
  assert(
    q && q.fence === c.s.fence,
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
    const existing = (
      await c.tx.query("SELECT quote_id FROM orders WHERE session_id=$1", [
        c.s.id,
      ])
    ).rows[0];
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
    await c.tx.query(
      "INSERT INTO approvals(quote_id,session_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [quoteId, c.s.id],
    );
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
    if (name === "get_cart" || name === "get_order_status")
      return { ...(await view(c)) };
    if (name === "request_staff_help") {
      const a = toolSchemas.request_staff_help.parse(args);
      await c.tx.query(
        "INSERT INTO handoffs(id,session_id,reason,concern) VALUES($1,$2,$3,$4)",
        [randomUUID(), c.s.id, a.reason, a.concern ?? null],
      );
      await c.tx.query(
        "UPDATE interactions SET needs_staff_review=true,fence=fence+1 WHERE id=$1",
        [c.s.id],
      );
      c.s.needs_staff_review = true;
      c.s.fence++;
      await invalidate(c);
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
      const existing = (
        await c.tx.query("SELECT quote_id FROM orders WHERE session_id=$1", [
          c.s.id,
        ])
      ).rows[0];
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
      const approval = await c.tx.query(
        "UPDATE approvals SET consumed_at=now() WHERE quote_id=$1 AND session_id=$2 AND consumed_at IS NULL RETURNING quote_id",
        [q.id, c.s.id],
      );
      assert(
        approval.rowCount,
        "CONSENT_REQUIRED",
        "Use the customer Confirm order button for this exact quote.",
        403,
      );
      const orderId = randomUUID();
      await c.tx.query(
        "INSERT INTO orders(id,session_id,restaurant_id,quote_id,external_key,payload_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          orderId,
          c.s.id,
          RESTAURANT,
          q.id,
          `saygo:${c.s.id}:submit`,
          q.payload_hash,
          JSON.stringify(q.snapshot),
        ],
      );
      await c.tx.query("INSERT INTO jobs(id,order_id) VALUES($1,$2)", [
        randomUUID(),
        orderId,
      ]);
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
      const a = toolSchemas.apply_cart_changes.parse(args);
      const key = `${c.s.id}:${scope.actor}:cart:${a.request_id}`,
        payloadHash = hash(a);
      const duplicate = (
        await c.tx.query("SELECT payload_hash FROM idempotency WHERE key=$1", [
          key,
        ])
      ).rows[0];
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
      c.cart = applyCommands(c.cart, c.menu, a.commands, a.clarification);
      await saveCart(c);
      await c.tx.query(
        "INSERT INTO idempotency(key,payload_hash) VALUES($1,$2)",
        [key, payloadHash],
      );
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
      const previous = (
        await c.tx.query(
          "SELECT id,request_hash FROM quotes WHERE session_id=$1 AND request_actor=$2 AND request_id=$3",
          [c.s.id, scope.actor, a.request_id],
        )
      ).rows[0];
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
      await c.tx.query(
        "INSERT INTO quotes(id,session_id,snapshot,payload_hash,fence,expires_at,request_id,request_actor,request_hash) VALUES($1,$2,$3,$4,$5,now()+interval '2 minutes',$6,$7,$8)",
        [
          id,
          c.s.id,
          JSON.stringify(snap),
          hash(snap),
          c.s.fence,
          a.request_id,
          scope.actor,
          requestHash,
        ],
      );
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
    c.cart = { version: c.cart.version + 1, lines: [], issues: [] };
    await saveCart(c);
    return {
      ...(await view(c, "Draft reset. No submitted order was cancelled.")),
    };
  });
}
export async function staffAction(
  scope: Scope,
  action: "takeover" | "release" | "resolve" | "message",
  message?: string,
) {
  return withScope(scope, async (c) => {
    assert(
      scope.actor === "staff",
      "STAFF",
      "Staff authorization required.",
      403,
    );
    if (action === "takeover") {
      c.s.owner = "staff";
      c.s.fence++;
      await invalidate(c);
    }
    if (action === "release") {
      assert(
        c.s.owner === "staff" && !c.s.needs_staff_review,
        "STAFF_REVIEW",
        "Resolve the handoff before releasing control.",
      );
      c.s.owner = "ai";
      c.s.fence++;
      await invalidate(c);
    }
    if (action === "resolve") {
      assert(c.s.owner === "staff", "TAKEOVER", "Take control first.");
      await c.tx.query(
        "UPDATE handoffs SET resolved=true WHERE session_id=$1",
        [c.s.id],
      );
      c.s.needs_staff_review = false;
      await invalidate(c);
    }
    if (action === "message") {
      assert(c.s.owner === "staff", "TAKEOVER", "Take control first.");
      c.s.staff_message = (message ?? "").slice(0, 300);
    }
    await c.tx.query(
      "UPDATE interactions SET owner=$2,fence=$3,needs_staff_review=$4,staff_message=$5 WHERE id=$1",
      [c.s.id, c.s.owner, c.s.fence, c.s.needs_staff_review, c.s.staff_message],
    );
    await audit(c, `staff_${action}`);
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
    await tx.query(
      "UPDATE products SET data=$2 WHERE id=$1 AND restaurant_id=$3",
      [id, JSON.stringify(next), RESTAURANT],
    );
    await tx.query(
      "UPDATE restaurants SET menu_version=menu_version+1,price_version=price_version+$2 WHERE id=$1",
      [RESTAURANT, patch.variants || patch.groups ? 1 : 0],
    );
    await tx.query(
      "UPDATE quotes SET valid=false WHERE session_id IN(SELECT id FROM interactions WHERE restaurant_id=$1)",
      [RESTAURANT],
    );
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
  const r = await pool.query(
    "UPDATE orders SET status=$2,updated_at=now() WHERE id=$1 AND restaurant_id=$3 AND status=$4 RETURNING id",
    [orderId, next, RESTAURANT, from[next]],
  );
  assert(r.rowCount, "TRANSITION", "Order state changed. Refresh the kitchen.");
}
