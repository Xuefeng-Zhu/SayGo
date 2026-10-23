import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function capture() {
  const messages: unknown[] = [];
  type Processor = {
    port: { onmessage: (event: { data: unknown }) => void };
    process: (inputs: Float32Array[][]) => boolean;
  };
  let ProcessorClass: new () => Processor;
  vm.runInNewContext(readFileSync("apps/web/public/pcm-worklet.js", "utf8"), {
    sampleRate: 16000,
    AudioWorkletProcessor: class {
      port = {
        onmessage: () => {},
        postMessage: (message: unknown) => messages.push(message),
      };
    },
    registerProcessor: (_name: string, value: typeof ProcessorClass) => {
      ProcessorClass = value;
    },
  });
  const processor = new ProcessorClass!();
  const command = (enabled: boolean, id: string, flush = false) =>
    processor.port.onmessage({
      data: { type: "capture_state", enabled, request_id: id, flush },
    });
  const input = (samples: number, value: number) =>
    processor.process([[new Float32Array(samples).fill(value)]]);
  const pcm = () =>
    messages
      .filter(
        (message) =>
          Object.prototype.toString.call(message) === "[object ArrayBuffer]",
      )
      .map((buffer) => Array.from(new Int16Array(buffer as ArrayBuffer)));
  return { messages, command, input, pcm };
}

describe("spoken confirmation PCM boundaries", () => {
  it("discards partial pre-window audio and records only fresh samples after reset acknowledgement", () => {
    const qa = capture();
    qa.input(400, 0.25);
    qa.command(false, "pause");
    qa.input(1024, -0.5);
    expect(qa.pcm()).toEqual([]);
    qa.command(true, "record");
    qa.input(512, 0.5);
    expect(qa.messages.slice(0, 2)).toEqual([
      { type: "capture_state", enabled: false, request_id: "pause" },
      { type: "capture_state", enabled: true, request_id: "record" },
    ]);
    expect(qa.pcm()).toEqual([Array(512).fill(16384)]);
  });

  it("flushes every trailing sample before the seal acknowledgement and forwards nothing afterward", () => {
    const qa = capture();
    qa.command(false, "pause");
    qa.command(true, "record");
    qa.input(600, 0.5);
    qa.command(false, "seal", true);
    qa.input(1024, -0.5);
    expect(qa.pcm()).toEqual([Array(512).fill(16384), Array(88).fill(16384)]);
    expect(qa.messages.at(-1)).toEqual({
      type: "capture_state",
      enabled: false,
      request_id: "seal",
    });
  });
});
