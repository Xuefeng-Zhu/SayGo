import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Scope, View } from "@saygo/contracts";
import {
  prepareVoiceConfirmation,
  armVoiceConfirmation,
  confirmVoiceOrder,
  invalidateVoiceConfirmation,
} from "@saygo/domain";
import {
  VoiceConfirmationGate,
  type VoiceReadbackDecision,
} from "../../../packages/integrations/src/voice-confirmation.js";
import type { ProviderVoiceEvidence } from "../../../packages/integrations/src/nova.js";

// Current Nova FINAL USER fragments use PARTIAL_TURN. They do not certify that
// the customer has finished speaking. Never enable this through client data,
// model output, environment configuration, or the runtime's testing options.
export const CURRENT_NOVA_VOICE_CONFIRMATION_SUPPORTED = false as const;
export const VOICE_CONFIRMATION_UNAVAILABLE =
  "Voice confirmation is unavailable with this provider. Stop voice and use Confirm order on the screen.";

export const readbackPlayedSchema = z
  .object({
    type: z.literal("readback_played"),
    readback_id: z.string().uuid(),
    readback_hash: z.string().regex(/^[a-f0-9]{64}$/),
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

type Services = {
  prepare: typeof prepareVoiceConfirmation;
  arm: typeof armVoiceConfirmation;
  confirm: typeof confirmVoiceOrder;
  invalidate: typeof invalidateVoiceConfirmation;
};
type ProviderContent = {
  role: string;
  type: string;
  final: boolean;
  completionId: string;
  generation: number;
  text: string;
  utteranceId?: string;
};
type CertifiedUserTurn = {
  utteranceId: string;
  sequence: number;
  startedAt: number;
  source: "nova_audio";
};

/**
 * Server-only bridge between provider evidence and atomic domain consent.
 * The capability argument exists for deterministic tests and a future adapter
 * that can certify both fresh audio onset and a complete USER END_TURN. The
 * current attachVoice factory always passes the constant false above.
 */
export class VoiceConfirmationCoordinator {
  private readonly gate: VoiceConfirmationGate;
  private readonly services: Services;
  private readonly scope: Scope;
  private readonly clock: () => number;
  private readonly contents = new Map<string, ProviderContent>();
  private readonly reviewRequests = new Map<string, string>();
  private pending: Promise<void> = Promise.resolve();
  private generation = 0;
  private revision = 0;
  private eligible: boolean;
  private disconnected = false;
  private userTurn?: CertifiedUserTurn;

  constructor(
    private readonly options: {
      scope: Scope;
      connectionId: string;
      certifiedWholeUserTurns: boolean;
      send: (event: Record<string, unknown>) => void;
      services?: Services;
      clock?: () => number;
    },
  ) {
    this.scope = Object.freeze({ ...options.scope, actor: "agent" });
    this.clock = options.clock ?? Date.now;
    this.eligible = options.certifiedWholeUserTurns;
    this.services = options.services ?? {
      prepare: prepareVoiceConfirmation,
      arm: armVoiceConfirmation,
      confirm: confirmVoiceOrder,
      invalidate: invalidateVoiceConfirmation,
    };
    this.gate = new VoiceConfirmationGate(
      options.connectionId,
      this.scope,
      this.clock,
    );
  }

  announceCapability() {
    if (!this.options.certifiedWholeUserTurns)
      this.options.send({
        type: "confirmation_unavailable",
        code: "UNSUPPORTED_USER_TURN_BOUNDARY",
        text: VOICE_CONFIRMATION_UNAVAILABLE,
      });
  }

  snapshot() {
    return {
      supported: this.options.certifiedWholeUserTurns,
      ...this.gate.snapshot(),
    };
  }

  async transformToolResult(
    name: string,
    _args: Record<string, unknown>,
    result: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.observeView(result);
    if (name !== "prepare_order_review" || result.error) return result;
    if (!this.eligible || this.disconnected) return this.screenFallback(result);
    const quote = result.quote;
    if (
      !quote ||
      typeof quote !== "object" ||
      !("id" in quote) ||
      typeof quote.id !== "string"
    )
      return this.screenFallback(result);
    const quoteId = quote.id;
    if (!this.reviewRequests.has(quoteId)) {
      if (this.reviewRequests.size >= 128) {
        await this.invalidate("EVIDENCE_LIMIT");
        return this.screenFallback(result);
      }
      this.reviewRequests.set(quoteId, randomUUID());
    }
    const revision = this.revision;
    return this.enqueue(async () => {
      if (!this.current(revision)) return this.screenFallback(result);
      try {
        const view = await this.services.prepare(this.scope, {
          connection_id: this.options.connectionId,
          quote_id: quoteId,
          request_id: this.reviewRequests.get(quoteId)!,
        });
        const challenge = view.voice_confirmation;
        if (
          !this.current(revision) ||
          !challenge ||
          !this.gate.beginReadback(challenge, this.generation)
        ) {
          await this.services.invalidate(this.scope, this.options.connectionId);
          return this.screenFallback(result);
        }
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
          summary: challenge.readback_text,
          required_spoken_readback: challenge.readback_text,
          confirmation_instruction:
            "Read required_spoken_readback exactly. Do not shorten it or claim the order is placed. Wait for the customer after playback finishes.",
        };
      } catch {
        this.gate.invalidate("READBACK_PREPARATION_FAILED");
        await this.services.invalidate(this.scope, this.options.connectionId);
        return this.screenFallback(result);
      }
    });
  }

  /** Only a future certified server adapter may call this, never WS JSON/ASR text. */
  beginCertifiedUserTurn(turn: CertifiedUserTurn): boolean {
    if (!this.eligible || this.disconnected) return false;
    const accepted = this.gate.beginUserTurn(turn);
    if (accepted) this.userTurn = Object.freeze({ ...turn });
    else
      void this.invalidate(this.gate.snapshot().reason ?? "INVALID_USER_TURN");
    return accepted;
  }

  observeProvider(event: ProviderVoiceEvidence) {
    if (!this.eligible || this.disconnected) return;
    if (event.generation > this.generation) {
      this.generation = event.generation;
      this.gate.generationChanged(event.generation);
      if (this.gate.snapshot().phase === "invalid")
        void this.invalidate("OUTPUT_GENERATION_CHANGED");
    }
    if (
      !event.contentId ||
      !event.completionId ||
      event.generation !== this.generation
    )
      return;
    const id = event.contentId;
    if (event.name === "contentStart") {
      if (this.contents.has(id) || this.contents.size >= 1024) {
        void this.invalidate("INVALID_PROVIDER_CONTENT_REPLAY");
        return;
      }
      const content: ProviderContent = {
        role: event.role ?? "",
        type: event.contentType ?? "",
        final: event.final === true,
        completionId: event.completionId,
        generation: event.generation,
        text: "",
        ...(event.role === "USER" && this.userTurn
          ? { utteranceId: this.userTurn.utteranceId }
          : {}),
      };
      this.contents.set(id, content);
      if (content.role === "USER" && !content.utteranceId) {
        // Provider ASR arrival is not a certified fresh-audio onset. Unknown
        // speech can revoke a window, but can never create confirmation proof.
        void this.invalidate("UNVERIFIED_USER_AUDIO_ONSET");
        return;
      }
      if (
        content.role === "ASSISTANT" &&
        (content.type === "TEXT" || content.type === "AUDIO")
      )
        this.gate.registerAssistantContent({
          contentId: id,
          completionId: event.completionId,
          generation: event.generation,
          type: content.type,
          final: content.final,
          startedAt: event.at,
        });
      return;
    }
    const content = this.contents.get(id);
    if (
      !content ||
      content.completionId !== event.completionId ||
      content.generation !== event.generation
    )
      return;
    if (event.name === "textOutput" && content.type === "TEXT") {
      content.text += event.text ?? "";
      if (content.text.length > (content.role === "USER" ? 1000 : 8000))
        void this.invalidate("EVIDENCE_LIMIT");
    } else if (event.name === "audioOutput" && content.role === "ASSISTANT") {
      this.gate.assistantAudio({
        contentId: id,
        completionId: event.completionId,
        generation: event.generation,
        bytes: event.audioBytes ?? 0,
        at: event.at,
      });
    } else if (event.name === "contentEnd") {
      if (content.role === "ASSISTANT") {
        if (content.type === "TEXT" && content.final)
          this.readbackComplete(
            this.gate.assistantFinal({
              contentId: id,
              completionId: event.completionId,
              generation: event.generation,
              text: content.text,
              at: event.at,
            }),
          );
        this.readbackComplete(
          this.gate.endAssistantContent({
            contentId: id,
            completionId: event.completionId,
            generation: event.generation,
            stopReason: event.stopReason ?? "",
            at: event.at,
          }),
        );
      } else if (
        content.role === "USER" &&
        content.type === "TEXT" &&
        content.utteranceId
      ) {
        this.gate.finalUserFragment({
          utteranceId: content.utteranceId,
          contentId: id,
          text: content.text,
          final: content.final,
          stopReason: event.stopReason ?? "",
        });
        // No ASST/completion boundary, silence timer, or FINAL fragment can
        // substitute for this exact terminal provider USER content boundary.
        if (content.final && event.stopReason === "END_TURN") {
          const evidence = this.gate.endUserTurn({
            utteranceId: content.utteranceId,
            terminalContentId: id,
            stopReason: event.stopReason,
            at: event.at,
          });
          if (evidence) {
            const revision = this.revision;
            void this.enqueue(async () => {
              if (!this.current(revision)) return;
              try {
                const view = await this.services.confirm(this.scope, evidence);
                if (!this.current(revision)) return;
                if (view.order)
                  this.options.send({
                    type: "confirmation_committed",
                    order_id: view.order.id,
                  });
                else this.options.send({ type: "confirmation_invalidated" });
                this.options.send({ type: "cart_changed" });
              } catch {
                this.gate.invalidate("VOICE_CONFIRMATION_REJECTED");
                await this.services.invalidate(
                  this.scope,
                  this.options.connectionId,
                );
                if (this.current(revision))
                  this.options.send({ type: "confirmation_invalidated" });
              }
            });
          }
        }
      }
    }
    if (this.gate.snapshot().phase === "invalid")
      void this.invalidate(
        this.gate.snapshot().reason ?? "INVALID_PROVIDER_EVIDENCE",
      );
  }

  async playbackAck(message: unknown) {
    const parsed = readbackPlayedSchema.safeParse(message);
    if (!parsed.success || !this.eligible || this.disconnected) return;
    const decision = this.gate.playbackAck(parsed.data);
    if (!decision) return;
    const revision = this.revision;
    await this.enqueue(async () => {
      if (!this.current(revision)) return;
      try {
        const view = await this.services.arm(this.scope, {
          connection_id: decision.connection_id,
          readback_id: decision.readback_id,
          readback_hash: decision.readback_hash,
          turn_sequence: decision.turn_sequence,
        });
        const challenge = view.voice_confirmation;
        if (
          !this.current(revision) ||
          !challenge ||
          challenge.status !== "awaiting_confirmation" ||
          !challenge.ready_at ||
          !this.gate.markArmed(decision.readback_id, {
            readyAt: Date.parse(challenge.ready_at),
            expiresAt: Date.parse(challenge.expires_at),
            turnSequence: decision.turn_sequence,
          })
        ) {
          await this.services.invalidate(this.scope, this.options.connectionId);
          return;
        }
        this.options.send({
          type: "confirmation_ready",
          readback_id: challenge.readback_id,
          expires_at: challenge.expires_at,
        });
      } catch {
        this.gate.invalidate("VOICE_ARM_REJECTED");
        await this.services.invalidate(this.scope, this.options.connectionId);
        if (this.current(revision))
          this.options.send({ type: "confirmation_invalidated" });
      }
    });
  }

  observeView(value: Record<string, unknown> | View) {
    if (!this.eligible || this.disconnected) return;
    const version = value.cart_version;
    if (typeof version === "number") this.gate.cartChanged(version);
    const session = value.session;
    if (
      session &&
      typeof session === "object" &&
      "id" in session &&
      "epoch" in session &&
      "fence" in session
    )
      this.gate.scopeChanged({
        session_id: String(session.id),
        epoch: Number(session.epoch),
        fence: Number(session.fence),
      });
    if (this.gate.snapshot().phase === "invalid")
      void this.invalidate(this.gate.snapshot().reason ?? "ORDER_CHANGED");
  }

  typedInput() {
    this.eligible = false;
    this.gate.typedInput();
    return this.invalidate("TYPED_INPUT_CONNECTION_INELIGIBLE");
  }

  interrupt(generation: number) {
    this.generation = Math.max(this.generation, generation);
    this.gate.generationChanged(generation);
    return this.invalidate("READBACK_INTERRUPTED");
  }

  disconnect() {
    if (this.disconnected) return this.pending;
    this.disconnected = true;
    this.gate.disconnect();
    return this.invalidate("DISCONNECTED");
  }

  invalidate(reason: string) {
    this.revision++;
    this.userTurn = undefined;
    this.gate.invalidate(reason);
    if (!this.disconnected && this.options.certifiedWholeUserTurns)
      this.options.send({ type: "confirmation_invalidated" });
    return this.enqueue(async () => {
      await this.services.invalidate(this.scope, this.options.connectionId);
    }).catch(() => {
      // A takeover may already have fenced this agent. The matching lease
      // release still runs in the runtime's finally block; never retry a write.
      console.error(
        "SayGo voice confirmation cleanup encountered a service error.",
      );
    });
  }

  drain() {
    return this.pending;
  }

  private readbackComplete(decision: VoiceReadbackDecision | undefined) {
    if (decision && !this.disconnected)
      this.options.send({
        type: "confirmation_readback_complete",
        readback_id: decision.readback_id,
        readback_hash: decision.readback_hash,
        generation: decision.generation,
      });
  }

  private screenFallback(result: Record<string, unknown>) {
    return {
      ...result,
      voice_confirmation: null,
      voice_confirmation_available: false,
      voice_confirmation_reason: this.options.certifiedWholeUserTurns
        ? "UNVERIFIED_VOICE_CONFIRMATION"
        : "UNSUPPORTED_USER_TURN_BOUNDARY",
      summary:
        "Review is ready. Stop voice and tap Confirm order on the screen.",
      confirmation_instruction: VOICE_CONFIRMATION_UNAVAILABLE,
    };
  }

  private current(revision: number) {
    return !this.disconnected && this.eligible && revision === this.revision;
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action);
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
