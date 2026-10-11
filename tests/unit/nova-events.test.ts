import { it, expect, vi } from "vitest";
import { recoveryFor } from "@saygo/contracts";
import { McpCallError } from "../../packages/integrations/src/mcp-client.js";
import {
  NovaSession,
  type VoiceEvent,
} from "../../packages/integrations/src/nova.js";
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
