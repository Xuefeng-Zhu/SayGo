import {
  isExplicitVoiceConfirmation,
  normalizeVoiceText,
  type VoiceConfirmation,
  type VoiceOrderEvidence,
} from "@saygo/contracts";

export type VoiceConfirmationScope = {
  session_id: string;
  epoch: number;
  fence: number;
};
export type ConfirmationPlaybackAck = {
  readback_id: string;
  readback_hash: string;
  generation: number;
};
export type VoiceArmDecision = {
  type: "arm";
  connection_id: string;
  readback_id: string;
  readback_hash: string;
  generation: number;
  turn_sequence: number;
};
export type VoiceReadbackDecision = {
  type: "readback_complete";
  readback_id: string;
  readback_hash: string;
  generation: number;
};
export type VoiceGatePhase =
  | "inactive"
  | "reading"
  | "verified"
  | "arming"
  | "awaiting_confirmation"
  | "collecting"
  | "processing"
  | "invalid";

type Fragment = { text: string; stopReason: string };
export type AssistantContentBinding = {
  contentId: string;
  completionId: string;
  generation: number;
  type: "TEXT" | "AUDIO";
  final?: boolean;
  startedAt?: number;
};
type AssistantContent = AssistantContentBinding & {
  startedAt: number;
  ended: boolean;
  readbackId?: string;
  stopReason?: string;
};
type UserTurn = {
  id: string;
  sequence: number;
  startedAt: number;
  fragments: Map<string, Fragment>;
  terminalContentId?: string;
};
const validId = (value: string) =>
  typeof value === "string" && value.length > 0 && value.length <= 160;
const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validGeneration = (value: number) => validTime(value);

/**
 * Pure gateway evidence check. This is deliberately not a transcript-to-order API.
 * Only the runtime's provider observer may supply the methods below. In particular,
 * final ASR fragments do not prove a whole user turn: the default endpoint requires
 * the provider's USER END_TURN on the terminal final content. No timer/debounce is
 * allowed to manufacture that evidence. The runtime/domain still owns transactions,
 * active connection/lease checks, quote freshness, and permission to commit.
 */
export class VoiceConfirmationGate {
  private phase: VoiceGatePhase = "inactive";
  private reason: string | undefined;
  private challenge?: VoiceConfirmation;
  private generation = -1;
  private begunAt = 0;
  private assistantFragments = new Map<string, string>();
  private audioBytes = 0;
  private firstAudioAt?: number;
  private earliestPlaybackEnd = 0;
  private outputCompleteAt?: number;
  private acknowledgedAt?: number;
  private readyAt?: number;
  private expiresAt = 0;
  private armedSequence = 0;
  private latestSequence = 0;
  private userTurn?: UserTurn;
  private audioOnly = true;
  private disconnected = false;
  private seenUserContents = new Set<string>();
  private seenUserTurns = new Set<string>();
  private usedReadbacks = new Set<string>();
  private assistantContents = new Map<string, AssistantContent>();
  private readbackCompletionId?: string;

  constructor(
    readonly connectionId: string,
    readonly scope: Readonly<VoiceConfirmationScope>,
    private readonly clock: () => number = Date.now,
  ) {
    if (!validId(connectionId)) throw Error("INVALID_VOICE_CONNECTION_ID");
    this.scope = Object.freeze({ ...scope });
  }

  snapshot() {
    this.live(this.clock());
    return {
      phase: this.phase,
      reason: this.reason,
      readback_id: this.challenge?.readback_id,
      generation: this.generation,
      ready_at: this.readyAt,
      expires_at: this.expiresAt || undefined,
      audio_only: this.audioOnly,
      required_user_boundary: "provider_user_end_turn" as const,
    };
  }

