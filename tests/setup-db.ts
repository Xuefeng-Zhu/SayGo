import { spawnSync } from "node:child_process";
for (const command of ["db:migrate", "db:seed"]) {
  const result = spawnSync("pnpm", [command], {
    stdio: "inherit",
    env: {
      ...process.env,
      DYNAMODB_TABLE: "saygo-local",
      DYNAMODB_NAMESPACE: "saygo_test",
      DYNAMODB_ENDPOINT: "http://127.0.0.1:8000",
      SAYGO_DEMO: "true",
    },
  });
  if (result.status) process.exit(result.status);
}
