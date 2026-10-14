import { it, expect, vi } from "vitest";
import { recoveryFor } from "@saygo/contracts";
import { McpCallError } from "../../packages/integrations/src/mcp-client.js";
import { AudioGeneration } from "../../packages/integrations/src/audio-state.js";
it("rejects obsolete completion audio and deduplicates interruption notifications", () => {
  const state = new AudioGeneration();
  state.start("first");
  expect(state.interrupt()).toBe(1);
  expect(state.interrupt()).toBe(1);
  state.start("second");
  expect(state.accepts("first")).toBe(false);
  expect(state.accepts("second")).toBe(true);
  state.start("third");
  expect(state.accepts("second")).toBe(false);
});
import {
  NovaSession,
  type VoiceEvent,
} from "../../packages/integrations/src/nova.js";
it("cleans up and reports unknown usage when the provider rejects stream startup", async () => {
  const onStreamEnd = vi.fn();
  const onProviderRequest = vi.fn();
  const session = new NovaSession(
    { tools: [], call: async () => ({}) },
    () => {},
    { onStreamEnd, onProviderRequest },
  );
  const client = (
    session as unknown as {
      client: { send(): Promise<never>; destroy(): void };
    }
  ).client;
  vi.spyOn(client, "send").mockRejectedValue(
    new Error("synthetic startup rejection"),
  );
  const destroy = vi.spyOn(client, "destroy");
  await expect(session.start()).rejects.toThrow("synthetic startup rejection");
  expect(destroy).toHaveBeenCalledOnce();
  expect(onProviderRequest).toHaveBeenCalledOnce();
  expect(onStreamEnd).toHaveBeenCalledExactlyOnceWith(
    false,
    "ProviderStreamError",
  );
});
it("reports real provider modality counts without inventing zero usage", () => {
  const events: VoiceEvent[] = [];
  const session = new NovaSession({ tools: [], call: async () => ({}) }, (e) =>
    events.push(e),
  );
  session.handle("usageEvent", {
    details: {
      total: {
        input: { speechTokens: 5, textTokens: 10 },
        output: { speechTokens: 20, textTokens: 30 },
      },
    },
  });
  expect(events[0]).toMatchObject({
    type: "usage",
    usage: { inputSpeech: 5, inputText: 10, outputSpeech: 20, outputText: 30 },
  });
  expect(() => session.handle("usageEvent", {})).toThrow();
  session.close();
});
it("preserves structured recovery instructions in the Nova tool response", async () => {
  const recovery = recoveryFor("FENCED", "Staff controls this interaction.");
  const call = vi.fn(async () => {
    throw new McpCallError(recovery);
  });
  const session = new NovaSession({ tools: [], call }, () => {});
  const send = vi.spyOn(
    session as unknown as {
      send(name: string, data: Record<string, unknown>): void;
    },
    "send",
  );
  session.handle("toolUse", {
    contentId: "error",
    toolName: "get_cart",
    toolUseId: "error1",
    content: "{}",
  });
  session.handle("contentEnd", { contentId: "error", stopReason: "TOOL_USE" });
  await session.drain();
  const result = send.mock.calls.find(([name]) => name === "toolResult")![1];
  expect(JSON.parse(result.content as string)).toEqual({ error: recovery });
  expect(call).toHaveBeenCalledTimes(1);
  session.close();
});
it("never executes provisional text or incomplete tool arguments", async () => {
  const call = vi.fn(async () => ({ summary: "done" }));
  const events: VoiceEvent[] = [];
  const session = new NovaSession({ tools: [], call }, (e) => events.push(e));
  session.handle("contentStart", {
    contentId: "text",
    role: "USER",
    additionalModelFields: '{"generationStage":"SPECULATIVE"}',
  });
  session.handle("textOutput", { contentId: "text", content: "add a burger" });
  session.handle("contentEnd", { contentId: "text", stopReason: "END_TURN" });
  expect(call).not.toHaveBeenCalled();
  session.handle("contentStart", {
    contentId: "tool",
    type: "TOOL",
    role: "TOOL",
  });
  session.handle("toolUse", {
    contentId: "tool",
    toolName: "get_cart",
    toolUseId: "call1",
    content: "{",
  });
  expect(call).not.toHaveBeenCalled();
  session.handle("toolUse", {
    contentId: "tool",
    toolName: "get_cart",
    toolUseId: "call1",
    content: "}",
  });
  expect(call).not.toHaveBeenCalled();
  session.handle("contentEnd", { contentId: "tool", stopReason: "TOOL_USE" });
  await session.drain();
  expect(call).toHaveBeenCalledExactlyOnceWith("get_cart", {});
  expect(events.some((e) => e.type === "caption" && e.final === false)).toBe(
    true,
  );
  session.close();
});
it("invalid complete arguments fail without invoking MCP", async () => {
  const call = vi.fn(async () => ({}));
  const session = new NovaSession({ tools: [], call }, () => {});
  session.handle("toolUse", {
    contentId: "bad",
    toolName: "get_cart",
    toolUseId: "bad1",
    content: "{bad",
  });
  session.handle("contentEnd", { contentId: "bad", stopReason: "TOOL_USE" });
  await session.drain();
  expect(call).not.toHaveBeenCalled();
  session.close();
});
it("provider interruption drops delayed output from the old completion", () => {
  const events: VoiceEvent[] = [];
  const session = new NovaSession({ tools: [], call: async () => ({}) }, (e) =>
    events.push(e),
  );
  session.handle("completionStart", { completionId: "old" });
  session.handle("audioOutput", { completionId: "old", content: "AAA=" });
  session.interrupt();
  session.handle("audioOutput", { completionId: "old", content: "AAA=" });
  session.handle("completionStart", { completionId: "new" });
  session.handle("audioOutput", { completionId: "new", content: "AAA=" });
  expect(
    events.filter((e) => e.type === "audio").map((e) => e.generation),
  ).toEqual([0, 1]);
  session.close();
});
it("resumes new audio content under a reused completion ID after barge-in", () => {
  const events: VoiceEvent[] = [];
  const session = new NovaSession({ tools: [], call: async () => ({}) }, (e) =>
    events.push(e),
  );
  session.handle("completionStart", { completionId: "shared" });
  session.handle("contentStart", {
    completionId: "shared",
    contentId: "old-audio",
    type: "AUDIO",
    role: "ASSISTANT",
  });
  session.handle("audioOutput", {
    completionId: "shared",
    contentId: "old-audio",
    content: "AAA=",
  });
  session.interrupt();
  session.handle("contentStart", {
    completionId: "shared",
    contentId: "user",
    role: "USER",
    additionalModelFields: '{"generationStage":"FINAL"}',
  });
  session.handle("textOutput", { contentId: "user", content: "A new request" });
  session.handle("contentEnd", { completionId: "shared", contentId: "user" });
  session.handle("contentStart", {
    completionId: "shared",
    contentId: "new-audio",
    type: "AUDIO",
    role: "ASSISTANT",
  });
  session.handle("audioOutput", {
    completionId: "shared",
    contentId: "old-audio",
    content: "AAA=",
  });
  session.handle("audioOutput", {
    completionId: "shared",
    contentId: "new-audio",
    content: "AAA=",
  });
  expect(
    events.filter((e) => e.type === "audio").map((e) => e.generation),
  ).toEqual([0, 1]);
  expect(
    events.some(
      (e) =>
        e.type === "caption" && e.role === "USER" && e.text === "A new request",
    ),
  ).toBe(true);
  session.close();
});