  beginReadback(
    challenge: VoiceConfirmation,
    generation: number,
    at = this.clock(),
  ) {
    if (this.disconnected || !this.audioOnly) return false;
    if (this.challenge?.readback_id === challenge.readback_id) {
      if (!this.live(at)) return false;
      const same =
        generation === this.generation &&
        JSON.stringify(challenge) === JSON.stringify(this.challenge);
      if (!same) this.invalidate("CHANGED_READBACK_REPLAY");
      return same;
    }
    if (
      !validGeneration(generation) ||
      generation < this.generation ||
      !validTime(at) ||
      !validId(challenge.readback_id) ||
      !/^[a-f0-9]{64}$/.test(challenge.readback_hash) ||
      challenge.session_id !== this.scope.session_id ||
      challenge.epoch !== this.scope.epoch ||
      challenge.fence !== this.scope.fence ||
      challenge.status !== "reading" ||
      !challenge.readback_text.trim() ||
      challenge.readback_text.length > 8000 ||
      this.usedReadbacks.has(challenge.readback_id)
    ) {
      this.invalidate("INVALID_READBACK_BINDING");
      return false;
    }
    const expiry = Date.parse(challenge.expires_at);
    if (!validTime(expiry) || expiry <= at || expiry - at > 60000) {
      this.invalidate("INVALID_READBACK_EXPIRY");
      return false;
    }
    if (this.usedReadbacks.size >= 128) {
      this.invalidate("EVIDENCE_LIMIT");
      return false;
    }
    if (
      [...this.assistantContents.values()].some(
        (content) => !content.ended && content.generation === generation,
      )
    ) {
      this.invalidate("PRIOR_ASSISTANT_CONTENT_OPEN");
      return false;
    }
    this.challenge = structuredClone(challenge);
    this.usedReadbacks.add(challenge.readback_id);
    this.phase = "reading";
    this.reason = undefined;
    this.generation = generation;
    this.begunAt = at;
    this.expiresAt = expiry;
    this.assistantFragments.clear();
    this.audioBytes = 0;
    this.firstAudioAt = undefined;
    this.earliestPlaybackEnd = 0;
    this.outputCompleteAt = undefined;
    this.acknowledgedAt = undefined;
    this.readyAt = undefined;
    this.userTurn = undefined;
    this.readbackCompletionId = undefined;
    return true;
  }

  /** Observe every provider ASSISTANT content start, including before a challenge. */
  registerAssistantContent(input: AssistantContentBinding) {
    const at = input.startedAt ?? this.clock();
    if (
      !validId(input.contentId) ||
      !validId(input.completionId) ||
      !validGeneration(input.generation) ||
      !validTime(at)
    ) {
      this.invalidate("INVALID_PROVIDER_CONTENT_BINDING");
      return false;
    }
    const previous = this.assistantContents.get(input.contentId);
    if (previous) {
      if (
        previous.completionId !== input.completionId ||
        previous.generation !== input.generation ||
        previous.type !== input.type ||
        previous.final !== input.final
      )
        this.invalidate("CHANGED_PROVIDER_CONTENT_REPLAY");
      return false;
    }
    if (this.assistantContents.size >= 1024) {
      this.invalidate("EVIDENCE_LIMIT");
      return false;
    }
    const belongs =
      this.phase === "reading" &&
      this.current(input.generation, at) &&
      at >= this.begunAt;
    if (
      belongs &&
      this.readbackCompletionId &&
      input.completionId !== this.readbackCompletionId
    ) {
      this.invalidate("READBACK_COMPLETION_CHANGED");
      return false;
    }
    if (belongs) this.readbackCompletionId ??= input.completionId;
    this.assistantContents.set(input.contentId, {
      ...input,
      startedAt: at,
      ended: false,
      ...(belongs ? { readbackId: this.challenge!.readback_id } : {}),
    });
    if (
      ["verified", "arming", "awaiting_confirmation", "collecting"].includes(
        this.phase,
      ) &&
      input.generation === this.generation
    )
      this.invalidate("OUTPUT_AFTER_READBACK_COMPLETE");
    return belongs;
  }

  endAssistantContent(input: {
    contentId: string;
    completionId: string;
    generation: number;
    stopReason: string;
    at?: number;
  }): VoiceReadbackDecision | undefined {
    const content = this.assistantContents.get(input.contentId);
    if (
      !content ||
      content.completionId !== input.completionId ||
      content.generation !== input.generation
    )
      return;
    if (content.ended) {
      if (content.stopReason !== input.stopReason)
        this.invalidate("CHANGED_PROVIDER_END_REPLAY");
      return;
    }
    content.ended = true;
    content.stopReason = input.stopReason;
    if (
      !this.ownedContent(input.contentId, input.completionId, input.generation)
    )
      return;
    if (input.stopReason === "INTERRUPTED") {
      this.invalidate("READBACK_INTERRUPTED");
      return;
    }
    return this.verifyReadback(input.at ?? this.clock());
  }

