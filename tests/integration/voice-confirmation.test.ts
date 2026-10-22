import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config, RESTAURANT, store, transaction } from "@saygo/db";
import {
  approve,
  armVoiceConfirmation,
  beginInteraction,
  confirmVoiceOrder,
  getView,
  invalidateVoiceConfirmation,
  prepareVoiceConfirmation,
  resetDemo,
  staffAction,
  tool,
  undoCartChange,
  updateProduct,
  voiceLease,
} from "@saygo/domain";
import { runOneJob } from "@saygo/integrations";
import type {
  Scope,
  View,
  VoiceConfirmation,
  VoiceOrderEvidence,
} from "@saygo/contracts";
import { seedProducts } from "../../packages/db/src/menu";

let scope: Scope, connection: string;
const asView = (value: Record<string, unknown>) => value as unknown as View;
const customer = () => ({ ...scope, actor: "customer" as const });
beforeAll(() => {
  expect(config.DYNAMODB_NAMESPACE).toBe("saygo_test");
  expect(["127.0.0.1", "localhost"]).toContain(
    new URL(config.DYNAMODB_ENDPOINT!).hostname,
  );
});
afterAll(async () => {
  await store.close();
});
beforeEach(async () => {
  await resetDemo();
  await transaction(async (tx) => {
    for (const data of seedProducts)
      await tx.update("products", data.id, { data });
    await tx.update("restaurants", RESTAURANT, {
      pos_mode: "accept",
      menu_version: 1,
      price_version: 1,
    });
  });
  scope = { ...(await beginInteraction("lane-1")).scope, actor: "agent" };
  connection = randomUUID();
  await tool(scope, "apply_cart_changes", {
    expected_version: 0,
    request_id: randomUUID(),
    commands: [
      { type: "add", product_id: "classic", choices: { remove: ["onions"] } },
      {
        type: "add",
        product_id: "lemonade",
        variant: "medium",
        choices: { ice: ["none"] },
      },
    ],
  });
  await voiceLease(
    scope.session_id,
    new Date(Date.now() + 20000).toISOString(),
    connection,
  );
});

async function reading() {
  const current = await getView(scope);
  const quote = asView(
    await tool(scope, "prepare_order_review", {
      expected_version: current.cart_version,
      request_id: randomUUID(),
    }),
  ).quote!;
  return prepareVoiceConfirmation(scope, {
    connection_id: connection,
    quote_id: quote.id,
    request_id: randomUUID(),
  });
}
async function armed() {
  const view = await reading(),
    w = view.voice_confirmation!;
  return armVoiceConfirmation(scope, {
    connection_id: connection,
    readback_id: w.readback_id,
    readback_hash: w.readback_hash,
    turn_sequence: 2,
  });
}
async function evidence(
  window: VoiceConfirmation,
  transcript = "Yes, place the order.",
): Promise<VoiceOrderEvidence> {
  const started = Math.max(Date.parse(window.ready_at!), Date.now());
  await new Promise((resolve) => setTimeout(resolve, 3));
  return {
    connection_id: connection,
    readback_id: window.readback_id,
    utterance_id: randomUUID(),
    turn_sequence: 3,
    started_at: started,
    finalized_at: Date.now(),
    transcript,
    source: "nova_audio",
    final: true,
  };
}
async function noCommit() {
  expect(await store.list("orders")).toHaveLength(0);
  expect(await store.list("approvals")).toHaveLength(0);
  expect(await store.list("jobs")).toHaveLength(0);
  expect(await store.list("pos_receipts")).toHaveLength(0);
}

