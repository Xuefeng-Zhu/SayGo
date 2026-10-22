import { describe, expect, it } from "vitest";
import type { VoiceConfirmation } from "@saygo/contracts";
import { VoiceConfirmationGate } from "../../packages/integrations/src/voice-confirmation.js";

const start = 100000;
const hash = "a".repeat(64);
const scope = { session_id: "customer-1", epoch: 1, fence: 2 };
const readback =
  "Your order: one Classic Burger, no onions. Total nine dollars and seventy-two cents including tax. Say yes, place the order to confirm, or tell me a change.";
const challenge = (id = "readback-1"): VoiceConfirmation => ({
  ...scope,
  readback_id: id,
  quote_id: "quote-1",
  cart_version: 4,
  readback_hash: hash,
  readback_text: readback,
  totals: { subtotal: 900, tax: 72, total: 972, currency: "USD" },
  status: "reading",
  ready_at: null,
  expires_at: new Date(start + 60000).toISOString(),
});
function finalText(
  gate: VoiceConfirmationGate,
  input: { contentId: string; generation: number; text: string; at?: number },
) {
  const completionId = "shared-completion";
  gate.registerAssistantContent({
    ...input,
    completionId,
    type: "TEXT",
    final: true,
    startedAt: input.at,
  });
  gate.assistantFinal({ ...input, completionId });
  return gate.endAssistantContent({
    contentId: input.contentId,
    completionId,
    generation: input.generation,
    stopReason: "END_TURN",
    at: input.at,
  });
}
function audio(
  gate: VoiceConfirmationGate,
  input: { generation: number; bytes: number; at?: number },
) {
  const binding = {
    contentId: "readback-audio",
    completionId: "shared-completion",
    generation: input.generation,
  };
  gate.registerAssistantContent({
    ...binding,
    type: "AUDIO",
    startedAt: input.at,
  });
  gate.assistantAudio({ ...input, ...binding });
}
function complete(
  gate: VoiceConfirmationGate,
  input: { generation: number; stopReason: string; at?: number },
) {
  return gate.assistantComplete({
    ...input,
    contentId: "readback-audio",
    completionId: "shared-completion",
  });
}
function fixture() {
  let now = start;
  const gate = new VoiceConfirmationGate("connection-1", scope, () => now);
  const setTime = (value: number) => {
    now = value;
  };
  const completeReadback = () => {
    expect(gate.beginReadback(challenge(), 3)).toBe(true);
    audio(gate, { generation: 3, bytes: 48000, at: start + 100 });
    finalText(gate, {
      contentId: "readback-text",
      generation: 3,
      text: readback,
    });
    setTime(start + 300);
    expect(
      complete(gate, { generation: 3, stopReason: "END_TURN" }),
    ).toMatchObject({
      type: "readback_complete",
      readback_id: "readback-1",
      generation: 3,
    });
  };
  const arm = () => {
    completeReadback();
    setTime(start + 1100);
    expect(
      gate.playbackAck({
        readback_id: "readback-1",
        readback_hash: hash,
        generation: 3,
      }),
    ).toMatchObject({ type: "arm" });
    expect(
      gate.markArmed("readback-1", {
        readyAt: now,
        expiresAt: now + 20000,
        turnSequence: 4,
      }),
    ).toBe(true);
  };
  const user = (text = "Yes, place the order.", stopReason = "END_TURN") => {
    setTime(start + 1200);
    expect(
      gate.beginUserTurn({
        utteranceId: "user-turn-1",
        sequence: 5,
        startedAt: now,
        source: "nova_audio",
      }),
    ).toBe(true);
    setTime(start + 1800);
    gate.finalUserFragment({
      utteranceId: "user-turn-1",
      contentId: "user-content-1",
      text,
      final: true,
      stopReason,
    });
    return gate.endUserTurn({
      utteranceId: "user-turn-1",
      terminalContentId: "user-content-1",
      stopReason: "END_TURN",
    });
  };
  return { gate, setTime, completeReadback, arm, user };
}

