export interface AudioNodeLike {
  stop(): void;
  onended: ((...args: never[]) => unknown) | null;
}
/** Scheduler independent of React so interruption/backpressure is testable without a microphone. */
export class PlaybackQueue {
  generation = 0;
  next = 0;
  private sources = new Set<AudioNodeLike>();
  constructor(private now: () => number) {}
  enqueue(
    generation: number,
    duration: number,
    start: (time: number) => AudioNodeLike,
  ) {
    if (generation !== this.generation) return false;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 5)
      throw new Error("Invalid audio duration");
    const at = Math.max(this.next, this.now());
    if (at - this.now() + duration > 5)
      throw new Error("Playback queue exceeded its limit");
    const source = start(at);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    this.next = at + duration;
    return true;
  }
  interrupt(generation: number) {
    if (generation < this.generation) return;
    this.generation = generation;
    this.clear();
  }
  clear() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources.clear();
    this.next = this.now();
  }
  get queuedSources() {
    return this.sources.size;
  }
}
