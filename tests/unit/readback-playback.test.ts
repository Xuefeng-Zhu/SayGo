import { describe, expect, it, vi } from "vitest";
import { ReadbackPlayback } from "../../apps/web/app/components/readback-playback";
import {
  PlaybackQueue,
  type AudioNodeLike,
} from "../../apps/web/app/components/playback";

const first = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const frame = (readback_id = first) => ({
  readback_id,
  readback_hash: "a".repeat(64),
  generation: 0,
  cart_version: 3,
  expires_at: new Date(10000).toISOString(),
});
const ready = {
  generation: 0,
  queuedSources: 0,
  cartVersion: 3,
  running: true,
  now: 5000,
};
const prepared = () => {
  const gate = new ReadbackPlayback();
  gate.begin(frame(), 0, 1000);
  gate.audio(0);
  return gate;
};

describe("readback playback receipts", () => {
  it("requires actual audio, exact completion and the entire output queue to drain", () => {
    const gate = new ReadbackPlayback();
    gate.begin(frame(), 0, 1000);
    expect(gate.played(ready)).toBeNull();
    gate.complete(frame());
    expect(gate.played(ready)).toBeNull();
    gate.audio(0);
    expect(gate.played({ ...ready, queuedSources: 1 })).toBeNull();
    expect(gate.played({ ...ready, running: false })).toBeNull();
    expect(gate.played(ready)).toEqual({
      type: "readback_played",
      readback_id: first,
      readback_hash: "a".repeat(64),
      generation: 0,
    });
    expect(gate.played(ready)).toBeNull();
  });

  it("does not treat audio, another hash or another window's completion as the readback", () => {
    const gate = prepared();
    gate.complete(frame(second));
    gate.complete({ ...frame(), readback_hash: "b".repeat(64) });
    gate.complete({ ...frame(), generation: 1 });
    expect(gate.played(ready)).toBeNull();
    gate.complete(frame());
    expect(gate.played(ready)?.readback_id).toBe(first);
  });

  it.each([{ generation: 1 }, { cartVersion: 4 }, { now: 10000 }])(
    "retires a stale or expired candidate (%j)",
    (changed) => {
      const gate = prepared();
      gate.complete(frame());
      expect(gate.played({ ...ready, ...changed })).toBeNull();
      gate.begin(frame(), 0, 1000);
      gate.audio(0);
      gate.complete(frame());
      expect(gate.played(ready)).toBeNull();
    },
  );

  it("does not restore an invalidated readback after interrupt/new input/reset", () => {
    const gate = prepared();
    gate.invalidate();
    gate.complete(frame());
    gate.audio(0);
    gate.begin(frame(), 0, 1000);
    expect(gate.played(ready)).toBeNull();
    gate.begin(frame(second), 0, 1000);
    gate.audio(0);
    gate.complete(frame(second));
    expect(gate.played(ready)?.readback_id).toBe(second);
  });

  it("ignores duplicate starts without losing queued audio, but never replays an acknowledgment", () => {
    const gate = prepared();
    gate.begin(frame(), 0, 1000);
    gate.complete(frame());
    expect(gate.played(ready)?.readback_id).toBe(first);
    gate.begin(frame(), 0, 1000);
    gate.audio(0);
    gate.complete(frame());
    expect(gate.played(ready)).toBeNull();
  });

  it("rejects malformed identities and conflicting immutable window fields", () => {
    const gate = prepared();
    for (const invalid of [
      { ...frame(), readback_id: "invalid" },
      { ...frame(), readback_hash: "short" },
      { ...frame(), generation: -1 },
      { ...frame(), cart_version: 0.5 },
      { ...frame(), expires_at: "invalid" },
      { ...frame(), readback_hash: "b".repeat(64) },
    ])
      expect(() => gate.begin(invalid, 0, 1000)).toThrow();
  });

  it("never arms from an expired or other-generation start", () => {
    for (const [generation, now] of [
      [1, 1000],
      [0, 10000],
    ]) {
      const gate = new ReadbackPlayback();
      gate.begin(frame(), generation, now);
      gate.audio(0);
      gate.complete(frame());
      expect(gate.played(ready)).toBeNull();
    }
  });
});

describe("playback queue completion", () => {
  it("notifies only after every naturally ended source, not clear/interrupt", () => {
    const drained = vi.fn();
    const queue = new PlaybackQueue(() => 0, drained);
    const nodes: AudioNodeLike[] = [];
    const create = () => {
      const node: AudioNodeLike = {
        onended: null,
        stop() {
          node.onended?.();
        },
      };
      nodes.push(node);
      return node;
    };
    queue.enqueue(0, 1, create);
    queue.enqueue(0, 1, create);
    nodes[0].onended?.();
    expect(drained).not.toHaveBeenCalled();
    nodes[1].onended?.();
    expect(drained).toHaveBeenCalledTimes(1);
    queue.enqueue(0, 1, create);
    queue.clear();
    expect(drained).toHaveBeenCalledTimes(1);
    queue.enqueue(0, 1, create);
    queue.interrupt(1);
    expect(drained).toHaveBeenCalledTimes(1);
  });
});
