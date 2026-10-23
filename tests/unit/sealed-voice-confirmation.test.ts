import { describe, expect, it, vi } from "vitest";
import type { Scope, View, VoiceConfirmation } from "@saygo/contracts";
import type { ProviderVoiceEvidence } from "../../packages/integrations/src/nova.js";
import { SealedVoiceConfirmationCoordinator } from "../../apps/runtime/src/sealed-voice-confirmation.js";

const scope: Scope = {
  restaurant_id: "harbor-demo",
  lane_id: "lane-1",
  session_id: "5eff38f7-662d-47f7-969c-61701a62535c",
  epoch: 1,
  fence: 2,
  actor: "agent",
};
const quoteId = "49c5ede6-cd02-4a3a-99aa-31a1ff30019b";
const readbackId = "032a9d30-4b78-4391-b410-5587a49f9973";
const hash = "a".repeat(64);
const readback =
  "One burger. Total nine dollars and seventy-two cents. Say yes, place the order to confirm.";

function harness() {
  let now = 1_000_000,
    active = true,
    count = 0;
  // Live Sonic uses one completion across review, customer speech and tools.
  const completion = "persistent-conversation-completion";
  const events: Record<string, unknown>[] = [],
    actions: string[] = [];
  const challenge = (): VoiceConfirmation => ({
    readback_id: readbackId,
    quote_id: quoteId,
    session_id: scope.session_id,
    epoch: 1,
    fence: 2,
    cart_version: 3,
    readback_hash: hash,
    readback_text: readback,
    totals: { subtotal: 900, tax: 72, total: 972, currency: "USD" },
    status: "reading",
    ready_at: null,
    expires_at: new Date(1_060_000).toISOString(),
  });
  const view = (window: VoiceConfirmation | null = null) =>
    ({
      session: { id: scope.session_id, epoch: 1, fence: 2, owner: "ai" },
      cart_version: 3,
      voice_confirmation: window,
      order: null,
    }) as View;
  const services = {
    prepare: vi.fn(async () => view(challenge())),
    arm: vi.fn(async () =>
      view({
        ...challenge(),
        status: "awaiting_confirmation",
        ready_at: new Date(now).toISOString(),
        expires_at: new Date(now + 20000).toISOString(),
      }),
    ),
    record: vi.fn(async () => {
      actions.push("record");
      return view();
    }),
    invalidate: vi.fn(async () => {}),
  };
  const releaseLease = vi.fn(async () => {
    actions.push("release");
  });
  const submit = vi.fn(async () => {
    actions.push("submit");
    return { order: { id: "one-order" } };
  });
  const onExpire = vi.fn();
  const coordinator = new SealedVoiceConfirmationCoordinator({
    scope,
    connectionId: "server-connection",
    clock: () => now,
    active: () => active,
    services,
    releaseLease,
    submit,
    onExpire,
    send: (e) => events.push(e),
  });
  const evidence = (event: Partial<ProviderVoiceEvidence> & { name: string }) =>
    coordinator.observeProvider({
      at: now,
      generation: 0,
      completionId: completion,
      ...event,
    });
  const start = (id: string, role = "ASSISTANT", type = "TEXT", final = true) =>
    evidence({
      name: "contentStart",
      contentId: id,
      role,
      contentType: type,
      final,
    });
  const output = (id: string, text: string) =>
    evidence({ name: "textOutput", contentId: id, text });
  const end = (id: string, stopReason = "END_TURN") =>
    evidence({ name: "contentEnd", contentId: id, stopReason });
  const ready = async (beforeReview?: () => void) => {
    evidence({ name: "completionStart" });
    beforeReview?.();
    await coordinator.transformToolResult(
      "prepare_order_review",
      {},
      { quote: { id: quoteId }, cart_version: 3 },
    );
    start("readback-final");
    output("readback-final", readback);
    start("readback-audio", "ASSISTANT", "AUDIO", false);
    evidence({
      name: "audioOutput",
      contentId: "readback-audio",
      audioBytes: 4800,
    });
    end("readback-final");
    end("readback-audio");
    now += 100;
    await coordinator.playbackAck({
      type: "readback_played",
      readback_id: readbackId,
      readback_hash: hash,
      generation: 0,
    });
  };
  const beginCapture = () => {
    coordinator.captureStart({
      type: "confirmation_capture_start",
      readback_id: readbackId,
      readback_hash: hash,
      generation: 0,
    });
    return events.find((e) => e.type === "confirmation_capture_started")
      ?.capture_id;
  };
  const audio = (silent = false) => {
    now += 10;
    for (let frame = 0; frame < 50; frame++) {
      const pcm = Buffer.alloc(640);
      if (!silent)
        for (let sample = 0; sample < pcm.length; sample += 2)
          pcm.writeInt16LE(1000, sample);
      expect(coordinator.acceptAudio(pcm)).toBe(true);
      now += 20;
    }
  };
  const capture = (silent = false) => {
    const id = beginCapture();
    audio(silent);
    return id;
  };
  const user = (
    text = "Yes, place the order.",
    stopReason = "PARTIAL_TURN",
    final = true,
  ) => {
    const id = `user-${++count}`;
    start(id, "USER", "TEXT", final);
    output(id, text);
    end(id, stopReason);
    return id;
  };
  const seal = (id: unknown) =>
    coordinator.captureEnd({
      type: "confirmation_capture_end",
      capture_id: id,
    });
  const retain = () => {
    const result = coordinator.retainSubmission({ quote_id: quoteId });
    coordinator.submissionPendingSent();
    return result;
  };
  return {
    coordinator,
    services,
    submit,
    onExpire,
    releaseLease,
    actions,
    events,
    ready,
    beginCapture,
    capture,
    user,
    seal,
    retain,
    start,
    output,
    end,
    evidence,
    advance: (ms: number) => {
      now += ms;
    },
    deactivate: () => {
      active = false;
    },
  };
}

