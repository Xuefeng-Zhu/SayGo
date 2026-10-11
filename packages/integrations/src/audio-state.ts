/** Audio generations are independent of database versions and ownership fences. */
export class AudioGeneration {
  generation = 0;
  private current = "";
  private blocked = new Set<string>();
  start(completion: string) {
    this.current = completion;
  }
  interrupt() {
    if (this.current) this.blocked.add(this.current);
    this.generation++;
    return this.generation;
  }
  accepts(completion: string) {
    return !this.blocked.has(completion);
  }
}
export class BoundedQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiter: (() => void) | null = null;
  private ended = false;
  constructor(private limit = 100) {}
  push(item: T) {
    if (this.ended) return;
    if (this.items.length >= this.limit)
      throw new Error("Audio backpressure limit reached");
    this.items.push(item);
    this.waiter?.();
    this.waiter = null;
  }
  close() {
    this.ended = true;
    this.waiter?.();
    this.waiter = null;
  }
  async *[Symbol.asyncIterator]() {
    while (!this.ended || this.items.length) {
      if (this.items.length) yield this.items.shift()!;
      else
        await new Promise<void>((resolve) => {
          this.waiter = resolve;
        });
    }
  }
}