  assistantFinal(input: {
    contentId: string;
    completionId: string;
    generation: number;
    text: string;
    at?: number;
  }) {
    const at = input.at ?? this.clock();
    if (!this.current(input.generation, at)) return;
    const binding = this.ownedContent(
      input.contentId,
      input.completionId,
      input.generation,
    );
    if (!binding || binding.type !== "TEXT" || binding.final !== true) return;
    if (!validId(input.contentId) || !input.text.trim()) {
      this.invalidate("INVALID_READBACK_CONTENT");
      return;
    }
    const previous = this.assistantFragments.get(input.contentId);
    if (previous !== undefined) {
      if (previous !== input.text) this.invalidate("CHANGED_READBACK_REPLAY");
      return;
    }
    if (this.phase !== "reading") {
      this.invalidate("OUTPUT_AFTER_READBACK_COMPLETE");
      return;
    }
    this.assistantFragments.set(input.contentId, input.text);
    if (
      this.assistantFragments.size > 100 ||
      this.readbackTranscript().length > 8000
    )
      this.invalidate("EVIDENCE_LIMIT");
    return this.verifyReadback(at);
  }

  assistantAudio(input: {
    contentId: string;
    completionId: string;
    generation: number;
    bytes: number;
    at?: number;
  }) {
    const at = input.at ?? this.clock();
    if (!this.current(input.generation, at)) return;
    const binding = this.ownedContent(
      input.contentId,
      input.completionId,
      input.generation,
    );
    if (!binding || binding.type !== "AUDIO") return;
    if (binding.ended) {
      this.invalidate("AUDIO_AFTER_CONTENT_END");
      return;
    }
    if (this.phase !== "reading") {
      this.invalidate("OUTPUT_AFTER_READBACK_COMPLETE");
      return;
    }
    if (
      !Number.isSafeInteger(input.bytes) ||
      input.bytes <= 0 ||
      input.bytes % 2
    ) {
      this.invalidate("INVALID_READBACK_AUDIO");
      return;
    }
    this.firstAudioAt ??= at;
    this.audioBytes += input.bytes;
    this.earliestPlaybackEnd =
      Math.max(this.earliestPlaybackEnd, at) + (input.bytes / 48000) * 1000;
    if (this.audioBytes > 60 * 48000) this.invalidate("READBACK_AUDIO_LIMIT");
  }

  assistantComplete(input: {
    contentId: string;
    completionId: string;
    generation: number;
    stopReason: string;
    at?: number;
  }): VoiceReadbackDecision | undefined {
    const binding = this.ownedContent(
      input.contentId,
      input.completionId,
      input.generation,
    );
    if (!binding || binding.type !== "AUDIO") return;
    return this.endAssistantContent(input);
  }

  playbackAck(
    ack: ConfirmationPlaybackAck,
    at = this.clock(),
  ): VoiceArmDecision | undefined {
    if (!this.live(at) || this.phase !== "verified" || !this.challenge) return;
    if (
      ack.readback_id !== this.challenge.readback_id ||
      ack.readback_hash !== this.challenge.readback_hash ||
      ack.generation !== this.generation
    )
      return;
    if (
      this.outputCompleteAt === undefined ||
      this.firstAudioAt === undefined ||
      at < this.outputCompleteAt ||
      at < this.earliestPlaybackEnd
    )
      return;
    this.phase = "arming";
    this.acknowledgedAt = at;
    return {
      type: "arm",
      connection_id: this.connectionId,
      readback_id: this.challenge.readback_id,
      readback_hash: this.challenge.readback_hash,
      generation: this.generation,
      turn_sequence: this.latestSequence,
    };
  }

