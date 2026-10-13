import { store, transaction, RESTAURANT } from "@saygo/db";
import { randomUUID } from "node:crypto";
export type PosResult = { status: "accepted" | "rejected" };
export interface PosAdapter {
  lookup(key: string, payloadHash: string): Promise<PosResult | null>;
  submit(key: string, payloadHash: string): Promise<PosResult>;
}
export class SandboxPos implements PosAdapter {
  async lookup(key: string, payloadHash: string) {
    const row = await store.get("pos_receipts", key);
    if (row && row.payload_hash !== payloadHash)
      throw new Error("POS idempotency payload mismatch");
    return row && new Date(row.visible_at).getTime() <= Date.now()
      ? { status: row.status }
      : null;
  }
  async submit(key: string, payloadHash: string): Promise<PosResult> {
    const { row, mode } = await transaction(async (tx) => {
      const mode = (await tx.get("restaurants", RESTAURANT))!.pos_mode;
      let row = await tx.get("pos_receipts", key);
      if (!row) {
        row = {
          external_key: key,
          payload_hash: payloadHash,
          status:
            mode === "reject" ? ("rejected" as const) : ("accepted" as const),
          visible_at: new Date(
            Date.now() +
              (mode === "delay" ? 8000 : mode === "unknown" ? 3000 : 0),
          ).toISOString(),
          created_at: new Date().toISOString(),
        };
        tx.put("pos_receipts", row);
      }
      return { row, mode };
    });
    if (row.payload_hash !== payloadHash)
      throw new Error("POS idempotency payload mismatch");
    if (mode === "unknown" || new Date(row.visible_at).getTime() > Date.now())
      throw new Error(
        "Sandbox acknowledgement unavailable; acceptance may have occurred",
      );
    return { status: row.status };
  }
}
async function recordAttempt(
  order_id: string,
  operation: string,
  outcome: string,
) {
  await store.put("pos_attempts", {
    id: randomUUID(),
    order_id,
    operation,
    outcome,
    created_at: new Date().toISOString(),
  });
}
export async function runOneJob(
  adapter: PosAdapter = new SandboxPos(),
): Promise<boolean> {
  const lease = randomUUID();
  const job = await transaction(async (tx) => {
    const rows = await tx.list(
      "jobs",
      (j) =>
        (j.state === "pending" &&
          new Date(j.available_at).getTime() <= Date.now()) ||
        (j.state === "leased" &&
          j.lease_until !== null &&
          new Date(j.lease_until).getTime() < Date.now()),
    );
    const row = rows.sort((a, b) =>
      a.available_at.localeCompare(b.available_at),
    )[0];
    if (!row) return null;
    return tx.update("jobs", row.id, {
      state: "leased",
      lease_until: new Date(Date.now() + 30000).toISOString(),
      lease_token: lease,
      attempts: row.attempts + 1,
    });
  });
  if (!job) return false;
  const order = (await store.list("orders", (o) => o.id === job.order_id))[0];
  if (!order) throw new Error("Job has no order");
  let result: PosResult | null = null;
  try {
    result = await adapter.lookup(order.external_key, order.payload_hash);
    await recordAttempt(order.id, "lookup", result?.status ?? "not_visible");
    if (!result) {
      result = await adapter.submit(order.external_key, order.payload_hash);
      await recordAttempt(order.id, "submit", result.status);
    }
  } catch {
    await recordAttempt(order.id, "reconcile", "unknown");
  }
  await transaction(async (tx) => {
    const current = await tx.get("jobs", job.id);
    if (current?.lease_token !== lease || current.state !== "leased") return;
    const latest = await tx.get("orders", order.session_id);
    if (latest && ["submitted", "unknown"].includes(latest.status))
      await tx.update("orders", latest.session_id, {
        status: result?.status ?? "unknown",
        updated_at: new Date().toISOString(),
      });
    const handoffs = await tx.list(
      "handoffs",
      (h) =>
        h.session_id === order.session_id &&
        h.reason === "pos_unknown" &&
        !h.resolved,
    );
    if (result) {
      await tx.update("jobs", job.id, { state: "done", lease_until: null });
      for (const h of handoffs)
        await tx.update("handoffs", h.id, { resolved: true });
    } else {
      if (!handoffs.length)
        tx.put("handoffs", {
          id: randomUUID(),
          session_id: order.session_id,
          reason: "pos_unknown",
          concern: null,
          resolved: false,
          created_at: new Date().toISOString(),
        });
      await tx.update("jobs", job.id, {
        state: "pending",
        available_at: new Date(
          Date.now() + (job.attempts >= 5 ? 30000 : 2000),
        ).toISOString(),
        lease_until: null,
      });
    }
  });
  return true;
}
export async function cleanup() {
  const now = Date.now(),
    hour = 3600000,
    day = 24 * hour;
  // Bounded transactions keep retention work below DynamoDB's 100-action limit.
  for (const s of await store.list("interactions"))
    await transaction(async (tx) => {
      const row = await tx.get("interactions", s.id);
      if (!row) return;
      const patch: Partial<typeof row> = {};
      if (row.status === "active" && new Date(row.expires_at).getTime() < now)
        Object.assign(patch, {
          status: "ended",
          fence: row.fence + 1,
          staff_message: null,
          active_quote_id: null,
        });
      if (
        (patch.status ?? row.status) === "ended" &&
        new Date(row.created_at).getTime() < now - hour
      )
        Object.assign(patch, { staff_message: null, token_hash: "expired" });
      if (
        Object.keys(patch).some(
          (k) => patch[k as keyof typeof row] !== row[k as keyof typeof row],
        )
      )
        await tx.update("interactions", row.id, patch);
      if (
        (patch.status ?? row.status) === "ended" &&
        new Date(row.created_at).getTime() < now - day
      ) {
        const cart = await tx.get("carts", row.id);
        if (cart && (cart.lines.length || cart.issues.length))
          await tx.update("carts", row.id, { lines: [], issues: [] });
      }
    });
  for (const q of await store.list(
    "quotes",
    (q) => new Date(q.expires_at).getTime() < now,
  ))
    await transaction(async (tx) => {
      const row = await tx.get("quotes", q.id);
      if (row) {
        const patch = {
          valid: false,
          ...(new Date(row.expires_at).getTime() < now - 7 * day
            ? { snapshot: { ...row.snapshot, lines: [] } }
            : {}),
        };
        if (row.valid || ("snapshot" in patch && row.snapshot.lines.length))
          await tx.update("quotes", row.id, patch);
      }
    });
  for (const h of await store.list(
    "handoffs",
    (h) => Boolean(h.concern) && new Date(h.created_at).getTime() < now - hour,
  ))
    await store.update("handoffs", h.id, { concern: null });
  for (const o of await store.list(
    "orders",
    (o) =>
      o.snapshot.lines.length > 0 &&
      new Date(o.created_at).getTime() < now - 7 * day &&
      ["handed_off", "rejected"].includes(o.status),
  ))
    await store.update("orders", o.session_id, {
      snapshot: { ...o.snapshot, lines: [] },
    });
  for (const entity of ["audit", "idempotency"] as const) {
    const expired = await store.list(
      entity,
      (r) =>
        new Date(r.created_at).getTime() <
        now - (entity === "audit" ? 7 * day : day),
    );
    for (let i = 0; i < expired.length; i += 90)
      await transaction(async (tx) => {
        for (const row of expired.slice(i, i + 90))
          tx.delete(entity, "key" in row ? row.key : row.id);
      });
  }
}
