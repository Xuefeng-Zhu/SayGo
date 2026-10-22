export interface AudioNodeLike {
  stop(): void;
  onended: ((...args: never[]) => unknown) | null;
}
export const MAX_BUFFERED_PLAYBACK_SECONDS = 30;
export const MAX_QUEUED_PLAYBACK_SOURCES = 512;
/** Scheduler independent of React so interruption/backpressure is testable without a microphone. */
export class PlaybackQueue {
  generation = 0;
  next = 0;
  private sources = new Set<AudioNodeLike>();
  constructor(
    private now: () => number,
    private onDrained?: () => void,
  ) {}
  enqueue(
    generation: number,
    duration: number,
    start: (time: number) => AudioNodeLike,
  ) {
    if (generation !== this.generation) return false;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 5)
      throw new Error("Invalid audio duration");
    const at = Math.max(this.next, this.now());
    // Sonic emits faster than real time: a normal sentence may arrive before
    // five seconds have played. Bound memory/latency without rejecting it.
    if (
      at - this.now() + duration > MAX_BUFFERED_PLAYBACK_SECONDS ||
      this.sources.size >= MAX_QUEUED_PLAYBACK_SOURCES
    )
      throw new Error("Playback queue exceeded its limit");
    const source = start(at);
    this.sources.add(source);
    source.onended = () => {
      if (this.sources.delete(source) && this.sources.size === 0)
        this.onDrained?.();
    };
    this.next = at + duration;
    return true;
  }
  interrupt(generation: number) {
    if (generation < this.generation) return;
    this.generation = generation;
    this.clear();
  }
  clear() {
    const sources = [...this.sources];
    this.sources.clear();
    this.next = this.now();
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
  }
  get queuedSources() {
    return this.sources.size;
  }
}