  /** Apply the domain result only while this same arm attempt remains current. */
  markArmed(
    readbackId: string,
    input: {
      readyAt: number;
      expiresAt: number;
      turnSequence: number;
    },
  ) {
    if (
      !this.live(this.clock()) ||
      this.phase !== "arming" ||
      readbackId !== this.challenge?.readback_id
    )
      return false;
    if (
      !validTime(input.readyAt) ||
      !validTime(input.expiresAt) ||
      !validTime(input.turnSequence) ||
      input.readyAt < (this.acknowledgedAt ?? Infinity) ||
      input.readyAt > this.clock() ||
      input.expiresAt <= input.readyAt ||
      input.expiresAt - input.readyAt > 20000 ||
      input.turnSequence < this.latestSequence
    ) {
      this.invalidate("INVALID_ARM_RESULT");
      return false;
    }
    this.readyAt = input.readyAt;
    this.expiresAt = input.expiresAt;
    this.latestSequence = input.turnSequence;
    this.armedSequence = input.turnSequence;
    this.phase = "awaiting_confirmation";
    return true;
  }

  /** startedAt must describe newly forwarded audio, never merely FINAL arrival. */
  beginUserTurn(input: {
    utteranceId: string;
    sequence: number;
    startedAt: number;
    source: "nova_audio";
  }) {
    const now = this.clock();
    if (!this.live(now)) return false;
    if (this.seenUserTurns.has(input.utteranceId)) return false;
    if (this.phase !== "awaiting_confirmation") {
      this.invalidate("USER_INPUT_BEFORE_READY_OR_UNFINISHED_TURN");
      return false;
    }
    if (
      !validId(input.utteranceId) ||
      input.source !== "nova_audio" ||
      !validTime(input.sequence) ||
      input.sequence <= this.latestSequence ||
      input.sequence <= this.armedSequence ||
      !validTime(input.startedAt) ||
      input.startedAt < (this.readyAt ?? Infinity) ||
      input.startedAt > now
    ) {
      this.invalidate("INVALID_OR_STALE_USER_TURN");
      return false;
    }
    if (this.seenUserTurns.size >= 512) {
      this.invalidate("EVIDENCE_LIMIT");
      return false;
    }
    this.latestSequence = input.sequence;
    this.seenUserTurns.add(input.utteranceId);
    this.userTurn = {
      id: input.utteranceId,
      sequence: input.sequence,
      startedAt: input.startedAt,
      fragments: new Map(),
    };
    this.phase = "collecting";
    return true;
  }

  finalUserFragment(input: {
    utteranceId: string;
    contentId: string;
    text: string;
    final: boolean;
    stopReason: string;
  }) {
    if (
      !this.live(this.clock()) ||
      this.phase !== "collecting" ||
      !this.userTurn
    )
      return;
    if (input.utteranceId !== this.userTurn.id) return;
    if (!input.final) return;
    if (!validId(input.contentId) || !input.text.trim()) {
      this.invalidate("INVALID_USER_FINAL");
      return;
    }
    const previous = this.userTurn.fragments.get(input.contentId);
    if (previous) {
      if (
        previous.text !== input.text ||
        previous.stopReason !== input.stopReason
      )
        this.invalidate("CHANGED_USER_FINAL_REPLAY");
      return;
    }
    if (this.seenUserContents.has(input.contentId)) {
      this.invalidate("STALE_USER_CONTENT_REPLAY");
      return;
    }
    if (this.userTurn.terminalContentId) {
      this.invalidate("USER_CONTENT_AFTER_TERMINAL");
      return;
    }
    if (!["PARTIAL_TURN", "END_TURN"].includes(input.stopReason)) {
      this.invalidate("UNCERTAIN_USER_FINAL");
      return;
    }
    this.seenUserContents.add(input.contentId);
    this.userTurn.fragments.set(input.contentId, {
      text: input.text,
      stopReason: input.stopReason,
    });
    if (input.stopReason === "END_TURN")
      this.userTurn.terminalContentId = input.contentId;
    if (this.seenUserContents.size > 512 || this.userTranscript().length > 1000)
      this.invalidate("EVIDENCE_LIMIT");
  }

