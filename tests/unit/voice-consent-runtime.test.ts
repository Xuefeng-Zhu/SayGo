import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scope, View, VoiceConfirmation } from "@saygo/contracts";
import type { ProviderVoiceEvidence } from "../../packages/integrations/src/nova.js";
import { ReadbackPlayback } from "../../apps/web/app/components/readback-playback.js";
import {
  CURRENT_NOVA_VOICE_CONFIRMATION_SUPPORTED,
  VoiceConfirmationCoordinator,
  readbackPlayedSchema,
} from "../../apps/runtime/src/voice-confirmation.js";

vi.mock("@saygo/domain", () => ({
  prepareVoiceConfirmation: vi.fn(),
  armVoiceConfirmation: vi.fn(),
  confirmVoiceOrder: vi.fn(),
  invalidateVoiceConfirmation: vi.fn(),
}));

const scope: Scope = {
  restaurant_id: "harbor-demo",
  lane_id: "lane-1",
  session_id: "5eff38f7-662d-47f7-969c-61701a62535c",
  epoch: 1,
  fence: 2,
  actor: "customer",
};
const id = "032a9d30-4b78-4391-b410-5587a49f9973";
const quoteId = "49c5ede6-cd02-4a3a-99aa-31a1ff30019b";
const hash = "a".repeat(64);
const text =
  "One Classic Burger, no onions. Total six dollars and forty-eight cents including tax. Say yes, place the order to confirm, or tell me what to change.";
const ack = {
  type: "readback_played" as const,
  readback_id: id,
  readback_hash: hash,
  generation: 0,
};

function harness(supported = true) {
  let now = 1_000_000;
  const events: Record<string, unknown>[] = [];
  const challenge = (): VoiceConfirmation => ({
    readback_id: id,
    quote_id: quoteId,
    session_id: scope.session_id,
    epoch: scope.epoch,
    fence: scope.fence,
    cart_version: 3,
    readback_hash: hash,
    readback_text: text,
    totals: { subtotal: 600, tax: 48, total: 648, currency: "USD" },
    status: "reading",
    ready_at: null,
    expires_at: new Date(1_060_000).toISOString(),
  });
  const view = (
    window: VoiceConfirmation | null = null,
    order: View["order"] = null,
  ) =>
    ({
      session: { id: scope.session_id, epoch: 1, fence: 2, owner: "ai" },
      cart_version: 3,
      voice_confirmation: window,
      order,
    }) as View;
  const services = {
    prepare: vi
      .fn<() => Promise<View>>()
      .mockImplementation(async () => view(challenge())),
    arm: vi.fn<() => Promise<View>>().mockImplementation(async () =>
      view({
        ...challenge(),
        status: "awaiting_confirmation",
        ready_at: new Date(now).toISOString(),
        expires_at: new Date(now + 20000).toISOString(),
      }),
    ),
    confirm: vi.fn<() => Promise<View>>().mockImplementation(async () =>
      view(null, {
        id: "one-mock-order",
        status: "submitted",
      } as View["order"]),
    ),
    invalidate: vi.fn<() => Promise<void>>().mockResolvedValue(),
  };
  const coordinator = new VoiceConfirmationCoordinator({
    scope,
    connectionId: "server-owned-connection",
    certifiedWholeUserTurns: supported,
    clock: () => now,
    services,
    send: (event) => events.push(event),
  });
  const evidence = (event: Partial<ProviderVoiceEvidence> & { name: string }) =>
    coordinator.observeProvider({
      at: now,
      generation: 0,
      completionId: "provider-connection-completion",
      ...event,
    });
  const start = (
    contentId: string,
    role = "ASSISTANT",
    contentType = "TEXT",
    final = true,
  ) => evidence({ name: "contentStart", contentId, role, contentType, final });
  const output = (contentId: string, value: string) =>
    evidence({ name: "textOutput", contentId, text: value });
  const end = (contentId: string, stopReason = "END_TURN") =>
    evidence({ name: "contentEnd", contentId, stopReason });
  const review = (
    result: Record<string, unknown> = {
      quote: { id: quoteId },
      cart_version: 3,
    },
  ) => coordinator.transformToolResult("prepare_order_review", {}, result);
  const readback = (spoken = text) => {
    start("readback-text");
    output("readback-text", spoken);
    start("readback-audio", "ASSISTANT", "AUDIO", false);
    evidence({
      name: "audioOutput",
      contentId: "readback-audio",
      audioBytes: 4800,
    });
    end("readback-text");
    end("readback-audio");
  };
  const ready = async () => {
    await review();
    readback();
    now += 100;
    await coordinator.playbackAck(ack);
  };
  const user = (
    transcript = "Yes, place the order.",
    stopReason = "END_TURN",
    utteranceId = "customer-turn",
  ) => {
    now += 10;
    coordinator.beginCertifiedUserTurn({
      utteranceId,
      sequence: 1,
      startedAt: now,
      source: "nova_audio",
    });
    start("user-final", "USER");
    output("user-final", transcript);
    now += 200;
    end("user-final", stopReason);
  };
  return {
    coordinator,
    services,
    events,
    challenge,
    view,
    evidence,
    start,
    output,
    end,
    review,
    readback,
    ready,
    user,
    advance: (ms: number) => {
      now += ms;
    },
    time: () => now,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("current Nova capability is fail closed", () => {
  it("is a fixed false production capability and announces the specific fallback", () => {
    expect(CURRENT_NOVA_VOICE_CONFIRMATION_SUPPORTED).toBe(false);
    const h = harness(false);
    h.coordinator.announceCapability();
    expect(h.events).toEqual([
      expect.objectContaining({
        type: "confirmation_unavailable",
        code: "UNSUPPORTED_USER_TURN_BOUNDARY",
      }),
    ]);
  });
  it("returns a truthful screen review without opening any voice window", async () => {
    const h = harness(false);
    const result = await h.review();
    expect(result).toMatchObject({
      voice_confirmation: null,
      voice_confirmation_available: false,
    });
    expect(result.summary).toContain("Stop voice");
    expect(h.services.prepare).not.toHaveBeenCalled();
  });
  it("ignores fabricated ready, complete, model orders and browser proof", async () => {
    const h = harness(false);
    await h.review({
      quote: { id: quoteId },
      voice_confirmation: h.challenge(),
      order: { id: "model-fiction" },
    });
    h.readback();
    await h.coordinator.playbackAck({
      ...ack,
      transcript: "Yes, place the order",
      final: true,
    });
    await h.coordinator.playbackAck(ack);
    h.user();
    h.end("readback-audio");
    await h.coordinator.drain();
    expect(h.services.prepare).not.toHaveBeenCalled();
    expect(h.services.arm).not.toHaveBeenCalled();
    expect(h.services.confirm).not.toHaveBeenCalled();
    expect(h.events.some((event) => event.type === "confirmation_ready")).toBe(
      false,
    );
  });
  it("does not convert model submit tool output into evidence", async () => {
    const h = harness(false);
    const result = {
      order: { id: "hallucinated" },
      transcript: "Yes, place the order",
    };
    expect(
      await h.coordinator.transformToolResult("submit_order", {}, result),
    ).toBe(result);
    expect(h.services.confirm).not.toHaveBeenCalled();
  });
  it("does not replace a tool error with success instructions", async () => {
    const h = harness(false);
    const result = {
      error: { code: "STALE_QUOTE" },
      summary: "Read the current cart.",
    };
    expect(await h.review(result)).toBe(result);
  });
  it("cleans only this server connection on repeated disconnect", async () => {
    const h = harness(false);
    await Promise.all([h.coordinator.disconnect(), h.coordinator.disconnect()]);
    expect(h.services.invalidate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ actor: "agent", session_id: scope.session_id }),
      "server-owned-connection",
    );
  });
});

