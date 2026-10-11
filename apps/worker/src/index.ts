import { runOneJob, cleanup } from "@saygo/integrations";
import { pool } from "@saygo/db";
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
  });
console.log("SayGo POS sandbox worker running");
let lastCleanup = 0;
while (!stopped) {
  try {
    if (Date.now() - lastCleanup > 60000) {
      await cleanup();
      lastCleanup = Date.now();
    }
    const worked = await runOneJob();
    if (!worked) await new Promise((r) => setTimeout(r, 500));
  } catch {
    console.error(
      "SayGo worker retrying after a database/service error (details redacted).",
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await pool.end();
