import { it, expect } from "vitest";
import {
  PlaybackQueue,
  type AudioNodeLike,
} from "../../apps/web/app/components/playback.js";
import {
  AudioGeneration,
  BoundedQueue,
} from "../../packages/integrations/src/audio-state.js";
it("barge-in advances generation and suppresses old completion chunks", () => {
  const a = new AudioGeneration();
  a.start("old");
  expect(a.accepts("old")).toBe(true);
  expect(a.interrupt()).toBe(1);
  expect(a.accepts("old")).toBe(false);
  a.start("new");
  expect(a.accepts("new")).toBe(true);
  expect(a.accepts("old")).toBe(false);
});
it("bounds audio buffering and drains on close", async () => {
  const q = new BoundedQueue<number>(2);
  q.push(1);
  q.push(2);
  expect(() => q.push(3)).toThrow("backpressure");
  q.close();
  const values = [];
  for await (const value of q) values.push(value);
  expect(values).toEqual([1, 2]);
});
it("interrupt stops active and already scheduled audio; stale chunks never schedule", () => {
  let stopped = 0,
    scheduled = 0;
  const queue = new PlaybackQueue(() => 1);
  const start = (): AudioNodeLike => {
    scheduled++;
    return {
      stop: () => {
        stopped++;
      },
      onended: null,
    };
  };
  queue.enqueue(0, 1, start);
  queue.enqueue(0, 1, start);
  expect(queue.queuedSources).toBe(2);
  queue.interrupt(1);
  expect(stopped).toBe(2);
  expect(queue.queuedSources).toBe(0);
  expect(queue.next).toBe(1);
  expect(queue.enqueue(0, 1, start)).toBe(false);
  expect(scheduled).toBe(2);
  expect(queue.enqueue(1, 1, start)).toBe(true);
});
it("accepts a normal faster-than-real-time speech burst but caps backlog at thirty seconds", () => {
  const queue = new PlaybackQueue(() => 0);
  const start = (): AudioNodeLike => ({ stop: () => {}, onended: null });
  queue.enqueue(0, 4, start);
  expect(queue.enqueue(0, 2, start)).toBe(true);
  for (let i = 0; i < 6; i++) queue.enqueue(0, 4, start);
  expect(queue.next).toBe(30);
  expect(() => queue.enqueue(0, 1, start)).toThrow("limit");
});
it("also bounds source count and releases completed sources", () => {
  const queue = new PlaybackQueue(() => 0);
  const nodes: AudioNodeLike[] = [];
  const start = (): AudioNodeLike => {
    const node = { stop: () => {}, onended: null } as AudioNodeLike;
    nodes.push(node);
    return node;
  };
  for (let i = 0; i < 512; i++) queue.enqueue(0, 0.01, start);
  expect(() => queue.enqueue(0, 0.01, start)).toThrow("limit");
  nodes[0].onended?.();
  expect(queue.enqueue(0, 0.01, start)).toBe(true);
});
