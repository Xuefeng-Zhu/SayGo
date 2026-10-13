import { runOneJob, cleanup } from "@saygo/integrations";
import { store, config } from "@saygo/db";
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
    if (!worked)
      await new Promise((r) =>
        setTimeout(r, config.DYNAMODB_ENDPOINT ? 500 : 5000),
      );
  } catch {
    console.error(
      "SayGo worker retrying after a database/service error (details redacted).",
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await store.close();
