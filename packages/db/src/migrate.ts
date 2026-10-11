import { readFile } from "node:fs/promises";
import { pool, transaction } from "./index.js";
try {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(7462941)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS saygo_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    for (const name of ["0001", "0002", "0003"])
      if (
        !(
          await tx.query("SELECT 1 FROM saygo_migrations WHERE name=$1", [name])
        ).rowCount
      ) {
        await tx.query(
          await readFile(
            new URL(`../migrations/${name}.sql`, import.meta.url),
            "utf8",
          ),
        );
        await tx.query("INSERT INTO saygo_migrations(name) VALUES($1)", [name]);
      }
  });
  console.log("SayGo migrations ready");
} finally {
  await pool.end();
}
