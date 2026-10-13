import pg from "pg";
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  entities,
  store,
  maintenance,
  RESTAURANT,
  type Rows,
  rowId,
} from "./index.js";

// One-time, read-only source import. The legacy database and Compose volume are
// preserved. Run before seeding the destination; non-empty targets are refused.
const sourceUrl =
  process.env.SAYGO_IMPORT_DATABASE_URL ??
  "postgresql://saygo:saygo_local_only@localhost:55432/saygo_demo";
const source = new pg.Client({ connectionString: sourceUrl });
const snapshot = {} as { [E in keyof Rows]: Rows[E][] };
const counts: Record<string, number> = {};
const resume = process.env.SAYGO_RESUME_IMPORT === "true";
try {
  await source.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  for (const entity of entities) {
    const rows = (await source.query(`SELECT * FROM ${entity}`)).rows as Record<
      string,
      unknown
    >[];
    const normalized = rows.map((row) => {
      const value = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
      if (entity === "audit" || entity === "pos_attempts")
        value.id = String(value.id);
      if (
        typeof value.restaurant_id === "string" &&
        value.restaurant_id !== RESTAURANT
      )
        throw new Error(
          "Import requires a dedicated Harbor Burger source database.",
        );
      return value;
    });
    Object.assign(snapshot, { [entity]: normalized });
    counts[entity] = normalized.length;
  }
  await source.query("COMMIT");
  const restaurant = snapshot.restaurants.find((r) => r.id === RESTAURANT);
  if (!restaurant) throw new Error("Source restaurant is not seeded.");
  restaurant.order_number = Math.max(
    0,
    ...snapshot.orders.map((o) => o.number),
  );
  for (const session of snapshot.interactions) {
    session.active_quote_id =
      snapshot.quotes
        .filter((q) => q.session_id === session.id && q.valid)
        .sort((a, b) => b.expires_at.localeCompare(a.expires_at))[0]?.id ??
      null;
  }
  for (const quote of snapshot.quotes)
    if (quote.request_id && quote.request_actor && quote.request_hash) {
      snapshot.idempotency.push({
        key: `${quote.session_id}:${quote.request_actor}:review:${quote.request_id}`,
        payload_hash: quote.request_hash,
        quote_id: quote.id,
        created_at: new Date(
          new Date(quote.expires_at).getTime() - 120000,
        ).toISOString(),
      });
    }
  if (!resume)
    for (const entity of entities)
      if ((await store.list(entity)).length)
        throw new Error(
          "Destination is not empty; source data was not modified.",
        );
  await maintenance(async (run) => {
    for (const entity of entities) {
      const existing = await run((tx) => tx.list(entity));
      const expected = new Map(
        snapshot[entity].map((row) => [rowId(entity, row), row]),
      );
      if (
        existing.some(
          (row) => !isDeepStrictEqual(row, expected.get(rowId(entity, row))),
        )
      )
        throw new Error(
          "Destination contains data differing from the source snapshot.",
        );
      if (!resume && existing.length)
        throw new Error("Destination changed before import.");
      const present = new Set(existing.map((row) => rowId(entity, row)));
      const rows = snapshot[entity];
      for (let i = 0; i < rows.length; i += 5)
        await run(async (tx) => {
          for (const row of rows.slice(i, i + 5))
            if (!present.has(rowId(entity, row))) tx.put(entity, row);
        });
    }
  }, resume);
  for (const entity of entities) {
    const rows = await store.list(entity);
    if (rows.length !== snapshot[entity].length)
      throw new Error("Imported entity count mismatch.");
    const expected = new Map(
      snapshot[entity].map((row) => [rowId(entity, row), row]),
    );
    if (
      rows.some(
        (row) => !isDeepStrictEqual(row, expected.get(rowId(entity, row))),
      )
    )
      throw new Error("Imported entity content mismatch.");
  }
  const evidence = {
    at: new Date().toISOString(),
    source: "local PostgreSQL saygo_demo",
    destination: "DynamoDB",
    sourcePreserved: true,
    sourceCounts: counts,
    addedReviewIdentities: snapshot.idempotency.length - counts.idempotency,
    verified:
      "Every entity's content and count verified after import; source accessed with a read-only repeatable-read transaction.",
  };
  await writeFile(
    "docs/evidence/dynamodb-migration.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
} finally {
  await source.end();
  await store.close();
}
