import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
if (process.env.SAYGO_AWS_QA !== "true" || process.env.DYNAMODB_ENDPOINT !== "")
  throw new Error(
    "Cloud QA requires explicit SAYGO_AWS_QA=true and DYNAMODB_ENDPOINT=''.",
  );
process.env.DYNAMODB_NAMESPACE = `saygo_eval_qa_${randomUUID().replaceAll("-", "")}`;
process.env.SAYGO_RUNTIME_PORT = "3114";
process.env.SAYGO_VOICE_ENABLED = "false";
for (const command of ["db:migrate", "db:seed"]) {
  const result = spawnSync("pnpm", [command], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Cloud QA setup failed");
}
const { app } = await import("../apps/runtime/src/app.js");
const { agentToken } = await import("../apps/runtime/src/auth.js");
const { store, maintenance, clearEntities, entities } = await import(
  "@saygo/db"
);
const { beginInteraction, approve, getView, kitchenTransition, staffAction } =
  await import("@saygo/domain");
const { openMcp, runFixture, runOneJob } = await import("@saygo/integrations");
const server = createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(3114, "127.0.0.1", resolve);
});
const checks: string[] = [];
let passed = false,
  cleaned = false;
try {
  const interaction = await beginInteraction("lane-1");
  const scope = { ...interaction.scope, actor: "agent" as const };
  const mcp = await openMcp(agentToken(scope));
  try {
    await runFixture("first", mcp.call);
    await runFixture("correct", mcp.call);
    const cart = await getView(scope);
    assert.equal(cart.totals.total, 1809);
    checks.push("MCP correction and exact $18.09 total");
    const review = await mcp.call("prepare_order_review", {
      expected_version: cart.cart_version,
      request_id: randomUUID(),
    });
    const quote = review.quote as { id: string };
    await assert.rejects(mcp.call("submit_order", { quote_id: quote.id }));
    checks.push("Submission refused without customer approval");
    await approve(interaction.scope, quote.id);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        mcp.call("submit_order", { quote_id: quote.id }),
      ),
    );
    assert.equal((await store.list("orders")).length, 1);
    assert.equal((await store.list("jobs")).length, 1);
    checks.push(
      "Four concurrent submissions produced one order and one outbox job",
    );
    await Promise.all([runOneJob(), runOneJob()]);
    assert.equal((await getView(scope)).order?.status, "accepted");
    assert.equal((await store.list("pos_receipts")).length, 1);
    checks.push("Concurrent workers produced one durable sandbox receipt");
  } finally {
    await mcp.close();
  }
  const fresh = await openMcp(agentToken(scope));
  try {
    assert.equal(
      ((await fresh.call("get_order_status", {})).order as { status: string })
        .status,
      "accepted",
    );
  } finally {
    await fresh.close();
  }
  checks.push("Fresh MCP connection recovered the accepted order");
  const order = (await getView(scope)).order!;
  for (const state of ["preparing", "ready", "handed_off"])
    await kitchenTransition(order.id, state);
  checks.push("Kitchen advanced accepted order through handed_off");
  const next = await beginInteraction("lane-1");
  await assert.rejects(getView(scope));
  assert.equal((await getView(next.scope)).lines.length, 0);
  checks.push(
    "New vehicle revoked old interaction and began with an empty cart",
  );
  const agent = { ...next.scope, actor: "agent" as const };
  await staffAction({ ...next.scope, actor: "staff" }, "takeover");
  await assert.rejects(getView(agent));
  checks.push("Staff takeover fenced prior agent credentials");
  passed = true;
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  try {
    await maintenance((run) => clearEntities(entities, run));
    cleaned = true;
  } finally {
    await store.close();
  }
  const evidence = {
    at: new Date().toISOString(),
    database: "AWS DynamoDB",
    table: "SayGo",
    region: "us-west-2",
    passed,
    temporaryDataCleaned: cleaned,
    checks,
    providerCalls: 0,
    pos: "fictional sandbox",
  };
  await writeFile(
    "docs/evidence/aws-dynamodb-smoke.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence));
}
