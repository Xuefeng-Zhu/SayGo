type ReadbackIdentity = {
  readback_id: string;
  readback_hash: string;
  generation: number;
};
export type ReadbackPlayed = ReadbackIdentity & { type: "readback_played" };
type Candidate = ReadbackIdentity & {
  cart_version: number;
  expires_at: number;
  audioSeen: boolean;
  complete: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function identity(frame: Record<string, unknown>): ReadbackIdentity {
  if (
    typeof frame.readback_id !== "string" ||
    !uuid.test(frame.readback_id) ||
    typeof frame.readback_hash !== "string" ||
    !/^[0-9a-f]{64}$/i.test(frame.readback_hash) ||
    typeof frame.generation !== "number" ||
    !Number.isSafeInteger(frame.generation) ||
    frame.generation < 0
  )
    throw new Error("Invalid readback identity");
  return {
    readback_id: frame.readback_id,
    readback_hash: frame.readback_hash,
    generation: frame.generation,
  };
}

/** Playback receipt only. It never recognizes consent or places an order. */
export class ReadbackPlayback {
  private candidate: Candidate | null = null;
  private retired = new Set<string>();
  invalidate() {
    if (this.candidate) this.retired.add(this.candidate.readback_id);
    this.candidate = null;
  }
  begin(frame: Record<string, unknown>, generation: number, now: number) {
    const readback = identity(frame);
    if (
      typeof frame.cart_version !== "number" ||
      !Number.isSafeInteger(frame.cart_version) ||
      frame.cart_version < 0 ||
      typeof frame.expires_at !== "string" ||
      !Number.isFinite(Date.parse(frame.expires_at))
    )
      throw new Error("Invalid readback window");
    if (this.retired.has(readback.readback_id)) return;
    if (this.retired.size >= 128) throw new Error("Too many readback windows");
    if (this.candidate?.readback_id === readback.readback_id) {
      if (
        this.candidate.readback_hash !== readback.readback_hash ||
        this.candidate.generation !== readback.generation ||
        this.candidate.cart_version !== frame.cart_version
      )
        throw new Error("Readback identity changed");
      return;
    }
    this.invalidate();
    if (
      readback.generation !== generation ||
      Date.parse(frame.expires_at) <= now
    ) {
      this.retired.add(readback.readback_id);
      return;
    }
    this.candidate = {
      ...readback,
      cart_version: frame.cart_version,
      expires_at: Date.parse(frame.expires_at),
      audioSeen: false,
      complete: false,
    };
  }
  audio(generation: number) {
    if (this.candidate?.generation === generation)
      this.candidate.audioSeen = true;
  }
  complete(frame: Record<string, unknown>) {
    const readback = identity(frame);
    if (
      this.candidate?.readback_id === readback.readback_id &&
      this.candidate.readback_hash === readback.readback_hash &&
      this.candidate.generation === readback.generation
    )
      this.candidate.complete = true;
  }
  played(state: {
    generation: number;
    queuedSources: number;
    cartVersion: number | undefined;
    running: boolean;
    now: number;
  }): ReadbackPlayed | null {
    const candidate = this.candidate;
    if (!candidate) return null;
    if (
      state.generation !== candidate.generation ||
      state.cartVersion !== candidate.cart_version ||
      state.now >= candidate.expires_at
    ) {
      this.invalidate();
      return null;
    }
    if (
      !candidate.complete ||
      !candidate.audioSeen ||
      state.queuedSources !== 0 ||
      !state.running
    )
      return null;
    this.invalidate();
    return {
      type: "readback_played",
      readback_id: candidate.readback_id,
      readback_hash: candidate.readback_hash,
      generation: candidate.generation,
    };
  }
}
