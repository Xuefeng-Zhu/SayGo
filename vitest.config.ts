import { defineConfig } from "vitest/config";
import path from "node:path";
if (process.argv.some((a) => a.includes("tests/integration"))) {
  process.env.DATABASE_URL =
    "postgresql://saygo:saygo_local_only@localhost:55432/saygo_test";
  process.env.SAYGO_RUNTIME_PORT = "3111";
}
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ["contracts", "domain", "db", "integrations"].map((n) => [
        `@saygo/${n}`,
        path.resolve(`packages/${n}/src/index.ts`),
      ]),
    ),
  },
  test: { testTimeout: 20000, hookTimeout: 30000 },
});
