import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  isExplicitVoiceConfirmation,
  toolSchemas,
  type Scope,
  type View,
  type VoiceConfirmation,
  type VoiceOrderEvidence,
} from "@saygo/contracts";
import {
  prepareVoiceConfirmation,
  armVoiceConfirmation,
  recordVoiceApproval,
  invalidateVoiceConfirmation,
} from "@saygo/domain";
import { VoiceConfirmationGate } from "../../../packages/integrations/src/voice-confirmation.js";
import type { ProviderVoiceEvidence } from "../../../packages/integrations/src/nova.js";
import { readbackPlayedSchema } from "./voice-confirmation.js";

const startSchema = readbackPlayedSchema
  .omit({ type: true })
  .extend({
    type: z.literal("confirmation_capture_start"),
  })
  .strict();
const endSchema = z
  .object({
    type: z.literal("confirmation_capture_end"),
    capture_id: z.string().uuid(),
  })
  .strict();
type Services = {
  prepare: typeof prepareVoiceConfirmation;
  arm: typeof armVoiceConfirmation;
  record: typeof recordVoiceApproval;
  invalidate: typeof invalidateVoiceConfirmation;
};
type Content = {
  role: string;
  type: string;
  final: boolean;
  completion: string;
  generation: number;
  text: string;
  ended: boolean;
  stopReason?: string;
  captureId?: string;
};
type Capture = {
  id: string;
  acknowledgedAt: number;
  firstFrameAt?: number;
  firstAudioAt?: number;
  voicedSamples: number;
  bytes: number;
  sealedAt?: number;
  userIds: string[];
  requested?: { quote_id: string };
  pendingSent: boolean;
};

/**
 * A distinct application-defined input boundary, not a provider END_TURN claim.
 * The old provider-whole-turn coordinator remains fail closed. This path requires
 * explicit fresh audio capture, an explicit seal, and the natural end of the
 * entire provider stream before any final ASR can authorize a real MCP submit.
 */
