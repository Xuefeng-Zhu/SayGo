import pg from "pg";
import { spawnSync } from "node:child_process";
const base = "postgresql://saygo:saygo_local_only@localhost:55432/";
const admin = new pg.Pool({ connectionString: base + "postgres" });
try {
  if (
    !(await admin.query("SELECT 1 FROM pg_database WHERE datname='saygo_test'"))
      .rowCount
  )
    await admin.query("CREATE DATABASE saygo_test");
} finally {
  await admin.end();
}
for (const command of ["db:migrate", "db:seed"]) {
  const result = spawnSync("pnpm", [command], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: base + "saygo_test",
      SAYGO_DEMO: "true",
    },
  });
  if (result.status) process.exit(result.status);
}