  endUserTurn(input: {
    utteranceId: string;
    terminalContentId: string;
    stopReason: string;
    at?: number;
  }): VoiceOrderEvidence | undefined {
    const at = input.at ?? this.clock();
    if (
      !this.live(at) ||
      this.phase !== "collecting" ||
      !this.userTurn ||
      !this.challenge
    )
      return;
    if (input.utteranceId !== this.userTurn.id) return;
    if (
      input.stopReason !== "END_TURN" ||
      this.userTurn.terminalContentId !== input.terminalContentId
    ) {
      this.reason = "UNSUPPORTED_USER_TURN_BOUNDARY";
      return;
    }
    const transcript = this.userTranscript();
    if (!isExplicitVoiceConfirmation(transcript)) {
      this.invalidate("NOT_EXPLICIT_ORDER_CONFIRMATION");
      return;
    }
    if (at < this.userTurn.startedAt || at < (this.readyAt ?? Infinity)) {
      this.invalidate("INVALID_USER_FINAL_TIME");
      return;
    }
    this.phase = "processing";
    return {
      connection_id: this.connectionId,
      readback_id: this.challenge.readback_id,
      utterance_id: this.userTurn.id,
      turn_sequence: this.userTurn.sequence,
      started_at: this.userTurn.startedAt,
      finalized_at: at,
      transcript,
      source: "nova_audio",
      final: true,
    };
  }

  cartChanged(cartVersion: number) {
    if (this.challenge && cartVersion !== this.challenge.cart_version)
      this.invalidate("CART_CHANGED");
  }
  scopeChanged(scope: VoiceConfirmationScope) {
    if (
      scope.session_id !== this.scope.session_id ||
      scope.epoch !== this.scope.epoch ||
      scope.fence !== this.scope.fence
    )
      this.invalidate("CONTROL_OR_CUSTOMER_CHANGED");
  }
  generationChanged(generation: number) {
    if (validGeneration(generation) && generation > this.generation) {
      this.generation = generation;
      this.invalidate("OUTPUT_GENERATION_CHANGED");
    }
  }
  typedInput() {
    this.audioOnly = false;
    this.invalidate("TYPED_INPUT_CONNECTION_INELIGIBLE");
  }
  disconnect() {
    this.disconnected = true;
    this.invalidate("DISCONNECTED");
  }
  invalidate(reason: string) {
    this.phase = "invalid";
    this.reason = reason;
    this.userTurn = undefined;
  }

  private readbackTranscript() {
    return [...this.assistantFragments.values()].join(" ");
  }
  private userTranscript() {
    return [...(this.userTurn?.fragments.values() ?? [])]
      .map((f) => f.text)
      .join(" ");
  }
  private live(at: number) {
    if (
      !validTime(at) ||
      this.disconnected ||
      !this.audioOnly ||
      this.phase === "invalid"
    )
      return false;
    if (this.expiresAt && at >= this.expiresAt) {
      this.invalidate("CONFIRMATION_EXPIRED");
      return false;
    }
    return true;
  }
  private current(generation: number, at: number) {
    return (
      this.live(at) && generation === this.generation && at >= this.begunAt
    );
  }
  private ownedContent(
    contentId: string,
    completionId: string,
    generation: number,
  ) {
    const content = this.assistantContents.get(contentId);
    return content &&
      content.completionId === completionId &&
      content.generation === generation &&
      generation === this.generation &&
      content.readbackId === this.challenge?.readback_id &&
      content.startedAt >= this.begunAt
      ? content
      : undefined;
  }
  private verifyReadback(at: number): VoiceReadbackDecision | undefined {
    if (!this.live(at) || this.phase !== "reading" || !this.challenge) return;
    const owned = [...this.assistantContents.values()].filter(
      (content) => content.readbackId === this.challenge!.readback_id,
    );
    if (
      owned.some((content) => !content.ended) ||
      !owned.some(
        (content) =>
          content.type === "AUDIO" && content.stopReason === "END_TURN",
      )
    )
      return;
    if (
      !this.audioBytes ||
      this.firstAudioAt === undefined ||
      normalizeVoiceText(this.readbackTranscript()) !==
        normalizeVoiceText(this.challenge.readback_text)
    ) {
      // FINAL transcript content can follow the AUDIO END_TURN event. Stay closed
      // until those registered final blocks arrive, or the bounded challenge expires.
      this.reason = "UNVERIFIED_CANONICAL_READBACK";
      return;
    }
    this.phase = "verified";
    this.reason = undefined;
    this.outputCompleteAt = at;
    return {
      type: "readback_complete",
      readback_id: this.challenge.readback_id,
      readback_hash: this.challenge.readback_hash,
      generation: this.generation,
    };
  }
}