describe("voice confirmation gateway", () => {
  it("produces one server evidence object only after exact readback, played ack and whole final user turn", () => {
    const f = fixture();
    f.arm();
    expect(f.user()).toEqual({
      connection_id: "connection-1",
      readback_id: "readback-1",
      utterance_id: "user-turn-1",
      turn_sequence: 5,
      started_at: start + 1200,
      finalized_at: start + 1800,
      transcript: "Yes, place the order.",
      source: "nova_audio",
      final: true,
    });
    expect(
      f.gate.endUserTurn({
        utteranceId: "user-turn-1",
        terminalContentId: "user-content-1",
        stopReason: "END_TURN",
      }),
    ).toBeUndefined();
    expect(f.gate.snapshot().phase).toBe("processing");
  });

  it.each([
    "yes",
    "okay",
    "yes please",
    "do not place the order",
    "Yes, place the order. No, don't.",
    "Maybe yes, place the order",
    "Yes, place the order?",
    "Yes, place the order and add fries",
  ])("rejects ambiguous, negative or compound consent: %s", (text) => {
    const f = fixture();
    f.arm();
    expect(f.user(text)).toBeUndefined();
    expect(f.gate.snapshot().reason).toBe("NOT_EXPLICIT_ORDER_CONFIRMATION");
  });

  it("does not treat USER FINAL PARTIAL_TURN as a complete utterance", () => {
    const f = fixture();
    f.arm();
    expect(f.user("Yes, place the order.", "PARTIAL_TURN")).toBeUndefined();
    expect(f.gate.snapshot()).toMatchObject({
      phase: "collecting",
      reason: "UNSUPPORTED_USER_TURN_BOUNDARY",
    });
  });

  it("aggregates all final fragments and rejects affirmative then negation", () => {
    const f = fixture();
    f.arm();
    f.setTime(start + 1200);
    f.gate.beginUserTurn({
      utteranceId: "turn",
      sequence: 5,
      startedAt: start + 1200,
      source: "nova_audio",
    });
    f.gate.finalUserFragment({
      utteranceId: "turn",
      contentId: "part1",
      text: "Yes, place the order.",
      final: true,
      stopReason: "PARTIAL_TURN",
    });
    f.gate.finalUserFragment({
      utteranceId: "turn",
      contentId: "part2",
      text: "No, do not place the order.",
      final: true,
      stopReason: "END_TURN",
    });
    expect(
      f.gate.endUserTurn({
        utteranceId: "turn",
        terminalContentId: "part2",
        stopReason: "END_TURN",
      }),
    ).toBeUndefined();
    expect(f.gate.snapshot().reason).toBe("NOT_EXPLICIT_ORDER_CONFIRMATION");
  });

  it("accepts complete split affirmative only when the terminal FINAL carries END_TURN", () => {
    const f = fixture();
    f.arm();
    f.setTime(start + 1200);
    f.gate.beginUserTurn({
      utteranceId: "turn",
      sequence: 5,
      startedAt: start + 1200,
      source: "nova_audio",
    });
    f.gate.finalUserFragment({
      utteranceId: "turn",
      contentId: "part1",
      text: "Yes,",
      final: true,
      stopReason: "PARTIAL_TURN",
    });
    f.gate.finalUserFragment({
      utteranceId: "turn",
      contentId: "part2",
      text: "please place my order.",
      final: true,
      stopReason: "END_TURN",
    });
    expect(
      f.gate.endUserTurn({
        utteranceId: "turn",
        terminalContentId: "part2",
        stopReason: "END_TURN",
      }),
    ).toMatchObject({ transcript: "Yes, please place my order." });
  });

  it("never accepts provisional text or a fabricated terminal content ID", () => {
    const f = fixture();
    f.arm();
    f.setTime(start + 1200);
    f.gate.beginUserTurn({
      utteranceId: "turn",
      sequence: 5,
      startedAt: start + 1200,
      source: "nova_audio",
    });
    f.gate.finalUserFragment({
      utteranceId: "turn",
      contentId: "partial",
      text: "Yes, place the order.",
      final: false,
      stopReason: "END_TURN",
    });
    expect(
      f.gate.endUserTurn({
        utteranceId: "turn",
        terminalContentId: "invented",
        stopReason: "END_TURN",
      }),
    ).toBeUndefined();
  });

  it("rejects a changed duplicate final instead of choosing the affirmative version", () => {
    const f = fixture();
    f.arm();
    f.setTime(start + 1200);
    f.gate.beginUserTurn({
      utteranceId: "turn",
      sequence: 5,
      startedAt: start + 1200,
      source: "nova_audio",
    });
    const block = {
      utteranceId: "turn",
      contentId: "same",
      final: true,
      stopReason: "END_TURN",
    };
    f.gate.finalUserFragment({ ...block, text: "Yes, place the order." });
    f.gate.finalUserFragment({ ...block, text: "Do not place the order." });
    expect(
      f.gate.endUserTurn({
        utteranceId: "turn",
        terminalContentId: "same",
        stopReason: "END_TURN",
      }),
    ).toBeUndefined();
    expect(f.gate.snapshot().reason).toBe("CHANGED_USER_FINAL_REPLAY");
  });

  it("deduplicates an identical final block and never counts it twice", () => {
    const f = fixture();
    f.arm();
    f.setTime(start + 1200);
    f.gate.beginUserTurn({
      utteranceId: "turn",
      sequence: 5,
      startedAt: start + 1200,
      source: "nova_audio",
    });
    const block = {
      utteranceId: "turn",
      contentId: "same",
      text: "Yes, place the order.",
      final: true,
      stopReason: "END_TURN",
    };
    f.gate.finalUserFragment(block);
    f.gate.finalUserFragment(block);
    expect(
      f.gate.endUserTurn({
        utteranceId: "turn",
        terminalContentId: "same",
        stopReason: "END_TURN",
      })?.transcript,
    ).toBe("Yes, place the order.");
  });

  it("requires canonical full readback and audio, not a model claim or incomplete total", () => {
    const f = fixture();
    f.gate.beginReadback(challenge(), 3);
    finalText(f.gate, {
      contentId: "text",
      generation: 3,
      text: "Your order is ready. Please confirm.",
    });
    audio(f.gate, { generation: 3, bytes: 48000 });
    expect(
      complete(f.gate, { generation: 3, stopReason: "END_TURN" }),
    ).toBeUndefined();
    expect(f.gate.snapshot().reason).toBe("UNVERIFIED_CANONICAL_READBACK");
  });

  it("matches sentence fragments using only lexical normalization", () => {
    const f = fixture();
    f.gate.beginReadback(challenge(), 3);
    const split = readback.indexOf(" Total ");
    finalText(f.gate, {
      contentId: "a",
      generation: 3,
      text: readback.slice(0, split).toUpperCase(),
    });
    finalText(f.gate, {
      contentId: "b",
      generation: 3,
      text: readback.slice(split).replaceAll("-", " "),
    });
    audio(f.gate, { generation: 3, bytes: 48000 });
    expect(
      complete(f.gate, { generation: 3, stopReason: "END_TURN" }),
    ).toMatchObject({ type: "readback_complete" });
  });

  it("requires scoped, complete and sufficiently long actual playback before arming", () => {
    const f = fixture();
    f.completeReadback();
    const ack = {
      readback_id: "readback-1",
      readback_hash: hash,
      generation: 3,
    };
    expect(f.gate.playbackAck(ack)).toBeUndefined();
    f.setTime(start + 1100);
    expect(f.gate.playbackAck({ ...ack, generation: 2 })).toBeUndefined();
    expect(
      f.gate.playbackAck({ ...ack, readback_id: "other" }),
    ).toBeUndefined();
    expect(
      f.gate.playbackAck({ ...ack, readback_hash: "b".repeat(64) }),
    ).toBeUndefined();
    expect(f.gate.playbackAck(ack)).toMatchObject({ type: "arm" });
    expect(f.gate.playbackAck(ack)).toBeUndefined();
  });

  it("does not accept an arm result after interruption or before the acknowledgement", () => {
    const f = fixture();
    f.completeReadback();
    f.setTime(start + 1100);
    f.gate.playbackAck({
      readback_id: "readback-1",
      readback_hash: hash,
      generation: 3,
    });
    expect(
      f.gate.markArmed("readback-1", {
        readyAt: start + 300,
        expiresAt: start + 20300,
        turnSequence: 4,
      }),
    ).toBe(false);
    expect(f.gate.snapshot().reason).toBe("INVALID_ARM_RESULT");
    const g = fixture();
    g.completeReadback();
    g.setTime(start + 1100);
    g.gate.playbackAck({
      readback_id: "readback-1",
      readback_hash: hash,
      generation: 3,
    });
    g.gate.invalidate("INTERRUPTED");
    expect(
      g.gate.markArmed("readback-1", {
        readyAt: start + 1100,
        expiresAt: start + 21100,
        turnSequence: 4,
      }),
    ).toBe(false);
  });

  it.each(["cart", "scope", "generation", "disconnect", "typed", "interrupt"])(
    "invalidates on %s",
    (kind) => {
      const f = fixture();
      f.arm();
      if (kind === "cart") f.gate.cartChanged(5);
      if (kind === "scope") f.gate.scopeChanged({ ...scope, fence: 3 });
      if (kind === "generation") f.gate.generationChanged(4);
      if (kind === "disconnect") f.gate.disconnect();
      if (kind === "typed") f.gate.typedInput();
      if (kind === "interrupt") f.gate.invalidate("INTERRUPTED");
      f.setTime(start + 1200);
      expect(
        f.gate.beginUserTurn({
          utteranceId: "turn",
          sequence: 5,
          startedAt: start + 1200,
          source: "nova_audio",
        }),
      ).toBe(false);
      expect(f.gate.snapshot().phase).toBe("invalid");
    },
  );

  it("does not revive typed/disconnected connections using another challenge", () => {
    const f = fixture();
    f.gate.typedInput();
    expect(f.gate.beginReadback(challenge(), 3)).toBe(false);
    const g = fixture();
    g.gate.disconnect();
    expect(g.gate.beginReadback(challenge(), 3)).toBe(false);
  });

  it("rejects stale audio onset, stale turn sequence and expired confirmation", () => {
    const a = fixture();
    a.arm();
    a.setTime(start + 1200);
    expect(
      a.gate.beginUserTurn({
        utteranceId: "turn",
        sequence: 5,
        startedAt: start + 1000,
        source: "nova_audio",
      }),
    ).toBe(false);
    const b = fixture();
    b.arm();
    b.setTime(start + 1200);
    expect(
      b.gate.beginUserTurn({
        utteranceId: "turn",
        sequence: 4,
        startedAt: start + 1200,
        source: "nova_audio",
      }),
    ).toBe(false);
    const c = fixture();
    c.arm();
    c.setTime(start + 21100);
    expect(
      c.gate.beginUserTurn({
        utteranceId: "turn",
        sequence: 5,
        startedAt: start + 21100,
        source: "nova_audio",
      }),
    ).toBe(false);
    expect(c.gate.snapshot().reason).toBe("CONFIRMATION_EXPIRED");
  });

  it("fails closed if another user turn starts before the preceding one is complete", () => {
    const f = fixture();
    f.arm();
    f.setTime(start + 1200);
    f.gate.beginUserTurn({
      utteranceId: "one",
      sequence: 5,
      startedAt: start + 1200,
      source: "nova_audio",
    });
    expect(
      f.gate.beginUserTurn({
        utteranceId: "two",
        sequence: 6,
        startedAt: start + 1200,
        source: "nova_audio",
      }),
    ).toBe(false);
    expect(f.gate.snapshot().reason).toBe(
      "USER_INPUT_BEFORE_READY_OR_UNFINISHED_TURN",
    );
  });

  it("ignores obsolete readback output and refuses to rearm a consumed readback ID", () => {
    const f = fixture();
    f.arm();
    expect(f.user()).toBeDefined();
    finalText(f.gate, { contentId: "late", generation: 2, text: "stale" });
    expect(f.gate.snapshot().phase).toBe("processing");
    f.gate.invalidate("CART_CHANGED");
    expect(f.gate.beginReadback(challenge(), 3)).toBe(false);
  });

  it("keeps a generation high-water mark after interruption", () => {
    const f = fixture();
    f.arm();
    f.gate.generationChanged(4);
    expect(f.gate.beginReadback(challenge("new-readback"), 3)).toBe(false);
    expect(f.gate.snapshot().reason).toBe("INVALID_READBACK_BINDING");
  });

  it("does not report expired or changed duplicate readbacks as active", () => {
    const f = fixture();
    f.arm();
    f.setTime(start + 21100);
    expect(f.gate.beginReadback(challenge(), 3)).toBe(false);
    expect(f.gate.snapshot().reason).toBe("CONFIRMATION_EXPIRED");
    const g = fixture();
    g.completeReadback();
    expect(
      g.gate.beginReadback(
        { ...challenge(), readback_hash: "b".repeat(64) },
        3,
      ),
    ).toBe(false);
    expect(g.gate.snapshot().reason).toBe("CHANGED_READBACK_REPLAY");
  });

  it("enforces a playback minimum for late-arriving chunks as well as total duration", () => {
    const f = fixture();
    f.gate.beginReadback(challenge(), 3);
    finalText(f.gate, { contentId: "text", generation: 3, text: readback });
    audio(f.gate, { generation: 3, bytes: 24000, at: start + 100 });
    f.setTime(start + 10100);
    audio(f.gate, { generation: 3, bytes: 24000 });
    expect(
      complete(f.gate, { generation: 3, stopReason: "END_TURN" }),
    ).toBeDefined();
    const ack = {
      readback_id: "readback-1",
      readback_hash: hash,
      generation: 3,
    };
    expect(f.gate.playbackAck(ack)).toBeUndefined();
    f.setTime(start + 10600);
    expect(f.gate.playbackAck(ack)).toMatchObject({ type: "arm" });
  });

  it("ignores identical assistant final replays after verification", () => {
    const f = fixture();
    f.completeReadback();
    finalText(f.gate, {
      contentId: "readback-text",
      generation: 3,
      text: readback,
    });
    expect(f.gate.snapshot().phase).toBe("verified");
  });

  it("requires post-begin unique assistant contents, not unrelated output under the same generation", () => {
    const f = fixture();
    f.gate.registerAssistantContent({
      contentId: "old-text",
      completionId: "shared",
      generation: 3,
      type: "TEXT",
      final: true,
    });
    f.gate.endAssistantContent({
      contentId: "old-text",
      completionId: "shared",
      generation: 3,
      stopReason: "END_TURN",
    });
    expect(f.gate.beginReadback(challenge(), 3)).toBe(true);
    f.gate.assistantFinal({
      contentId: "old-text",
      completionId: "shared",
      generation: 3,
      text: readback,
    });
    f.gate.assistantAudio({
      contentId: "unregistered",
      completionId: "shared",
      generation: 3,
      bytes: 48000,
    });
    expect(
      f.gate.assistantComplete({
        contentId: "unregistered",
        completionId: "shared",
        generation: 3,
        stopReason: "END_TURN",
      }),
    ).toBeUndefined();
    expect(f.gate.snapshot().phase).toBe("reading");
  });

  it("cannot begin while earlier assistant output is still open", () => {
    const f = fixture();
    const prior = {
      contentId: "prior-audio",
      completionId: "shared",
      generation: 3,
    };
    f.gate.registerAssistantContent({ ...prior, type: "AUDIO" });
    expect(f.gate.beginReadback(challenge(), 3)).toBe(false);
    expect(f.gate.snapshot().reason).toBe("PRIOR_ASSISTANT_CONTENT_OPEN");
    f.gate.endAssistantContent({ ...prior, stopReason: "END_TURN" });
    expect(f.gate.beginReadback(challenge(), 3)).toBe(true);
  });

  it("can verify final text that arrives after the audio terminal event", () => {
    const f = fixture();
    f.gate.beginReadback(challenge(), 3);
    audio(f.gate, { generation: 3, bytes: 48000 });
    expect(
      complete(f.gate, { generation: 3, stopReason: "END_TURN" }),
    ).toBeUndefined();
    expect(f.gate.snapshot().reason).toBe("UNVERIFIED_CANONICAL_READBACK");
    expect(
      finalText(f.gate, {
        contentId: "late-final",
        generation: 3,
        text: readback,
      }),
    ).toMatchObject({ type: "readback_complete" });
    expect(f.gate.snapshot().phase).toBe("verified");
  });

  it("keeps the constructor scope immutable even if the caller changes its object", () => {
    const mutable = { ...scope };
    const gate = new VoiceConfirmationGate("connection", mutable, () => start);
    mutable.fence = 999;
    expect(gate.scope.fence).toBe(2);
    expect(gate.beginReadback({ ...challenge(), fence: 999 }, 3)).toBe(false);
  });

  it("also verifies a FINAL delivered after its text content end", () => {
    const f = fixture();
    f.gate.beginReadback(challenge(), 3);
    const textBinding = {
      contentId: "text",
      completionId: "shared-completion",
      generation: 3,
    };
    f.gate.registerAssistantContent({
      ...textBinding,
      type: "TEXT",
      final: true,
    });
    audio(f.gate, { generation: 3, bytes: 48000 });
    complete(f.gate, { generation: 3, stopReason: "END_TURN" });
    f.gate.endAssistantContent({ ...textBinding, stopReason: "END_TURN" });
    expect(
      f.gate.assistantFinal({ ...textBinding, text: readback }),
    ).toMatchObject({ type: "readback_complete" });
  });

  it("can start a fresh generation without waiting for invalidated old output", () => {
    const f = fixture();
    f.gate.beginReadback(challenge(), 3);
    f.gate.registerAssistantContent({
      contentId: "old",
      completionId: "shared",
      generation: 3,
      type: "AUDIO",
    });
    f.gate.generationChanged(4);
    expect(f.gate.beginReadback(challenge("fresh"), 4)).toBe(true);
    f.gate.assistantAudio({
      contentId: "old",
      completionId: "shared",
      generation: 3,
      bytes: 48000,
    });
    expect(f.gate.snapshot().phase).toBe("reading");
  });

  it("does not combine different provider completions into one readback", () => {
    const f = fixture();
    f.gate.beginReadback(challenge(), 3);
    f.gate.registerAssistantContent({
      contentId: "text",
      completionId: "one",
      generation: 3,
      type: "TEXT",
      final: true,
    });
    expect(
      f.gate.registerAssistantContent({
        contentId: "audio",
        completionId: "two",
        generation: 3,
        type: "AUDIO",
      }),
    ).toBe(false);
    expect(f.gate.snapshot().reason).toBe("READBACK_COMPLETION_CHANGED");
  });
});
