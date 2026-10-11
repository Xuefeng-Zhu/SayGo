import { pool, transaction, RESTAURANT } from "@saygo/db";
import { randomUUID } from "node:crypto";
export type PosResult = { status: "accepted" | "rejected" };
export interface PosAdapter {
  lookup(key: string, payloadHash: string): Promise<PosResult | null>;
  submit(key: string, payloadHash: string): Promise<PosResult>;
}
export class SandboxPos implements PosAdapter {
  async lookup(key: string, payloadHash: string) {
    const row = (
      await pool.query(
        "SELECT *,visible_at<=now() AS visible FROM pos_receipts WHERE external_key=$1",
        [key],
      )
    ).rows[0];
    if (row && row.payload_hash !== payloadHash)
      throw new Error("POS idempotency payload mismatch");
    return row && row.visible
      ? { status: row.status as PosResult["status"] }
      : null;
  }
  async submit(key: string, payloadHash: string): Promise<PosResult> {
    const mode = (
      await pool.query("SELECT pos_mode FROM restaurants WHERE id=$1", [
        RESTAURANT,
      ])
    ).rows[0].pos_mode;
    const status = mode === "reject" ? "rejected" : "accepted";
    // A separate durable store models an external system that may accept before transport failure.
    const row = await transaction(async (tx) => {
      await tx.query(
        "INSERT INTO pos_receipts(external_key,payload_hash,status,visible_at) VALUES($1,$2,$3,now()+($4::int*interval '1 second')) ON CONFLICT DO NOTHING",
        [
          key,
          payloadHash,
          status,
          mode === "delay" ? 8 : mode === "unknown" ? 3 : 0,
        ],
      );
      return (
        await tx.query(
          "SELECT *,visible_at<=now() AS visible FROM pos_receipts WHERE external_key=$1",
          [key],
        )
      ).rows[0];
    });
    if (row.payload_hash !== payloadHash)
      throw new Error("POS idempotency payload mismatch");
    if (mode === "unknown" || !row.visible)
      throw new Error(
        "Sandbox acknowledgement unavailable; acceptance may have occurred",
      );
    return { status: row.status };
  }
}
export async function runOneJob(
  adapter: PosAdapter = new SandboxPos(),
): Promise<boolean> {
  const lease = randomUUID();
  const job = await transaction(async (tx) => {
    const row = (
      await tx.query(
        `SELECT * FROM jobs WHERE (state='pending' AND available_at<=now()) OR (state='leased' AND lease_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!row) return null;
    await tx.query(
      "UPDATE jobs SET state='leased',lease_until=now()+interval '30 seconds',lease_token=$2,attempts=attempts+1 WHERE id=$1",
      [row.id, lease],
    );
    return row;
  });
  if (!job) return false;
  const order = (
    await pool.query("SELECT * FROM orders WHERE id=$1", [job.order_id])
  ).rows[0];
  let result: PosResult | null = null;
  try {
    result = await adapter.lookup(order.external_key, order.payload_hash);
    await pool.query(
      "INSERT INTO pos_attempts(order_id,operation,outcome) VALUES($1,'lookup',$2)",
      [order.id, result?.status ?? "not_visible"],
    );
    if (!result) {
      result = await adapter.submit(order.external_key, order.payload_hash);
      await pool.query(
        "INSERT INTO pos_attempts(order_id,operation,outcome) VALUES($1,'submit',$2)",
        [order.id, result.status],
      );
    }
  } catch {
    await pool.query(
      "INSERT INTO pos_attempts(order_id,operation,outcome) VALUES($1,'reconcile','unknown')",
      [order.id],
    );
  }
  await transaction(async (tx) => {
    // Fencing prevents a slow worker from overwriting a reclaimed lease's result.
    const owns = (
      await tx.query(
        "SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND state='leased' FOR UPDATE",
        [job.id, lease],
      )
    ).rowCount;
    if (!owns) return;
    if (result) {
      await tx.query(
        "UPDATE orders SET status=$2,updated_at=now() WHERE id=$1 AND status IN ('submitted','unknown')",
        [order.id, result.status],
      );
      await tx.query(
        "UPDATE jobs SET state='done',lease_until=NULL WHERE id=$1",
        [job.id],
      );
      await tx.query(
        "UPDATE handoffs SET resolved=true WHERE session_id=$1 AND reason='pos_unknown'",
        [order.session_id],
      );
    } else {
      await tx.query(
        "UPDATE orders SET status='unknown',updated_at=now() WHERE id=$1 AND status IN ('submitted','unknown')",
        [order.id],
      );
      await tx.query(
        "INSERT INTO handoffs(id,session_id,reason) SELECT $1,$2,'pos_unknown' WHERE NOT EXISTS(SELECT 1 FROM handoffs WHERE session_id=$2 AND reason='pos_unknown' AND NOT resolved)",
        [randomUUID(), order.session_id],
      );
      await tx.query(
        "UPDATE jobs SET state='pending',available_at=now()+($2::int*interval '1 second'),lease_until=NULL WHERE id=$1",
        [job.id, job.attempts >= 5 ? 30 : 2],
      );
    }
  });
  return true;
}
export async function cleanup() {
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE interactions SET status='ended',fence=fence+1,staff_message=NULL WHERE status='active' AND expires_at<now()",
    );
    await tx.query("UPDATE quotes SET valid=false WHERE expires_at<now()");
    await tx.query(
      "UPDATE handoffs SET concern=NULL WHERE created_at<now()-interval '1 hour'",
    );
    await tx.query(
      "UPDATE interactions SET staff_message=NULL,token_hash='expired' WHERE status='ended' AND created_at<now()-interval '1 hour'",
    );
    await tx.query(
      "UPDATE carts SET lines='[]',issues='[]' WHERE session_id IN (SELECT id FROM interactions WHERE status='ended' AND created_at<now()-interval '24 hours')",
    );
    await tx.query(
      "DELETE FROM audit WHERE created_at<now()-interval '7 days'",
    );
    await tx.query(
      "DELETE FROM idempotency WHERE created_at<now()-interval '24 hours'",
    );
    // Keep minimal foreign-key skeletons; redact item details after seven days.
    await tx.query(
      "UPDATE orders SET snapshot=jsonb_set(snapshot,'{lines}','[]') WHERE created_at<now()-interval '7 days' AND status IN ('handed_off','rejected')",
    );
    await tx.query(
      "UPDATE quotes SET snapshot=jsonb_set(snapshot,'{lines}','[]') WHERE expires_at<now()-interval '7 days'",
    );
  });
}