export class SealedVoiceConfirmationCoordinator {
  private readonly gate: VoiceConfirmationGate;
  private readonly scope: Scope;
  private readonly clock: () => number;
  private readonly services: Services;
  private readonly contents = new Map<string, Content>();
  private readonly completions = new Map<string, number>();
  private challenge?: VoiceConfirmation;
  private generation = 0;
  private capture?: Capture;
  private eligible = true;
  private disconnected = false;
  private reason?: string;
  private pending: Promise<void> = Promise.resolve();
  private ready = false;
  private submitted = false;
  private expiryTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly options: {
      scope: Scope;
      connectionId: string;
      send: (event: Record<string, unknown>) => void;
      releaseLease: () => Promise<void>;
      submit: (args: { quote_id: string }) => Promise<Record<string, unknown>>;
      active: () => boolean;
      onExpire?: () => void;
      services?: Services;
      clock?: () => number;
    },
  ) {
    this.scope = Object.freeze({ ...options.scope, actor: "agent" });
    this.clock = options.clock ?? Date.now;
    this.services = options.services ?? {
      prepare: prepareVoiceConfirmation,
      arm: armVoiceConfirmation,
      record: recordVoiceApproval,
      invalidate: invalidateVoiceConfirmation,
    };
    this.gate = new VoiceConfirmationGate(
      options.connectionId,
      this.scope,
      this.clock,
    );
  }

  announceCapability() {
    this.options.send({
      type: "confirmation_capability",
      mode: "sealed_recording",
    });
  }

  snapshot() {
    return {
      ...this.gate.snapshot(),
      mode: "sealed_recording",
      ready: this.ready,
      capture_id: this.capture?.id,
      sealed: this.capture?.sealedAt !== undefined,
      reason: this.reason,
      submitted: this.submitted,
    };
  }

  async transformToolResult(
    name: string,
    _args: Record<string, unknown>,
    result: Record<string, unknown>,
  ) {
    this.observeView(result);
    if (name !== "prepare_order_review" || result.error) return result;
    if (!this.live() || this.capture) return this.fallback(result);
    const quote = result.quote as { id?: unknown } | undefined;
    if (typeof quote?.id !== "string") return this.fallback(result);
    try {
      const view = await this.services.prepare(this.scope, {
        connection_id: this.options.connectionId,
        quote_id: quote.id,
        request_id: randomUUID(),
      });
      const challenge = view.voice_confirmation;
      if (
        !this.live() ||
        !challenge ||
        !this.gate.beginReadback(challenge, this.generation)
      )
        throw Error("INVALID_READBACK");
      this.challenge = challenge;
      this.scheduleExpiry();
      this.options.send({
        type: "confirmation_readback",
        readback_id: challenge.readback_id,
        readback_hash: challenge.readback_hash,
        generation: this.generation,
        cart_version: challenge.cart_version,
        expires_at: challenge.expires_at,
      });
      return {
        ...result,
        voice_confirmation: challenge,
        voice_confirmation_available: true,
        voice_confirmation_mode: "sealed_recording",
        summary: challenge.readback_text,
        required_spoken_readback: challenge.readback_text,
        confirmation_instruction:
          "Read required_spoken_readback exactly. The order is NOT placed. The customer must use the Record spoken approval control after playback, say Yes, place the order, and finish recording. Call submit_order only after that actual customer speech; PENDING_VERIFICATION means the order is not submitted.",
      };
    } catch {
      await this.invalidate("READBACK_PREPARATION_FAILED");
      return this.fallback(result);
    }
  }

  observeProvider(event: ProviderVoiceEvidence) {
    if (!this.live()) return;
    if (event.generation > this.generation) {
      this.generation = event.generation;
      if (this.challenge) void this.invalidate("OUTPUT_GENERATION_CHANGED");
    }
    if (event.name === "completionStart" && event.completionId) {
      if (
        this.completions.has(event.completionId) ||
        this.completions.size >= 1024
      ) {
        void this.invalidate("REPLAYED_PROVIDER_COMPLETION");
        return;
      }
      this.completions.set(event.completionId, event.at);
    }
    if (!event.contentId || !event.completionId) {
      if (
        this.capture &&
        [
          "contentStart",
          "textOutput",
          "audioOutput",
          "contentEnd",
          "toolUse",
        ].includes(event.name)
      )
        void this.invalidate("UNBOUND_CAPTURE_CONTENT");
      return;
    }
    const id = event.contentId;
    if (event.name === "contentStart") {
      if (this.contents.has(id) || this.contents.size >= 1024) {
        void this.invalidate("INVALID_PROVIDER_CONTENT_REPLAY");
        return;
      }
      const content: Content = {
        role: event.role ?? "",
        type: event.contentType ?? "",
        final: event.final === true,
        completion: event.completionId,
        generation: event.generation,
        text: "",
        ended: false,
      };
      if (
        this.capture &&
        !(
          (content.role === "USER" && content.type === "TEXT") ||
          (content.role === "ASSISTANT" &&
            ["TEXT", "AUDIO"].includes(content.type)) ||
          (content.role === "TOOL" && content.type === "TOOL")
        )
      ) {
        void this.invalidate("AMBIGUOUS_CAPTURE_CONTENT");
        return;
      }
      if (content.role === "USER" && this.capture) {
        // Sonic can retain one completion for the entire conversation. Fresh
        // input is bound by a new contentStart after the explicit capture ACK
        // and signaled PCM, never by assuming a completion is a customer turn.
        if (
          this.capture.firstAudioAt === undefined ||
          event.at < this.capture.acknowledgedAt ||
          event.at < this.capture.firstAudioAt ||
          !this.completions.has(event.completionId) ||
          content.generation !== this.generation ||
          content.type !== "TEXT" ||
          !content.final
        ) {
          void this.invalidate("UNVERIFIED_CAPTURE_TRANSCRIPT");
          return;
        }
        content.captureId = this.capture.id;
        this.capture.userIds.push(id);
      } else if (content.role === "USER" && this.challenge) {
        void this.invalidate("USER_TRANSCRIPT_OUTSIDE_CAPTURE");
        return;
      }
      this.contents.set(id, content);
      if (
        !this.capture &&
        content.role === "ASSISTANT" &&
        (content.type === "TEXT" || content.type === "AUDIO")
      )
        this.gate.registerAssistantContent({
          contentId: id,
          completionId: content.completion,
          generation: content.generation,
          type: content.type,
          final: content.final,
          startedAt: event.at,
        });
      if (this.gate.snapshot().phase === "invalid")
        void this.invalidate("INVALID_READBACK_EVIDENCE");
      return;
    }
    const content = this.contents.get(id);
    if (
      !content ||
      content.completion !== event.completionId ||
      content.generation !== event.generation
    ) {
      // Unknown blocks have no role in Nova's decoded evidence. They cannot be
      // presumed unrelated to the captured USER speech or safely discarded.
      if (this.capture) void this.invalidate("UNBOUND_CAPTURE_CONTENT");
      return;
    }
    if (
      content.role === "USER" &&
      this.capture &&
      content.captureId !== this.capture.id
    ) {
      void this.invalidate("STALE_USER_TRANSCRIPT");
      return;
    }
    if (event.name === "textOutput") {
      if (content.ended) {
        void this.invalidate("TEXT_AFTER_CONTENT_END");
        return;
      }
      content.text += event.text ?? "";
      if (content.text.length > (content.role === "USER" ? 1000 : 8000))
        void this.invalidate("EVIDENCE_LIMIT");
    } else if (
      event.name === "audioOutput" &&
      !this.capture &&
      content.role === "ASSISTANT"
    ) {
      this.gate.assistantAudio({
        contentId: id,
        completionId: content.completion,
        generation: content.generation,
        bytes: event.audioBytes ?? 0,
        at: event.at,
      });
    } else if (event.name === "contentEnd") {
      if (content.ended) {
        void this.invalidate("REPEATED_CONTENT_END");
        return;
      }
      content.ended = true;
      content.stopReason = event.stopReason;
      if (
        content.role === "USER" &&
        content.captureId &&
        (!["PARTIAL_TURN", "END_TURN"].includes(event.stopReason ?? "") ||
          !content.text.trim())
      )
        void this.invalidate("INCOMPLETE_CAPTURE_TRANSCRIPT");
      if (!this.capture && content.role === "ASSISTANT") {
        if (content.type === "TEXT" && content.final)
          this.readbackComplete(
            this.gate.assistantFinal({
              contentId: id,
              completionId: content.completion,
              generation: content.generation,
              text: content.text,
              at: event.at,
            }),
          );
        this.readbackComplete(
          this.gate.endAssistantContent({
            contentId: id,
            completionId: content.completion,
            generation: content.generation,
            stopReason: event.stopReason ?? "",
            at: event.at,
          }),
        );
      }
    }
    if (this.gate.snapshot().phase === "invalid")
      void this.invalidate("INVALID_READBACK_EVIDENCE");
  }

  async playbackAck(message: unknown) {
    const parsed = readbackPlayedSchema.safeParse(message);
    if (!parsed.success || !this.live() || this.capture) return;
    const decision = this.gate.playbackAck(parsed.data);
    if (!decision) return;
    try {
      const view = await this.services.arm(this.scope, {
        connection_id: decision.connection_id,
        readback_id: decision.readback_id,
        readback_hash: decision.readback_hash,
        turn_sequence: decision.turn_sequence,
      });
      const challenge = view.voice_confirmation;
      if (
        !this.live() ||
        !challenge ||
        !challenge.ready_at ||
        challenge.status !== "awaiting_confirmation" ||
        !this.gate.markArmed(decision.readback_id, {
          readyAt: Date.parse(challenge.ready_at),
          expiresAt: Date.parse(challenge.expires_at),
          turnSequence: decision.turn_sequence,
        })
      )
        throw Error("INVALID_ARM_RESULT");
      this.challenge = challenge;
      this.scheduleExpiry();
      this.ready = true;
      this.options.send({
        type: "confirmation_ready",
        readback_id: challenge.readback_id,
        readback_hash: challenge.readback_hash,
        generation: this.generation,
        expires_at: challenge.expires_at,
      });
    } catch {
      await this.invalidate("VOICE_ARM_REJECTED");
    }
  }

  captureStart(message: unknown) {
    const parsed = startSchema.safeParse(message);
    const challenge = this.challenge;
    if (
      !parsed.success ||
      !this.live() ||
      !this.ready ||
      this.capture ||
      !challenge ||
      parsed.data.readback_id !== challenge.readback_id ||
      parsed.data.readback_hash !== challenge.readback_hash ||
      parsed.data.generation !== this.generation ||
      !challenge.ready_at ||
      this.clock() >= Date.parse(challenge.expires_at) ||
      [...this.contents.values()].some((c) => c.role === "USER" && !c.ended)
    ) {
      void this.invalidate("INVALID_CAPTURE_START");
      return false;
    }
    this.capture = {
      id: randomUUID(),
      acknowledgedAt: this.clock(),
      bytes: 0,
      voicedSamples: 0,
      userIds: [],
      pendingSent: false,
    };
    this.options.send({
      type: "confirmation_capture_started",
      capture_id: this.capture.id,
      readback_id: challenge.readback_id,
      readback_hash: challenge.readback_hash,
      generation: this.generation,
    });
    return true;
  }

  /** Called synchronously before forwarding each newly received PCM frame. */
  acceptAudio(bytes: Buffer) {
    if (this.capture) {
      if (!this.live() || this.capture.sealedAt !== undefined) return false;
      if (!bytes.length || bytes.length > 4096 || bytes.length % 2) {
        void this.invalidate("INVALID_CAPTURE_AUDIO");
        return false;
      }
      this.capture.firstFrameAt ??= this.clock();
      // A conservative signal check, not physical microphone or certified VAD proof.
      for (let offset = 0; offset < bytes.length; offset += 2) {
        if (Math.abs(bytes.readInt16LE(offset)) >= 256) {
          this.capture.firstAudioAt ??= this.clock();
          this.capture.voicedSamples++;
        }
      }
      this.capture.bytes += bytes.length;
      if (
        this.capture.bytes > 320000 ||
        this.clock() - this.capture.acknowledgedAt > 10000
      ) {
        void this.invalidate("CAPTURE_AUDIO_LIMIT");
        return false;
      }
      return true;
    }
    // A model may prepare a review while the customer is still ordering.
    // Ordinary input must remain audible during readback and after its window
    // is invalidated. Only an armed approval window pauses pre-capture PCM.
    return !this.ready;
  }

  captureEnd(message: unknown) {
    const parsed = endSchema.safeParse(message);
    const capture = this.capture;
    if (
      !parsed.success ||
      !this.live() ||
      !capture ||
      capture.sealedAt !== undefined ||
      parsed.data.capture_id !== capture.id ||
      capture.firstAudioAt === undefined ||
      capture.firstFrameAt === undefined ||
      capture.voicedSamples < 1600 ||
      capture.bytes < 3200 ||
      capture.bytes / 32 > this.clock() - capture.firstFrameAt + 250
    ) {
      void this.invalidate("INVALID_CAPTURE_END");
      return false;
    }
    capture.sealedAt = this.clock();
    this.options.send({
      type: "confirmation_verifying",
      capture_id: capture.id,
      captured_bytes: capture.bytes,
      voiced_samples: capture.voicedSamples,
      first_signal_at: capture.firstAudioAt,
    });
    return true;
  }

  retainSubmission(args: Record<string, unknown>) {
    const parsed = toolSchemas.submit_order.safeParse(args);
    const capture = this.capture;
    if (
      !parsed.success ||
      !this.live() ||
      !capture ||
      !capture.bytes ||
      !this.challenge ||
      parsed.data.quote_id !== this.challenge.quote_id ||
      (capture.requested && capture.requested.quote_id !== parsed.data.quote_id)
    ) {
      return {
        error: {
          code: "CONSENT_REQUIRED",
          message:
            "No verified spoken approval exists for this quote. The order is NOT placed.",
          retryable: false,
        },
      };
    }
    capture.requested = { quote_id: parsed.data.quote_id };
    return {
      pending_verification: true,
      code: "PENDING_VERIFICATION",
      summary:
        "The order is NOT placed. Spoken approval is being verified after the customer finishes recording. Do not claim success or call submit_order again.",
    };
  }

  submissionPendingSent() {
    if (this.capture?.requested) this.capture.pendingSent = true;
  }
  shouldFinishSession() {
    return this.capture?.sealedAt !== undefined && this.capture.pendingSent;
  }

  async finish(naturalEnd: boolean) {
    const capture = this.capture,
      challenge = this.challenge;
    if (!this.live() || !capture || !challenge || this.submitted) return;
    const now = this.clock();
    const contents = capture.userIds.map((id) => this.contents.get(id)!);
    const transcript = contents.map((c) => c.text).join(" ");
    if (
      !naturalEnd ||
      capture.sealedAt === undefined ||
      !capture.requested ||
      !capture.pendingSent ||
      !capture.firstAudioAt ||
      !capture.bytes ||
      capture.voicedSamples < 1600 ||
      !challenge.ready_at ||
      capture.firstAudioAt < Date.parse(challenge.ready_at) ||
      now >= Date.parse(challenge.expires_at) ||
      !contents.length ||
      contents.some(
        (c) =>
          !c ||
          !c.ended ||
          !c.final ||
          c.captureId !== capture.id ||
          !["PARTIAL_TURN", "END_TURN"].includes(c.stopReason ?? ""),
      ) ||
      [...this.contents.values()].some((c) => c.role === "USER" && !c.ended) ||
      !isExplicitVoiceConfirmation(transcript)
    ) {
      await this.invalidate("SEALED_AUDIO_NOT_VERIFIED");
      return;
    }
    const evidence: VoiceOrderEvidence = {
      connection_id: this.options.connectionId,
      readback_id: challenge.readback_id,
      utterance_id: capture.id,
      turn_sequence: 1,
      started_at: capture.firstAudioAt,
      finalized_at: now,
      transcript,
      source: "nova_audio",
      final: true,
    };
    try {
      const approved = await this.services.record(this.scope, evidence);
      if (!this.live() || approved.order)
        throw Error("VOICE_APPROVAL_NOT_CURRENT");
      await this.options.releaseLease();
      if (!this.live()) return;
      // The stored intent came from the provider tool request; this is the first
      // real submit call. No timeout, pending response, or ASR fragment invokes it.
      this.submitted = true;
      const result = await this.options.submit(capture.requested);
      const order = result.order as { id?: unknown } | undefined;
      if (result.error || typeof order?.id !== "string")
        throw Error("VOICE_SUBMIT_UNCONFIRMED");
      this.options.send({ type: "confirmation_committed", order_id: order.id });
      this.options.send({ type: "cart_changed" });
    } catch {
      await this.invalidate("VOICE_SUBMISSION_UNCONFIRMED");
    }
  }

  observeView(value: Record<string, unknown> | View) {
    if (!this.challenge || !this.live()) return;
    const session = value.session as View["session"] | undefined;
    const quote = value.quote as { expires_at?: string } | null | undefined;
    if (
      (!this.submitted &&
        !value.order &&
        ((Object.hasOwn(value, "voice_confirmation") &&
          value.voice_confirmation === null) ||
          (Object.hasOwn(value, "quote") &&
            (!quote ||
              (quote.expires_at &&
                Date.parse(quote.expires_at) <= this.clock()))))) ||
      (typeof value.cart_version === "number" &&
        value.cart_version !== this.challenge.cart_version) ||
      (session &&
        (session.id !== this.scope.session_id ||
          session.epoch !== this.scope.epoch ||
          session.fence !== this.scope.fence ||
          session.owner !== "ai"))
    )
      void this.invalidate("ORDER_OR_CONTROL_CHANGED");
  }
  typedInput() {
    this.eligible = false;
    return this.invalidate("TYPED_INPUT_CONNECTION_INELIGIBLE");
  }
  interrupt(generation: number) {
    this.generation = Math.max(this.generation, generation);
    return this.invalidate("READBACK_INTERRUPTED");
  }
  disconnect() {
    this.disconnected = true;
    return this.invalidate("DISCONNECTED");
  }
  drain() {
    return this.pending;
  }
  private live() {
    return (
      this.eligible &&
      !this.disconnected &&
      !this.reason &&
      this.options.active() &&
      (!this.challenge || this.clock() < Date.parse(this.challenge.expires_at))
    );
  }
  private scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (!this.challenge) return;
    this.expiryTimer = setTimeout(
      () => {
        void this.invalidate("CONFIRMATION_EXPIRED");
        // Ordinary ordering can continue after an unused approval window. Once
        // capture started, its input may be sealed and the stream must stop.
        if (this.capture) this.options.onExpire?.();
      },
      Math.max(0, Date.parse(this.challenge.expires_at) - this.clock()),
    );
    this.expiryTimer.unref?.();
  }
  private readbackComplete(
    decision:
      | { readback_id: string; readback_hash: string; generation: number }
      | undefined,
  ) {
    if (decision && this.live())
      this.options.send({
        type: "confirmation_readback_complete",
        readback_id: decision.readback_id,
        readback_hash: decision.readback_hash,
        generation: decision.generation,
      });
  }
  private fallback(result: Record<string, unknown>) {
    return {
      ...result,
      voice_confirmation: null,
      voice_confirmation_available: false,
      summary:
        "Spoken approval could not be verified. Stop voice and confirm the reviewed order on screen.",
      confirmation_instruction:
        "Do not claim the order is placed. Use screen confirmation.",
    };
  }
  private invalidate(reason: string) {
    clearTimeout(this.expiryTimer);
    const first = !this.reason;
    this.reason ??= reason;
    this.ready = false;
    this.gate.invalidate(reason);
    if (!this.disconnected && first)
      this.options.send({
        type: "confirmation_invalidated",
        text: "Spoken approval was not verified. The order has not been confirmed by voice; check its status before trying again.",
      });
    this.pending = this.pending
      .then(() =>
        this.services.invalidate(this.scope, this.options.connectionId),
      )
      .catch(() => {});
    return this.pending;
  }
}