describe("trusted voice confirmation and durable sandbox ordering", () => {
  it("requires a completed exact readback and then atomically records one voice approval/order", async () => {
    const first = await reading(),
      w = first.voice_confirmation!;
    expect(w).toMatchObject({
      status: "reading",
      ready_at: null,
      session_id: scope.session_id,
      fence: 0,
      cart_version: 1,
      totals: { total: 972 },
    });
    expect(w.readback_text).toContain("One Classic Burger, no onions.");
    expect(w.readback_text).toContain("One Lemonade, medium, no ice.");
    expect(w.readback_text).toContain(
      "nine dollars and seventy-two cents including tax",
    );
    expect(w).not.toHaveProperty("connection_id");
    await noCommit();
    await expect(
      confirmVoiceOrder(
        scope,
        await evidence({ ...w, ready_at: new Date().toISOString() }),
      ),
    ).rejects.toMatchObject({ code: "VOICE_NOT_READY" });
    await expect(
      armVoiceConfirmation(scope, {
        connection_id: connection,
        readback_id: w.readback_id,
        readback_hash: "0".repeat(64),
        turn_sequence: 2,
      }),
    ).rejects.toMatchObject({ code: "VOICE_READBACK" });
    const ready = await armVoiceConfirmation(scope, {
      connection_id: connection,
      readback_id: w.readback_id,
      readback_hash: w.readback_hash,
      turn_sequence: 2,
    });
    expect(
      Date.parse(ready.voice_confirmation!.expires_at) -
        Date.parse(ready.voice_confirmation!.ready_at!),
    ).toBeLessThanOrEqual(20000);
    const result = await confirmVoiceOrder(
      scope,
      await evidence(ready.voice_confirmation!),
    );
    expect(result.order).toMatchObject({
      status: "submitted",
      snapshot: { totals: { total: 972 } },
    });
    expect(result.voice_confirmation).toBeNull();
    const rows = await store.list("approvals");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "voice",
      quote_id:
        result.order && (await store.get("orders", scope.session_id))!.quote_id,
      voice_evidence: { connection_id: connection, readback_id: w.readback_id },
    });
    expect(rows[0].consumed_at).toBeTruthy();
    await Promise.all([runOneJob(), runOneJob()]);
    expect((await getView(scope)).order?.status).toBe("accepted");
    expect(await store.list("pos_receipts")).toHaveLength(1);
  });

  it.each([
    "okay",
    "yes",
    "do not place the order",
    "no",
    "maybe yes place the order",
    "yes place the order but change the drink",
  ])("does not submit %s and disarms that window", async (text) => {
    const current = await armed();
    const result = await confirmVoiceOrder(
      scope,
      await evidence(current.voice_confirmation!, text),
    );
    expect(result.order).toBeNull();
    expect(result.voice_confirmation).toBeNull();
    await noCommit();
  });

  it("rejects malformed, partial, typed and hallucinated proof without any approval", async () => {
    const ready = await armed(),
      proof = await evidence(ready.voice_confirmation!);
    for (const change of [
      { final: false },
      { source: "text" },
      { source: "model_tool" },
      { approved: true },
    ])
      await expect(
        confirmVoiceOrder(scope, {
          ...proof,
          ...change,
        } as unknown as VoiceOrderEvidence),
      ).rejects.toThrow();
    await expect(confirmVoiceOrder(customer(), proof)).rejects.toMatchObject({
      code: "VOICE_CONSENT",
    });
    await noCommit();
  });

  it("rejects audio begun before readiness, an old turn sequence and future timestamps", async () => {
    const ready = await armed(),
      w = ready.voice_confirmation!,
      proof = await evidence(w);
    await expect(
      confirmVoiceOrder(scope, {
        ...proof,
        started_at: Date.parse(w.ready_at!) - 1,
      }),
    ).rejects.toMatchObject({ code: "VOICE_STALE_AUDIO" });
    await expect(
      confirmVoiceOrder(scope, { ...proof, turn_sequence: 2 }),
    ).rejects.toMatchObject({ code: "VOICE_NOT_READY" });
    await expect(
      confirmVoiceOrder(scope, { ...proof, finalized_at: Date.now() + 10000 }),
    ).rejects.toMatchObject({ code: "VOICE_STALE_AUDIO" });
    await noCommit();
  });

  it("retries the same prepare/arm without extending consent and commits identical concurrent proofs once", async () => {
    const quote = asView(
      await tool(scope, "prepare_order_review", {
        expected_version: 1,
        request_id: randomUUID(),
      }),
    ).quote!;
    const request = {
      connection_id: connection,
      quote_id: quote.id,
      request_id: randomUUID(),
    };
    const first = await prepareVoiceConfirmation(scope, request),
      second = await prepareVoiceConfirmation(scope, request);
    expect(second.voice_confirmation).toEqual(first.voice_confirmation);
    const arm = {
      connection_id: connection,
      readback_id: first.voice_confirmation!.readback_id,
      readback_hash: first.voice_confirmation!.readback_hash,
      turn_sequence: 2,
    };
    const ready = await armVoiceConfirmation(scope, arm),
      retried = await armVoiceConfirmation(scope, arm);
    expect(retried.voice_confirmation).toEqual(ready.voice_confirmation);
    const proof = await evidence(ready.voice_confirmation!);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => confirmVoiceOrder(scope, proof)),
    );
    expect(new Set(results.map((r) => r.order!.id)).size).toBe(1);
    await expect(
      confirmVoiceOrder(scope, { ...proof, utterance_id: randomUUID() }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(await store.list("orders")).toHaveLength(1);
    expect(await store.list("approvals")).toHaveLength(1);
    expect(await store.list("jobs")).toHaveLength(1);
    await Promise.all([runOneJob(), runOneJob()]);
    expect(await store.list("pos_receipts")).toHaveLength(1);
  });

  it("invalidates a readback after a correction and can read and confirm the new draft", async () => {
    const ready = await armed(),
      oldProof = await evidence(ready.voice_confirmation!);
    await tool(scope, "apply_cart_changes", {
      expected_version: ready.cart_version,
      request_id: randomUUID(),
      commands: [
        { type: "update", line_id: ready.lines[1].id, variant: "large" },
      ],
    });
    expect((await getView(scope)).voice_confirmation).toBeNull();
    await expect(confirmVoiceOrder(scope, oldProof)).rejects.toMatchObject({
      code: "VOICE_CONFIRMATION_EXPIRED",
    });
    await noCommit();
    const next = await armed();
    expect(next.voice_confirmation!.readback_id).not.toBe(
      ready.voice_confirmation!.readback_id,
    );
    expect(next.voice_confirmation!.readback_text).toContain("large, no ice");
    expect(
      (await confirmVoiceOrder(scope, await evidence(next.voice_confirmation!)))
        .order,
    ).not.toBeNull();
  });

  it("disconnect and Undo invalidate the old readback and do not revive it after reconnect", async () => {
    const before = await getView(scope);
    await tool(scope, "apply_cart_changes", {
      expected_version: before.cart_version,
      request_id: randomUUID(),
      commands: [
        { type: "update", line_id: before.lines[1].id, variant: "large" },
      ],
    });
    const ready = await armed(),
      proof = await evidence(ready.voice_confirmation!);
    await voiceLease(scope.session_id, null, connection);
    expect((await getView(scope)).voice_confirmation).toBeNull();
    const undo = await getView(customer());
    await undoCartChange(customer(), {
      expected_version: undo.cart_version,
      receipt_id: undo.last_change!.id,
      request_id: randomUUID(),
    });
    connection = randomUUID();
    await voiceLease(
      scope.session_id,
      new Date(Date.now() + 20000).toISOString(),
      connection,
    );
    await expect(confirmVoiceOrder(scope, proof)).rejects.toMatchObject({
      code: "VOICE_CONNECTION",
    });
    expect((await getView(scope)).voice_confirmation).toBeNull();
    await noCommit();
  });

  it("old connection cleanup cannot erase a newly armed readback", async () => {
    const first = await armed(),
      old = connection;
    await invalidateVoiceConfirmation(scope, connection);
    await voiceLease(scope.session_id, null, connection);
    connection = randomUUID();
    await voiceLease(
      scope.session_id,
      new Date(Date.now() + 20000).toISOString(),
      connection,
    );
    const next = await armed();
    await voiceLease(scope.session_id, null, old);
    await invalidateVoiceConfirmation(scope, old);
    expect((await getView(scope)).voice_confirmation).toEqual(
      next.voice_confirmation,
    );
    await expect(
      confirmVoiceOrder(scope, await evidence(first.voice_confirmation!)),
    ).rejects.toMatchObject({ code: "VOICE_CONFIRMATION_EXPIRED" });
    await noCommit();
  });

  it("staff takeover fences pending consent and release does not revive it", async () => {
    const ready = await armed(),
      proof = await evidence(ready.voice_confirmation!);
    const staff = { ...scope, actor: "staff" as const };
    await staffAction(staff, "takeover");
    await expect(confirmVoiceOrder(scope, proof)).rejects.toMatchObject({
      code: "FENCED",
    });
    expect((await getView(customer())).voice_confirmation).toBeNull();
    await voiceLease(scope.session_id, null, connection);
    await staffAction(staff, "release");
    const current = await getView(customer());
    expect(current.voice_confirmation).toBeNull();
    await noCommit();
  });

  it("expires confirmation, rejects changed prices and ends consent for a new customer", async () => {
    let ready = await armed(),
      proof = await evidence(ready.voice_confirmation!);
    const row = (await store.get("interactions", scope.session_id))!;
    await store.update("interactions", scope.session_id, {
      voice_confirmation: {
        ...row.voice_confirmation!,
        expires_at: new Date(Date.now() - 1).toISOString(),
      },
    });
    await expect(confirmVoiceOrder(scope, proof)).rejects.toMatchObject({
      code: "VOICE_CONFIRMATION_EXPIRED",
    });
    expect((await getView(scope)).voice_confirmation).toBeNull();
    ready = await armed();
    proof = await evidence(ready.voice_confirmation!);
    await updateProduct("classic", { variants: { regular: 600 } });
    expect((await getView(scope)).voice_confirmation).toBeNull();
    await expect(confirmVoiceOrder(scope, proof)).rejects.toMatchObject({
      code: "STALE_QUOTE",
    });
    await beginInteraction("lane-1");
    await expect(confirmVoiceOrder(scope, proof)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    await noCommit();
  });

  it("does not let model MCP submission or screen consent bypass the active voice gate", async () => {
    const ready = await armed(),
      quote = ready.quote!;
    await expect(approve(customer(), quote.id)).rejects.toMatchObject({
      code: "VOICE_PENDING",
    });
    await expect(
      tool(scope, "submit_order", { quote_id: quote.id }),
    ).rejects.toMatchObject({ code: "VOICE_PENDING" });
    await noCommit();
  });

  it("does not open another voice window for a quote already approved on screen", async () => {
    const view = await reading(),
      quote = view.quote!;
    await voiceLease(scope.session_id, null, connection);
    await approve(customer(), quote.id);
    connection = randomUUID();
    await voiceLease(
      scope.session_id,
      new Date(Date.now() + 20000).toISOString(),
      connection,
    );
    await expect(
      prepareVoiceConfirmation(scope, {
        connection_id: connection,
        quote_id: quote.id,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONSENT_ALREADY_RECORDED" });
    expect((await getView(scope)).voice_confirmation).toBeNull();
    expect(await store.list("orders")).toHaveLength(0);
    expect(await store.list("approvals")).toHaveLength(1);
  });
});