describe("future certified adapter bridge (synthetic evidence only)", () => {
  it("emits the exact browser readback contract and arms from its actual playback receipt", async () => {
    const h = harness();
    const playback = new ReadbackPlayback();
    await h.review();
    expect(h.events[0]).toEqual({
      type: "confirmation_readback",
      readback_id: id,
      readback_hash: hash,
      generation: 0,
      cart_version: 3,
      expires_at: h.challenge().expires_at,
    });
    playback.begin(h.events[0], 0, h.time());
    h.readback();
    expect(h.events[1]).toEqual({
      type: "confirmation_readback_complete",
      readback_id: id,
      readback_hash: hash,
      generation: 0,
    });
    playback.audio(0);
    playback.complete(h.events[1]);
    h.advance(100);
    const receipt = playback.played({
      generation: 0,
      queuedSources: 0,
      cartVersion: 3,
      running: true,
      now: h.time(),
    });
    expect(receipt).toEqual(ack);
    await h.coordinator.playbackAck(receipt);
    expect(h.services.arm).toHaveBeenCalledOnce();
    expect(h.events[2]).toEqual({
      type: "confirmation_ready",
      readback_id: id,
      expires_at: new Date(h.time() + 20000).toISOString(),
    });
    expect(h.services.confirm).not.toHaveBeenCalled();
  });
  it("requires verified readback, drained playback and final whole user turn before one commit", async () => {
    const h = harness();
    await h.ready();
    expect(h.services.prepare).toHaveBeenCalledOnce();
    expect(h.services.arm).toHaveBeenCalledOnce();
    expect(h.services.confirm).not.toHaveBeenCalled();
    expect(h.events.map((event) => event.type)).toEqual([
      "confirmation_readback",
      "confirmation_readback_complete",
      "confirmation_ready",
    ]);
    h.user();
    await h.coordinator.drain();
    expect(h.services.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ actor: "agent" }),
      expect.objectContaining({
        connection_id: "server-owned-connection",
        readback_id: id,
        source: "nova_audio",
        final: true,
        transcript: "Yes, place the order.",
        turn_sequence: 1,
      }),
    );
    expect(h.events).toContainEqual({
      type: "confirmation_committed",
      order_id: "one-mock-order",
    });
  });
  it("does not accept an early playback acknowledgment", async () => {
    const h = harness();
    await h.review();
    h.readback();
    await h.coordinator.playbackAck(ack);
    expect(h.services.arm).not.toHaveBeenCalled();
    h.advance(100);
    await h.coordinator.playbackAck(ack);
    expect(h.services.arm).toHaveBeenCalledOnce();
  });
  it.each([
    { readback_id: "f66c3938-67b5-4557-aa2b-cd88ce606c41" },
    { readback_hash: "b".repeat(64) },
    { generation: 1 },
    { transcript: "Yes, place the order" },
    { final: true },
    { generation: -1 },
  ])("rejects wrong or extra ACK fields: %j", async (change) => {
    const h = harness();
    await h.review();
    h.readback();
    h.advance(100);
    await h.coordinator.playbackAck({ ...ack, ...change });
    expect(h.services.arm).not.toHaveBeenCalled();
  });
  it("strictly parses playback fields without any client transcript or consent", () => {
    expect(readbackPlayedSchema.parse(ack)).toEqual(ack);
    expect(
      readbackPlayedSchema.safeParse({ ...ack, source: "nova_audio" }).success,
    ).toBe(false);
  });
  it("does not arm a shortened or invented readback", async () => {
    const h = harness();
    await h.review();
    h.readback("One burger. Say yes.");
    h.advance(100);
    await h.coordinator.playbackAck(ack);
    expect(h.services.arm).not.toHaveBeenCalled();
    expect(
      h.events.some((event) => event.type === "confirmation_readback_complete"),
    ).toBe(false);
  });
  it("does not arm text-only provider output", async () => {
    const h = harness();
    await h.review();
    h.start("readback-text");
    h.output("readback-text", text);
    h.end("readback-text");
    h.advance(100);
    await h.coordinator.playbackAck(ack);
    expect(h.services.arm).not.toHaveBeenCalled();
  });
  it("can verify late final text after owned audio completion", async () => {
    const h = harness();
    await h.review();
    h.start("readback-audio", "ASSISTANT", "AUDIO", false);
    h.evidence({
      name: "audioOutput",
      contentId: "readback-audio",
      audioBytes: 4800,
    });
    h.end("readback-audio");
    h.start("late-final");
    h.output("late-final", text);
    h.end("late-final");
    h.advance(100);
    await h.coordinator.playbackAck(ack);
    expect(h.services.arm).toHaveBeenCalledOnce();
  });
  it.each([
    "yes",
    "okay",
    "No",
    "Do not place the order",
    "Yes, place the order, no wait",
    "Yes, place the order?",
  ])("never commits ambiguous or negated speech: %s", async (transcript) => {
    const h = harness();
    await h.ready();
    h.user(transcript);
    await h.coordinator.drain();
    expect(h.services.confirm).not.toHaveBeenCalled();
    expect(h.services.invalidate).toHaveBeenCalled();
  });
  it("does not use an assistant END_TURN as the missing user boundary", async () => {
    const h = harness();
    await h.ready();
    h.user("Yes, place the order.", "PARTIAL_TURN");
    h.start("assistant-next", "ASSISTANT", "AUDIO", false);
    h.end("assistant-next", "END_TURN");
    await h.coordinator.drain();
    expect(h.services.confirm).not.toHaveBeenCalled();
  });
  it("does not manufacture a user endpoint after silence or completionEnd", async () => {
    const h = harness();
    await h.ready();
    h.user("Yes, place the order.", "PARTIAL_TURN");
    h.advance(5000);
    h.evidence({ name: "completionEnd" });
    await h.coordinator.drain();
    expect(h.services.confirm).not.toHaveBeenCalled();
  });
  it("rejects FINAL ASR without certified fresh audio onset", async () => {
    const h = harness();
    await h.ready();
    h.start("unknown-user", "USER");
    h.output("unknown-user", "Yes, place the order.");
    h.end("unknown-user");
    await h.coordinator.drain();
    expect(h.services.confirm).not.toHaveBeenCalled();
    expect(h.services.invalidate).toHaveBeenCalled();
  });
  it("rejects a provisional user transcript even with END_TURN", async () => {
    const h = harness();
    await h.ready();
    h.advance(10);
    h.coordinator.beginCertifiedUserTurn({
      utteranceId: "user",
      sequence: 1,
      startedAt: h.time(),
      source: "nova_audio",
    });
    h.start("provisional", "USER", "TEXT", false);
    h.output("provisional", "Yes, place the order.");
    h.end("provisional");
    await h.coordinator.drain();
    expect(h.services.confirm).not.toHaveBeenCalled();
  });
  it("commits only once for duplicate final provider content events", async () => {
    const h = harness();
    await h.ready();
    h.user();
    h.end("user-final");
    h.end("user-final");
    await h.coordinator.drain();
    expect(h.services.confirm).toHaveBeenCalledOnce();
  });
  it("permanently rejects typed input for this connection", async () => {
    const h = harness();
    await h.coordinator.typedInput();
    expect((await h.review()).voice_confirmation_available).toBe(false);
    h.user();
    expect(h.services.prepare).not.toHaveBeenCalled();
    expect(h.services.confirm).not.toHaveBeenCalled();
  });
  it("invalidates a ready window on interruption", async () => {
    const h = harness();
    await h.ready();
    await h.coordinator.interrupt(1);
    h.user();
    await h.coordinator.drain();
    expect(h.services.confirm).not.toHaveBeenCalled();
  });
  it.each([
    { cart_version: 4 },
    { session: { id: scope.session_id, epoch: 1, fence: 3 } },
    { session: { id: "new-customer", epoch: 2, fence: 2 } },
  ])("invalidates on edits, takeover or new customer: %j", async (view) => {
    const h = harness();
    await h.ready();
    h.coordinator.observeView(view);
    h.user();
    await h.coordinator.drain();
    expect(h.services.confirm).not.toHaveBeenCalled();
    expect(h.services.invalidate).toHaveBeenCalled();
  });
  it("expires without refreshing the confirmation deadline", async () => {
    const h = harness();
    await h.ready();
    h.advance(20001);
    h.user();
    await h.coordinator.playbackAck(ack);
    await h.coordinator.drain();
    expect(h.services.arm).toHaveBeenCalledOnce();
    expect(h.services.confirm).not.toHaveBeenCalled();
  });
  it("does not revive an in-flight prepare after disconnect", async () => {
    const h = harness();
    let resolve!: (view: View) => void;
    h.services.prepare.mockReturnValueOnce(
      new Promise<View>((done) => {
        resolve = done;
      }),
    );
    const review = h.review();
    await Promise.resolve();
    const stopped = h.coordinator.disconnect();
    resolve(h.view(h.challenge()));
    expect((await review).voice_confirmation_available).toBe(false);
    await stopped;
    expect(
      h.events.some((event) => event.type === "confirmation_readback"),
    ).toBe(false);
    expect(h.services.invalidate).toHaveBeenCalled();
  });
  it("does not publish late arm readiness after takeover", async () => {
    const h = harness();
    await h.review();
    h.readback();
    h.advance(100);
    let resolve!: (view: View) => void;
    h.services.arm.mockReturnValueOnce(
      new Promise<View>((done) => {
        resolve = done;
      }),
    );
    const arming = h.coordinator.playbackAck(ack);
    await Promise.resolve();
    h.coordinator.observeView({
      session: { id: scope.session_id, epoch: 1, fence: 3 },
    });
    resolve(
      h.view({
        ...h.challenge(),
        status: "awaiting_confirmation",
        ready_at: new Date(h.time()).toISOString(),
        expires_at: new Date(h.time() + 20000).toISOString(),
      }),
    );
    await arming;
    await h.coordinator.drain();
    expect(h.events.some((event) => event.type === "confirmation_ready")).toBe(
      false,
    );
    expect(h.services.invalidate).toHaveBeenCalled();
  });
  it("does not claim a ticket if the domain declines confirmation", async () => {
    const h = harness();
    await h.ready();
    h.services.confirm.mockResolvedValueOnce(h.view());
    h.user();
    await h.coordinator.drain();
    expect(
      h.events.some((event) => event.type === "confirmation_committed"),
    ).toBe(false);
  });
  it("fails closed on domain rejection without automatic confirmation retry", async () => {
    const h = harness();
    await h.ready();
    h.services.confirm.mockRejectedValueOnce(new Error("FENCED"));
    h.user();
    await h.coordinator.drain();
    expect(h.services.confirm).toHaveBeenCalledOnce();
    expect(
      h.events.some((event) => event.type === "confirmation_committed"),
    ).toBe(false);
    expect(h.services.invalidate).toHaveBeenCalled();
  });
});