describe("sealed application recording confirmation", () => {
  it.each(["reading", "ready", "capturing", "sealed"])(
    "expires %s approval without stopping ordinary audio unless capture has started",
    async (phase) => {
      vi.useFakeTimers();
      try {
        const h = harness();
        if (phase === "reading")
          await h.coordinator.transformToolResult(
            "prepare_order_review",
            {},
            { quote: { id: quoteId }, cart_version: 3 },
          );
        else await h.ready();
        const captured = phase === "capturing" || phase === "sealed";
        if (captured) {
          const id = h.capture();
          if (phase === "sealed") h.seal(id);
        }
        h.advance(60000);
        await vi.advanceTimersByTimeAsync(60000);
        await h.coordinator.drain();
        expect(h.coordinator.snapshot().reason).toBe("CONFIRMATION_EXPIRED");
        expect(h.onExpire).toHaveBeenCalledTimes(captured ? 1 : 0);
        expect(h.coordinator.acceptAudio(Buffer.alloc(640))).toBe(!captured);
        expect(h.services.record).not.toHaveBeenCalled();
        expect(h.submit).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("keeps ordinary PCM flowing during an unsolicited readback and after fresh USER input invalidates it", async () => {
    const h = harness();
    await h.coordinator.transformToolResult(
      "prepare_order_review",
      {},
      { quote: { id: quoteId }, cart_version: 3 },
    );
    expect(h.coordinator.acceptAudio(Buffer.alloc(640))).toBe(true);
    h.user("What comes on the classic burger?");
    expect(h.coordinator.snapshot().reason).toBe(
      "USER_TRANSCRIPT_OUTSIDE_CAPTURE",
    );
    expect(h.coordinator.acceptAudio(Buffer.alloc(640))).toBe(true);
    expect(h.retain()).toHaveProperty("error");
    await h.coordinator.finish(true);
    expect(h.services.record).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("accepts fresh USER content on the persistent review completion only after natural drain, then releases the lease before real submit", async () => {
    const h = harness();
    await h.ready();
    expect(h.events).toContainEqual({
      type: "confirmation_readback_complete",
      readback_id: readbackId,
      readback_hash: hash,
      generation: 0,
    });
    expect(h.coordinator.acceptAudio(Buffer.alloc(640))).toBe(false);
    const id = h.capture();
    h.user();
    expect(h.retain()).toMatchObject({ code: "PENDING_VERIFICATION" });
    expect(h.services.record).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.seal(id)).toBe(true);
    expect(h.coordinator.shouldFinishSession()).toBe(true);
    await h.coordinator.finish(true);
    expect(h.actions).toEqual(["record", "release", "submit"]);
    expect(h.services.record.mock.calls[0]).toEqual([
      expect.objectContaining({ actor: "agent" }),
      expect.objectContaining({
        transcript: "Yes, place the order.",
        utterance_id: id,
        source: "nova_audio",
        final: true,
      }),
    ]);
    expect(h.submit).toHaveBeenCalledExactlyOnceWith({ quote_id: quoteId });
    expect(h.events).toContainEqual({
      type: "confirmation_committed",
      order_id: "one-order",
    });
    await h.coordinator.finish(true);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });
  it.each([false, undefined])(
    "rejects non-natural or missing EOF (%s)",
    async (natural) => {
      const h = harness();
      await h.ready();
      const id = h.capture();
      h.user();
      h.retain();
      h.seal(id);
      await h.coordinator.finish(natural as boolean);
      expect(h.services.record).not.toHaveBeenCalled();
      expect(h.submit).not.toHaveBeenCalled();
    },
  );
  it("retains delayed negative fragments through the seal and rejects the whole transcript", async () => {
    const h = harness();
    await h.ready();
    const id = h.capture();
    h.user();
    h.retain();
    h.seal(id);
    h.user("Actually no, do not place it.");
    await h.coordinator.finish(true);
    expect(h.services.record).not.toHaveBeenCalled();
  });
  it("does not turn a partial fragment or assistant completion into EOF proof", async () => {
    const h = harness();
    await h.ready();
    const id = h.capture();
    h.user();
    h.retain();
    h.seal(id);
    h.evidence({ name: "completionEnd" });
    expect(h.services.record).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("keeps the sealed session open across an unrelated completion until the model requests submit", async () => {
    const h = harness();
    await h.ready();
    const id = h.capture();
    h.user();
    h.seal(id);
    h.evidence({ name: "completionEnd" });
    expect(h.coordinator.shouldFinishSession()).toBe(false);
    expect(h.services.record).not.toHaveBeenCalled();
    h.retain();
    expect(h.coordinator.shouldFinishSession()).toBe(true);
  });
  it.each([
    "open",
    "provisional",
    "interrupted",
    "changed quote",
    "typed",
    "disconnected",
    "expired",
    "no intent",
    "unsealed",
  ])("rejects %s evidence", async (kind) => {
    const h = harness();
    await h.ready();
    const id = h.capture();
    if (kind === "open") {
      h.start("open-user", "USER");
      h.output("open-user", "Yes, place the order.");
    } else
      h.user(
        "Yes, place the order.",
        kind === "interrupted" ? "INTERRUPTED" : "PARTIAL_TURN",
        kind !== "provisional",
      );
    if (kind !== "no intent") h.retain();
    if (kind !== "unsealed") h.seal(id);
    if (kind === "changed quote")
      h.coordinator.observeView({ cart_version: 4 });
    if (kind === "typed") await h.coordinator.typedInput();
    if (kind === "disconnected") {
      h.deactivate();
      await h.coordinator.disconnect();
    }
    if (kind === "expired") h.advance(21000);
    await h.coordinator.finish(true);
    expect(h.services.record).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("cannot capture or retain an order from browser transcript JSON or an earlier model request", async () => {
    const h = harness();
    expect(
      h.coordinator.retainSubmission({ quote_id: quoteId }),
    ).toHaveProperty("error");
    await h.coordinator.finish(true);
    expect(h.services.record).not.toHaveBeenCalled();
    expect(
      h.coordinator.captureStart({
        type: "confirmation_capture_start",
        transcript: "Yes, place the order",
      }),
    ).toBe(false);
  });
  it("rejects extra assistant output after readback and before capture", async () => {
    const h = harness();
    await h.ready();
    h.start("extra-assistant", "ASSISTANT");
    expect(h.coordinator.snapshot().reason).toBe("INVALID_READBACK_EVIDENCE");
    expect(
      h.coordinator.captureStart({
        type: "confirmation_capture_start",
        readback_id: readbackId,
        readback_hash: hash,
        generation: 0,
      }),
    ).toBe(false);
    expect(h.services.record).not.toHaveBeenCalled();
  });
  it("rejects delayed output from a USER content block that existed before capture", async () => {
    const h = harness();
    let oldId = "";
    await h.ready(() => {
      oldId = h.user("Review my order.");
    });
    const id = h.capture();
    h.output(oldId, "Yes, place the order.");
    h.retain();
    h.seal(id);
    await h.coordinator.finish(true);
    expect(h.coordinator.snapshot().reason).toBe("STALE_USER_TRANSCRIPT");
    expect(h.services.record).not.toHaveBeenCalled();
  });
  it("rejects open pre-capture USER content even on the persistent completion", async () => {
    const h = harness();
    await h.ready(() => {
      h.start("old-open-user", "USER");
      h.output("old-open-user", "Review my order.");
    });
    expect(h.beginCapture()).toBeUndefined();
    expect(h.coordinator.snapshot().reason).toBe("INVALID_CAPTURE_START");
    expect(h.services.record).not.toHaveBeenCalled();
  });
  it("rejects USER content before the capture has received fresh signaled PCM", async () => {
    const h = harness();
    await h.ready();
    const id = h.beginCapture();
    h.user();
    h.retain();
    h.seal(id);
    await h.coordinator.finish(true);
    expect(h.coordinator.snapshot().reason).toBe(
      "UNVERIFIED_CAPTURE_TRANSCRIPT",
    );
    expect(h.services.record).not.toHaveBeenCalled();
  });
  it.each(["replayed content", "unknown completion", "stale generation"])(
    "rejects %s at the fresh USER boundary",
    async (kind) => {
      const h = harness();
      await h.ready();
      const id = h.capture();
      h.evidence({
        name: "contentStart",
        contentId:
          kind === "replayed content" ? "readback-final" : "fresh-user",
        ...(kind === "unknown completion"
          ? { completionId: "unobserved-completion" }
          : {}),
        generation: kind === "stale generation" ? -1 : 0,
        role: "USER",
        contentType: "TEXT",
        final: true,
      });
      h.retain();
      h.seal(id);
      await h.coordinator.finish(true);
      expect(h.services.record).not.toHaveBeenCalled();
      expect(h.submit).not.toHaveBeenCalled();
    },
  );
  it("collects split affirmative USER content across the same completion through natural EOF", async () => {
    const h = harness();
    await h.ready();
    const id = h.capture();
    h.user("Yes,");
    h.retain();
    h.seal(id);
    h.user("place the order.");
    await h.coordinator.finish(true);
    expect(h.services.record).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ transcript: "Yes, place the order." }),
    );
    expect(h.submit).toHaveBeenCalledExactlyOnceWith({ quote_id: quoteId });
  });
  it("rejects USER content before capture during the challenge", async () => {
    const h = harness();
    await h.ready();
    h.user("Yes, place the order.");
    expect(h.coordinator.snapshot().reason).toBe(
      "USER_TRANSCRIPT_OUTSIDE_CAPTURE",
    );
    expect(h.services.record).not.toHaveBeenCalled();
  });
  it.each(["unknown block", "missing content ID", "missing completion ID"])(
    "rejects late unbound text with no inferred USER role: %s",
    async (kind) => {
      const h = harness();
      await h.ready();
      const id = h.capture();
      h.user();
      h.retain();
      h.seal(id);
      h.evidence({
        name: "textOutput",
        contentId:
          kind === "missing content ID" ? undefined : "unbound-negative",
        ...(kind === "missing completion ID"
          ? { completionId: undefined }
          : {}),
        text: "Actually no, do not place the order.",
      });
      await h.coordinator.finish(true);
      expect(h.coordinator.snapshot().reason).toBe("UNBOUND_CAPTURE_CONTENT");
      expect(h.services.record).not.toHaveBeenCalled();
      expect(h.submit).not.toHaveBeenCalled();
    },
  );
  it.each([
    { role: undefined, contentType: "TEXT" },
    { role: "UNKNOWN", contentType: "TEXT" },
    { role: "USER", contentType: "AUDIO" },
    { role: "ASSISTANT", contentType: "TOOL" },
    { role: "TOOL", contentType: "TEXT" },
  ])("rejects ambiguous capture content bindings: %j", async (binding) => {
    const h = harness();
    await h.ready();
    const id = h.capture();
    h.user();
    h.retain();
    h.seal(id);
    h.evidence({
      name: "contentStart",
      contentId: "ambiguous-late-content",
      final: true,
      ...binding,
    });
    await h.coordinator.finish(true);
    expect(h.coordinator.snapshot().reason).toBe("AMBIGUOUS_CAPTURE_CONTENT");
    expect(h.services.record).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
  it("rejects silent PCM even when provider text says affirmative", async () => {
    const h = harness();
    await h.ready();
    const id = h.capture(true);
    h.user();
    h.retain();
    expect(h.seal(id)).toBe(false);
    await h.coordinator.finish(true);
    expect(h.services.record).not.toHaveBeenCalled();
  });
  it("rejects a different quote, capture replay and post-seal audio", async () => {
    const h = harness();
    await h.ready();
    const id = h.capture();
    h.user();
    expect(
      h.coordinator.retainSubmission({ quote_id: readbackId }),
    ).toHaveProperty("error");
    h.seal(id);
    expect(h.coordinator.acceptAudio(Buffer.alloc(640))).toBe(false);
    expect(h.seal(id)).toBe(false);
    await h.coordinator.finish(true);
    expect(h.services.record).not.toHaveBeenCalled();
  });
  it("does not submit if the socket ends while domain consent recording is pending", async () => {
    const h = harness();
    await h.ready();
    const id = h.capture();
    h.user();
    h.retain();
    h.seal(id);
    let resolve!: (value: View) => void;
    h.services.record.mockImplementationOnce(
      () =>
        new Promise<View>((done) => {
          resolve = done;
        }),
    );
    const finishing = h.coordinator.finish(true);
    h.deactivate();
    await h.coordinator.disconnect();
    resolve({ order: null } as View);
    await finishing;
    expect(h.releaseLease).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
});
