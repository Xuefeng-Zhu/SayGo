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
  type ProviderVoiceEvidence,
  type VoiceEvent,
} from "../../packages/integrations/src/nova.js";
it("retains a genuine submit request with a truthful pending response without calling MCP", async () => {
  const call = vi.fn(),
    onTool = vi.fn(),
    onSubmissionPendingSent = vi.fn();
  const retainSubmission = vi.fn(async () => ({
    code: "PENDING_VERIFICATION",
    pending_verification: true,
  }));
  const session = new NovaSession({ tools: [], call }, () => {}, {
    retainSubmission,
    onTool,
    onSubmissionPendingSent,
  });
  const send = vi.spyOn(
    session as unknown as {
      send(name: string, data: Record<string, unknown>): void;
    },
    "send",
  );
  const args = { quote_id: "49c5ede6-cd02-4a3a-99aa-31a1ff30019b" };
  session.handle("toolUse", {
    contentId: "approval-submit",
    toolName: "submit_order",
    toolUseId: "approval-submit",
    content: JSON.stringify(args),
  });
  session.handle("contentEnd", {
    contentId: "approval-submit",
    stopReason: "TOOL_USE",
  });
  await session.drain();
  expect(retainSubmission).toHaveBeenCalledExactlyOnceWith(args);
  expect(call).not.toHaveBeenCalled();
  expect(onTool).not.toHaveBeenCalled();
  expect(onSubmissionPendingSent).toHaveBeenCalledOnce();
  expect(
    JSON.parse(
      send.mock.calls.find(([name]) => name === "toolResult")![1]
        .content as string,
    ),
  ).toEqual({ code: "PENDING_VERIFICATION", pending_verification: true });
  session.close();
});
it("seals audio before returning a pending tool result, then finishes without a forced abort", async () => {
  const session = new NovaSession({ tools: [], call: vi.fn() }, () => {}, {
    retainSubmission: async () => ({ code: "PENDING_VERIFICATION" }),
    onSubmissionPendingSent: () => session.finishSession(),
  });
  const send = vi.spyOn(
    session as unknown as {
      send(name: string, data: Record<string, unknown>): void;
    },
    "send",
  );
  const controller = (session as unknown as { controller: AbortController })
    .controller;
  session.finishInput();
  expect(controller.signal.aborted).toBe(false);
  expect(() => session.audio(Buffer.alloc(640))).toThrow("sealed");
  session.handle("toolUse", {
    contentId: "submit-after-seal",
    toolName: "submit_order",
    toolUseId: "submit-after-seal",
    content: '{"quote_id":"49c5ede6-cd02-4a3a-99aa-31a1ff30019b"}',
  });
  session.handle("contentEnd", {
    contentId: "submit-after-seal",
    stopReason: "TOOL_USE",
  });
  await session.drain();
  expect(send.mock.calls.map(([name]) => name)).toEqual([
    "contentEnd",
    "contentStart",
    "toolResult",
    "contentEnd",
    "promptEnd",
    "sessionEnd",
  ]);
  expect(controller.signal.aborted).toBe(false);
  session.close();
});
it("observes provider block identity and partial boundaries without treating FINAL as a complete user turn", () => {
  const evidence: ProviderVoiceEvidence[] = [];
  const session = new NovaSession(
    { tools: [], call: async () => ({}) },
    () => {},
    { onProviderEvidence: (event) => evidence.push(event) },
  );
  session.handle("contentStart", {
    contentId: "user-fragment",
    completionId: "conversation",
    role: "USER",
    type: "TEXT",
    additionalModelFields: '{"generationStage":"FINAL"}',
  });
  session.handle("textOutput", {
    contentId: "user-fragment",
    content: "Yes, place the order",
  });
  session.handle("contentEnd", {
    contentId: "user-fragment",
    stopReason: "PARTIAL_TURN",
  });
  expect(evidence[2]).toMatchObject({
    name: "contentEnd",
    contentId: "user-fragment",
    completionId: "conversation",
    role: "USER",
    contentType: "TEXT",
    final: true,
    stopReason: "PARTIAL_TURN",
  });
  expect(evidence[1].text).toBe("Yes, place the order");
  session.handle("contentStart", {
    contentId: "audio",
    completionId: "conversation",
    role: "ASSISTANT",
    type: "AUDIO",
  });
  session.handle("audioOutput", {
    contentId: "audio",
    content: Buffer.alloc(48).toString("base64"),
  });
  expect(evidence[4]).toMatchObject({
    audioBytes: 48,
    role: "ASSISTANT",
    contentId: "audio",
  });
  expect(evidence[4]).not.toHaveProperty("content");
  expect(evidence[4]).not.toHaveProperty("audio");
  session.close();
});
it("uses a server result transform before returning a review to the provider", async () => {
  const events: VoiceEvent[] = [];
  const transformToolResult = vi.fn(async (_name, _args, result) => ({
    ...result,
    voice_confirmation_available: false,
  }));
  const session = new NovaSession(
    { tools: [], call: async () => ({ quote_id: "server-quote" }) },
    (event) => events.push(event),
    { transformToolResult },
  );
  const send = vi.spyOn(
    session as unknown as {
      send(name: string, data: Record<string, unknown>): void;
    },
    "send",
  );
  session.handle("toolUse", {
    contentId: "review",
    toolName: "prepare_order_review",
    toolUseId: "review",
    content: "{}",
  });
  session.handle("contentEnd", { contentId: "review", stopReason: "TOOL_USE" });
  await session.drain();
  expect(transformToolResult).toHaveBeenCalledOnce();
  const reply = send.mock.calls.find(([name]) => name === "toolResult")![1];
  expect(JSON.parse(reply.content as string)).toEqual({
    quote_id: "server-quote",
    voice_confirmation_available: false,
  });
  expect(events.some((event) => event.type === "cart_changed")).toBe(true);
  session.close();
});
it("aborts a full input queue without throwing from close or accepting later input", () => {
  vi.useFakeTimers();
  try {
    const session = new NovaSession(
      { tools: [], call: async () => ({}) },
      () => {},
    );
    const internals = session as unknown as {
      client: { destroy(): void };
      controller: AbortController;
    };
    const destroy = vi.spyOn(internals.client, "destroy");
    for (let i = 0; i < 120; i++) session.audio(Buffer.alloc(1024));
    expect(() => session.close()).not.toThrow();
    expect(internals.controller.signal.aborted).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(() => session.audio(Buffer.alloc(1024))).not.toThrow();
    expect(() => session.close()).not.toThrow();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
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
  expect(session.interrupt()).toBe(1);
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

it("does not advertise order submission to a live voice model", async () => {
  const session = new NovaSession(
    {
      tools: [
        { name: "get_cart", inputSchema: { type: "object" as const } },
        { name: "submit_order", inputSchema: { type: "object" as const } },
        {
          name: "apply_cart_changes",
          inputSchema: {
            type: "object" as const,
            properties: { request_id: { type: "string" } },
            required: ["request_id"],
          },
        },
      ],
      call: async () => ({}),
    },
    () => {},
  );
  const client = (
    session as unknown as {
      client: { send(command: unknown): Promise<unknown> };
    }
  ).client;
  const send = vi.spyOn(client, "send").mockResolvedValue({
    body: [],
  });
  await session.start();
  const command = send.mock.calls[0][0] as unknown as {
    input: { body: AsyncIterable<{ chunk: { bytes: Uint8Array } }> };
  };
  const sent: { event: Record<string, unknown> }[] = [];
  for await (const chunk of command.input.body)
    sent.push(JSON.parse(Buffer.from(chunk.chunk.bytes).toString()));
  const prompt = sent.find((e) => e.event.promptStart)?.event.promptStart as {
    toolConfiguration: {
      tools: { toolSpec: { name: string; inputSchema: { json: string } } }[];
    };
  };
  expect(prompt.toolConfiguration.tools.map((t) => t.toolSpec.name)).toEqual([
    "get_cart",
    "apply_cart_changes",
  ]);
  const cartSchema = JSON.parse(
    prompt.toolConfiguration.tools[1].toolSpec.inputSchema.json,
  );
  expect(cartSchema.properties).not.toHaveProperty("request_id");
  expect(cartSchema.required).not.toContain("request_id");
});
it("blocks an unadvertised submission even if the provider requests it", async () => {
  const call = vi.fn(async () => ({}));
  const session = new NovaSession({ tools: [], call }, () => {});
  const send = vi.spyOn(
    session as unknown as {
      send(name: string, data: Record<string, unknown>): void;
    },
    "send",
  );
  session.handle("toolUse", {
    contentId: "spoken-yes",
    toolName: "submit_order",
    toolUseId: "submit-1",
    content: JSON.stringify({ quote_id: "quote-from-review" }),
  });
  session.handle("contentEnd", {
    contentId: "spoken-yes",
    stopReason: "TOOL_USE",
  });
  await session.drain();
  expect(call).not.toHaveBeenCalled();
  const response = send.mock.calls.find(([name]) => name === "toolResult")![1];
  expect(JSON.parse(response.content as string)).toMatchObject({
    error: { code: "VOICE_PENDING", next_action: "wait_for_voice" },
  });
  session.close();
});

it("owns transport IDs and canonicalizes identical retries without conflating new edits", async () => {
  const call = vi.fn(
    async (_name: string, _args: Record<string, unknown>) => ({}),
  );
  const session = new NovaSession({ tools: [], call }, () => {});
  const run = async (id: string, args: Record<string, unknown>) => {
    session.handle("toolUse", {
      contentId: id,
      toolName: "apply_cart_changes",
      toolUseId: id,
      content: JSON.stringify(args),
    });
    session.handle("contentEnd", { contentId: id, stopReason: "TOOL_USE" });
    await session.drain();
  };
  const args = {
    expected_version: 0,
    request_id: "not-a-uuid",
    commands: [
      {
        type: "add",
        product_id: "classic",
        choices: { remove: ["onions"], extra: ["cheese"] },
      },
    ],
  };
  await run("first", args);
  await run("missing-reordered", {
    commands: [
      {
        choices: { extra: ["cheese"], remove: ["onions"] },
        product_id: "classic",
        type: "add",
      },
    ],
    expected_version: 0,
  });
  await run("different-invalid", { ...args, request_id: "other-invalid-id" });
  await run("changed", { ...args, expected_version: 1 });
  const supplied = "8a868a30-777f-4b24-a4fd-d4f7311bc633";
  await run("model-supplied", { ...args, request_id: supplied });
  const ids = call.mock.calls.map(([, input]) => input.request_id);
  expect(ids[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).toBe(ids[0]);
  expect(ids[3]).not.toBe(ids[0]);
  expect(ids[4]).toBe(ids[0]);
  expect(ids[4]).not.toBe(supplied);
  expect(JSON.stringify(call.mock.calls[1][1])).toBe(
    JSON.stringify(call.mock.calls[0][1]),
  );
  session.close();
});
it("sends the reset token only to the scoped UI bridge and labels it a proposal", async () => {
  const token = "a".repeat(64);
  const onTool = vi.fn();
  const session = new NovaSession(
    {
      tools: [],
      call: async () => ({ cart_version: 2, reset_token: token }),
    },
    () => {},
    { onTool },
  );
  const send = vi.spyOn(
    session as unknown as {
      send(name: string, data: Record<string, unknown>): void;
    },
    "send",
  );
  session.handle("toolUse", {
    contentId: "reset",
    toolName: "cancel_draft_order",
    toolUseId: "reset-1",
    content: JSON.stringify({ expected_version: 2 }),
  });
  session.handle("contentEnd", { contentId: "reset", stopReason: "TOOL_USE" });
  await session.drain();
  expect(onTool).toHaveBeenCalledWith(
    "cancel_draft_order",
    { expected_version: 2 },
    { cart_version: 2, reset_token: token },
  );
  const response = send.mock.calls.find(([name]) => name === "toolResult")![1];
  const payload = JSON.parse(response.content as string);
  expect(payload).not.toHaveProperty("reset_token");
  expect(payload.reset_status).toBe("awaiting_customer_confirmation");
  expect(payload.summary).toContain("draft is unchanged");
  expect(payload.summary).toContain("Confirm reset");
  session.close();
});

it("keeps review retry identity until the quote expires, then permits a fresh review", async () => {
  const call = vi
    .fn(async (_name: string, _args: Record<string, unknown>) => ({}))
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(
      new McpCallError(recoveryFor("STALE_QUOTE", "Expired")),
    )
    .mockResolvedValueOnce({});
  const session = new NovaSession({ tools: [], call }, () => {});
  for (const id of ["review", "expired-retry", "fresh-review"]) {
    session.handle("toolUse", {
      contentId: id,
      toolName: "prepare_order_review",
      toolUseId: id,
      content: JSON.stringify({ expected_version: 2 }),
    });
    session.handle("contentEnd", { contentId: id, stopReason: "TOOL_USE" });
    await session.drain();
  }
  const ids = call.mock.calls.map(([, args]) => args.request_id);
  expect(ids[1]).toBe(ids[0]);
  expect(ids[2]).not.toBe(ids[0]);
  session.close();
});
