import { EventEmitter } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { VoiceSessionOptions } from "../../packages/integrations/src/nova.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

interface TestSocket extends EventEmitter {
  readyState: number;
  bufferedAmount: number;
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}
const mock = vi.hoisted(() => {
  const client = { close: vi.fn<() => Promise<void>>(), call: vi.fn() };
  const nova = {
    start: vi.fn<() => Promise<void>>(),
    close: vi.fn<() => void>(),
    drain: vi.fn<() => Promise<void>>(),
    audio: vi.fn(),
    interrupt: vi.fn(),
    userText: vi.fn(),
  };
  return {
    client,
    nova,
    sockets: [] as TestSocket[],
    scopeForToken: vi.fn(),
    getView: vi.fn(),
    voiceLease:
      vi.fn<
        (
          sessionId: string,
          until: string | null,
          connectionId?: string,
        ) => Promise<void>
      >(),
    prepareVoiceConfirmation: vi.fn(),
    armVoiceConfirmation: vi.fn(),
    confirmVoiceOrder: vi.fn(),
    invalidateVoiceConfirmation: vi.fn(),
    openMcp: vi.fn<() => Promise<typeof client>>(),
    onEnd: vi.fn(),
    onTool: vi.fn(),
    options: {} as VoiceSessionOptions,
    laneScope: vi.fn(),
    tool: vi.fn(),
    staff: vi.fn(),
    staffAction: vi.fn(),
    activeScope: vi.fn(),
    emit: vi.fn(),
  };
});
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class WebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    send = vi.fn();
    close = vi.fn(() => {
      this.readyState = 3;
      this.emit("close");
    });
    constructor() {
      super();
      mock.sockets.push(this);
    }
  }
  return {
    WebSocket,
    WebSocketServer: class {
      handleUpgrade(
        _request: unknown,
        _socket: unknown,
        _head: unknown,
        callback: (socket: WebSocket) => void,
      ) {
        callback(new WebSocket());
      }
    },
  };
});
vi.mock("@saygo/db", () => ({
  config: {
    SAYGO_RUNTIME_PORT: 3199,
    SAYGO_WEB_ORIGIN: "http://localhost:3198",
    SAYGO_VOICE_ENABLED: "true",
  },
}));
vi.mock("@saygo/domain", async () => ({
  ...(await import("../../packages/domain/src/engine.js")),
  scopeForToken: mock.scopeForToken,
  getView: mock.getView,
  voiceLease: mock.voiceLease,
  prepareVoiceConfirmation: mock.prepareVoiceConfirmation,
  armVoiceConfirmation: mock.armVoiceConfirmation,
  confirmVoiceOrder: mock.confirmVoiceOrder,
  invalidateVoiceConfirmation: mock.invalidateVoiceConfirmation,
  tool: mock.tool,
  staffAction: mock.staffAction,
  activeScope: mock.activeScope,
}));
vi.mock("@saygo/integrations", () => ({
  openMcp: mock.openMcp,
  McpCallError: class extends Error {},
}));
vi.mock("../../apps/runtime/src/mcp.js", () => ({ handleMcp: vi.fn() }));
vi.mock("../../apps/runtime/src/auth.js", () => ({
  agentToken: () => "unit-agent-token",
  cookie: () => "unit-lane-cookie",
  laneScope: mock.laneScope,
  staff: mock.staff,
}));
vi.mock("../../packages/integrations/src/nova.js", () => ({
  NovaSession: class {
    constructor(
      _mcp: unknown,
      emit: typeof mock.emit,
      options: VoiceSessionOptions,
    ) {
      mock.options = options;
      mock.emit = emit;
      return mock.nova;
    }
  },
}));

let runtime: typeof import("../../apps/runtime/src/voice.js");
let server: EventEmitter;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
async function connect(keepCapabilityFrame = false) {
  server.emit(
    "upgrade",
    {
      url: "/voice",
      headers: { host: "localhost:3199", origin: "http://localhost:3198" },
    },
    { write() {}, destroy() {} },
    Buffer.alloc(0),
  );
  await flush();
  const socket = mock.sockets.at(-1)!;
  if (
    !keepCapabilityFrame &&
    socket?.send.mock.calls.length === 1 &&
    String(socket.send.mock.calls[0][0]).includes('"confirmation_unavailable"')
  )
    socket.send.mockClear();
  return socket;
}
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock.sockets.length = 0;
  mock.options = {};
  const scope = {
    restaurant_id: "harbor-demo",
    lane_id: "lane-1",
    session_id: "voice-unit",
    epoch: 1,
    fence: 2,
    actor: "customer",
  };
  mock.scopeForToken.mockResolvedValue(scope);
  mock.laneScope.mockResolvedValue(scope);
  mock.activeScope.mockResolvedValue({ ...scope, actor: "staff" });
  mock.getView.mockResolvedValue({
    session: {
      id: scope.session_id,
      fence: 2,
      owner: "ai",
      needs_staff_review: false,
    },
  });
  mock.voiceLease.mockResolvedValue();
  mock.invalidateVoiceConfirmation.mockResolvedValue(undefined);
  mock.openMcp.mockResolvedValue(mock.client);
  mock.client.close.mockResolvedValue();
  mock.staff.mockResolvedValue({ id: "crew", role: "crew" });
  mock.nova.start.mockImplementation(() => new Promise<void>(() => {}));
  mock.nova.drain.mockResolvedValue();
  runtime = await import("../../apps/runtime/src/voice.js");
  server = new EventEmitter();
  runtime.attachVoice(server as unknown as Server, {
    onEnd: mock.onEnd,
    onTool: mock.onTool,
  });
});
afterEach(async () => {
  await runtime.stopVoice("voice-unit");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("announces unavailable voice confirmation with the authenticated scope", async () => {
  const socket = await connect(true);
  expect(JSON.parse(socket.send.mock.calls[0][0] as string)).toEqual({
    type: "confirmation_unavailable",
    code: "UNSUPPORTED_USER_TURN_BOUNDARY",
    text: "Voice confirmation is unavailable with this provider. Stop voice and use Confirm order on the screen.",
    session_id: "voice-unit",
    epoch: 1,
    fence: 2,
  });
  expect(mock.prepareVoiceConfirmation).not.toHaveBeenCalled();
  expect(mock.armVoiceConfirmation).not.toHaveBeenCalled();
  expect(mock.confirmVoiceOrder).not.toHaveBeenCalled();
});
it("never enables consent from a model review or final USER/ASSISTANT events", async () => {
  await connect();
  const result = await mock.options.transformToolResult!(
    "prepare_order_review",
    { transcript: "Yes, place the order" },
    {
      quote: { id: "f47ce7a1-c7be-4653-8da6-81801e7369aa" },
      voice_confirmation_available: true,
    },
  );
  expect(result.voice_confirmation_available).toBe(false);
  for (const role of ["USER", "ASSISTANT"])
    mock.options.onProviderEvidence!({
      name: "contentEnd",
      at: Date.now(),
      generation: 0,
      contentId: "provider-final",
      completionId: "provider-completion",
      role,
      contentType: "TEXT",
      final: true,
      text: "Yes, place the order.",
      stopReason: "END_TURN",
    });
  await flush();
  expect(mock.prepareVoiceConfirmation).not.toHaveBeenCalled();
  expect(mock.armVoiceConfirmation).not.toHaveBeenCalled();
  expect(mock.confirmVoiceOrder).not.toHaveBeenCalled();
});
it("binds lease renewal, cleanup and consent invalidation to one connection UUID", async () => {
  await connect();
  const connection = mock.voiceLease.mock.calls[0][2];
  expect(connection).toMatch(/^[a-f0-9-]{36}$/);
  await vi.advanceTimersByTimeAsync(1000);
  await runtime.stopVoice("voice-unit");
  for (const [, , actual] of mock.voiceLease.mock.calls)
    expect(actual).toBe(connection);
  expect(mock.invalidateVoiceConfirmation).toHaveBeenCalledWith(
    expect.objectContaining({ actor: "agent", session_id: "voice-unit" }),
    connection,
  );
});
it("ignores browser transcript proofs and remains ineligible after typed WS input", async () => {
  const socket = await connect();
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({ type: "text", text: "Yes, place the order." }),
    ),
    false,
  );
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        type: "readback_played",
        readback_id: "f47ce7a1-c7be-4653-8da6-81801e7369aa",
        readback_hash: "a".repeat(64),
        generation: 0,
        transcript: "Yes, place the order",
        final: true,
      }),
    ),
    false,
  );
  await flush();
  expect(mock.nova.userText).toHaveBeenCalledWith("Yes, place the order.");
  expect(mock.armVoiceConfirmation).not.toHaveBeenCalled();
  expect(mock.confirmVoiceOrder).not.toHaveBeenCalled();
});
it("contains failed lease cleanup in socket callbacks and permits reconnect", async () => {
  const socket = await connect();
  mock.voiceLease.mockRejectedValueOnce(new Error("database unavailable"));
  socket.emit("close");
  await expect(runtime.stopVoice("voice-unit")).resolves.toBeUndefined();
  expect(mock.onEnd).toHaveBeenCalledOnce();
  const next = await connect();
  expect(next.close).not.toHaveBeenCalled();
  expect(mock.nova.start).toHaveBeenCalledTimes(2);
});
it("acknowledges an interrupt with its request identity and audio generation", async () => {
  const socket = await connect();
  const requestId = "96d55db5-79fb-47be-a989-e75b8b2a5701";
  mock.nova.interrupt.mockReturnValue(4);
  socket.emit(
    "message",
    Buffer.from(JSON.stringify({ type: "interrupt", request_id: requestId })),
    false,
  );
  expect(mock.nova.interrupt).toHaveBeenCalledOnce();
  expect(JSON.parse(socket.send.mock.calls.at(-1)![0] as string)).toEqual({
    type: "interrupt_ack",
    request_id: requestId,
    generation: 4,
    session_id: "voice-unit",
    epoch: 1,
    fence: 2,
  });
  const sent = socket.send.mock.calls.length;
  for (const request_id of [undefined, "", "x".repeat(65)])
    socket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "interrupt", request_id })),
      false,
    );
  expect(mock.nova.interrupt).toHaveBeenCalledTimes(4);
  expect(socket.send).toHaveBeenCalledTimes(sent);
});
it("continues overload cleanup when closing Nova and MCP both fail", async () => {
  const socket = await connect();
  mock.nova.audio.mockImplementationOnce(() => {
    throw new Error("input queue full");
  });
  mock.nova.close.mockImplementationOnce(() => {
    throw new Error("teardown queue full");
  });
  mock.client.close.mockRejectedValueOnce(new Error("transport closed"));
  expect(() => socket.emit("message", Buffer.alloc(1024), true)).not.toThrow();
  await expect(runtime.stopVoice("voice-unit")).resolves.toBeUndefined();
  expect(mock.voiceLease).toHaveBeenLastCalledWith(
    "voice-unit",
    null,
    expect.any(String),
  );
  expect(mock.onEnd).toHaveBeenCalledOnce();
});
it("waits for a late initial lease before clearing it and never starts a provider", async () => {
  const lease = deferred();
  mock.voiceLease.mockReturnValueOnce(lease.promise);
  await connect();
  const stopped = runtime.stopVoice("voice-unit");
  await flush();
  expect(mock.voiceLease).toHaveBeenCalledTimes(1);
  const duplicate = await connect();
  expect(duplicate.close).toHaveBeenCalledWith(
    1008,
    "One voice connection per customer",
  );
  lease.resolve();
  await stopped;
  expect(mock.openMcp).not.toHaveBeenCalled();
  expect(mock.nova.start).not.toHaveBeenCalled();
  expect(mock.voiceLease).toHaveBeenLastCalledWith(
    "voice-unit",
    null,
    expect.any(String),
  );
});
it("closes a late acquired MCP client before allowing the next connection", async () => {
  const connection = deferred();
  mock.openMcp.mockImplementationOnce(async () => {
    await connection.promise;
    return mock.client;
  });
  await connect();
  const stopped = runtime.stopVoice("voice-unit");
  await flush();
  expect(mock.client.close).not.toHaveBeenCalled();
  connection.resolve();
  await stopped;
  expect(mock.client.close).toHaveBeenCalledOnce();
  expect(mock.nova.start).not.toHaveBeenCalled();
  const next = await connect();
  expect(next.close).not.toHaveBeenCalled();
  expect(mock.nova.start).toHaveBeenCalledOnce();
});
it("settles an in-flight lease renewal before the final release", async () => {
  await connect();
  const renewal = deferred();
  mock.voiceLease.mockReturnValueOnce(renewal.promise);
  await vi.advanceTimersByTimeAsync(500);
  const stopped = runtime.stopVoice("voice-unit");
  await flush();
  expect(mock.voiceLease.mock.calls.every(([, until]) => until !== null)).toBe(
    true,
  );
  renewal.resolve();
  await stopped;
  expect(mock.voiceLease).toHaveBeenLastCalledWith(
    "voice-unit",
    null,
    expect.any(String),
  );
});
it("renews consent blocking while tools drain and keeps the registration exclusive", async () => {
  await connect();
  const drain = deferred();
  mock.nova.drain.mockReturnValueOnce(drain.promise);
  const stopped = runtime.stopVoice("voice-unit");
  await vi.advanceTimersByTimeAsync(20500);
  expect(mock.voiceLease.mock.calls.every(([, until]) => until !== null)).toBe(
    true,
  );
  expect(mock.voiceLease).toHaveBeenCalledTimes(42);
  expect(mock.client.close).not.toHaveBeenCalled();
  const duplicate = await connect();
  expect(duplicate.close).toHaveBeenCalledWith(
    1008,
    "One voice connection per customer",
  );
  drain.resolve();
  await stopped;
  expect(mock.voiceLease).toHaveBeenLastCalledWith(
    "voice-unit",
    null,
    expect.any(String),
  );
});
it("memoizes reentrant stop and cannot release a replacement connection", async () => {
  const first = await connect();
  await Promise.all([
    runtime.stopVoice("voice-unit"),
    runtime.stopVoice("voice-unit"),
  ]);
  expect(first.close).toHaveBeenCalledOnce();
  expect(mock.nova.drain).toHaveBeenCalledOnce();
  const next = await connect();
  const calls = mock.voiceLease.mock.calls.length;
  first.emit("close");
  await flush();
  expect(mock.voiceLease).toHaveBeenCalledTimes(calls);
  expect(next.close).not.toHaveBeenCalled();
});
it("reports startup failure and releases the registration without fixture fallback", async () => {
  mock.openMcp.mockRejectedValueOnce(new Error("MCP unavailable"));
  const socket = await connect();
  await runtime.stopVoice("voice-unit");
  expect(socket.send).toHaveBeenCalledWith(
    expect.stringContaining('"type":"error"'),
  );
  expect(mock.nova.start).not.toHaveBeenCalled();
  expect(mock.voiceLease).toHaveBeenLastCalledWith(
    "voice-unit",
    null,
    expect.any(String),
  );
  const next = await connect();
  expect(next.close).not.toHaveBeenCalled();
});

it("bridges only an authoritative reset proposal and preserves the tool observer", async () => {
  const socket = await connect();
  const args = { expected_version: 3, reset_token: "model-supplied-token" };
  const result = { reset_token: "server-token-".repeat(6), cart_version: 3 };
  mock.options.onTool!("cancel_draft_order", args, result);
  expect(mock.onTool).toHaveBeenCalledExactlyOnceWith(
    "cancel_draft_order",
    args,
    result,
  );
  expect(JSON.parse(socket.send.mock.calls.at(-1)![0] as string)).toEqual({
    type: "reset_proposed",
    reset_token: result.reset_token,
    cart_version: 3,
    session_id: "voice-unit",
    epoch: 1,
    fence: 2,
  });
});
it("never turns tool arguments, failed results or invalid versions into reset proposals", async () => {
  const socket = await connect();
  const valid = { reset_token: "server-token-".repeat(6), cart_version: 3 };
  const results = [
    {},
    { ...valid, error: { code: "FENCED" } },
    { ...valid, reset_token: "short" },
    { ...valid, reset_token: "x".repeat(513) },
    { ...valid, cart_version: -1 },
    { ...valid, cart_version: 1.5 },
  ];
  for (const result of results)
    mock.options.onTool!("cancel_draft_order", valid, result);
  mock.options.onTool!("get_cart", {}, valid);
  expect(socket.send).not.toHaveBeenCalled();
  expect(mock.onTool).toHaveBeenCalledTimes(results.length + 1);
});
it("does not forward a late reset proposal after that connection stops", async () => {
  const first = await connect();
  const prior = mock.options.onTool!;
  await runtime.stopVoice("voice-unit");
  const next = await connect();
  prior(
    "cancel_draft_order",
    {},
    {
      reset_token: "server-token-".repeat(6),
      cart_version: 3,
    },
  );
  expect(first.send).not.toHaveBeenCalled();
  expect(next.send).not.toHaveBeenCalled();
  expect(mock.onTool).toHaveBeenCalledOnce();
});
it("rejects an old upgrade that completes after takeover cleanup returned", async () => {
  const read = deferred();
  mock.getView.mockImplementationOnce(async () => {
    await read.promise;
    return { session: { needs_staff_review: false } };
  });
  const connecting = connect();
  await flush();
  await runtime.stopVoice("voice-unit", 3);
  read.resolve();
  await connecting;
  await flush();
  const socket = mock.sockets.at(-1)!;
  expect(socket.close).toHaveBeenCalledWith(
    1008,
    "Control changed. Start a new voice session.",
  );
  expect(mock.voiceLease).not.toHaveBeenCalled();
  expect(mock.openMcp).not.toHaveBeenCalled();
  expect(mock.nova.start).not.toHaveBeenCalled();
});
it("a delayed stop for an old control generation cannot stop resumed voice", async () => {
  await runtime.stopVoice("voice-unit", 3);
  mock.scopeForToken.mockResolvedValue({
    ...(await mock.scopeForToken()),
    fence: 4,
  });
  const socket = await connect();
  await runtime.stopVoice("voice-unit", 3);
  expect(socket.close).not.toHaveBeenCalled();
  expect(mock.nova.start).toHaveBeenCalledOnce();
});
it("revalidates ownership after a slow MCP acquisition before opening Nova", async () => {
  const acquired = deferred();
  mock.openMcp.mockImplementationOnce(async () => {
    await acquired.promise;
    return mock.client;
  });
  const socket = await connect();
  mock.getView.mockRejectedValueOnce(new Error("Fenced"));
  acquired.resolve();
  await flush();
  await runtime.stopVoice("voice-unit");
  expect(mock.nova.start).not.toHaveBeenCalled();
  expect(socket.close).toHaveBeenCalled();
  expect(mock.client.close).toHaveBeenCalledOnce();
});
it("a successful spoken staff request stops voice and suppresses late model output", async () => {
  const socket = await connect();
  mock.options.onTool!("request_staff_help", { reason: "assistance" }, {});
  const count = socket.send.mock.calls.length;
  mock.emit({ type: "audio", data: "late-audio" });
  mock.emit({ type: "text", text: "late-answer" });
  await runtime.stopVoice("voice-unit");
  expect(socket.send).toHaveBeenCalledTimes(count);
  expect(socket.close).toHaveBeenCalled();
  expect(mock.nova.close).toHaveBeenCalledOnce();
  expect(mock.nova.drain).toHaveBeenCalledOnce();
  expect(mock.voiceLease).toHaveBeenLastCalledWith(
    "voice-unit",
    null,
    expect.any(String),
  );
  const late = await connect();
  expect(late.close).toHaveBeenCalledWith(
    1008,
    "Control changed. Start a new voice session.",
  );
});

async function postAction(path: string, data: object) {
  const { app } = await import("../../apps/runtime/src/app.js");
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  const response = new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const request = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers: {
            host: "localhost:3199",
            origin: "http://localhost:3198",
            "content-type": "application/json",
          },
        },
        (reply) => {
          let body = "";
          reply.setEncoding("utf8");
          reply.on("data", (part: string) => {
            body += part;
          });
          reply.on("end", () => resolve({ status: reply.statusCode!, body }));
        },
      );
      request.on("error", reject);
      request.end(JSON.stringify(data));
    },
  );
  return {
    response,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}
const crewAction = {
  session_id: "a1bd75bb-d9b3-40df-a661-975938cd321b",
  action: "takeover",
  expected_fence: 2,
  request_id: "115160e0-6d3a-452d-a54f-761a01bfffe2",
};
it("HTTP takeover fences before draining and returns only after voice cleanup", async () => {
  vi.useRealTimers();
  const payload = crewAction;
  const scope = {
    ...(await mock.scopeForToken()),
    session_id: payload.session_id,
  };
  mock.scopeForToken.mockResolvedValue(scope);
  mock.activeScope.mockResolvedValue({ ...scope, actor: "staff" });
  await connect();
  const drain = deferred();
  mock.nova.drain.mockReturnValueOnce(drain.promise);
  const taken = {
    session: { id: payload.session_id, fence: 3, owner: "staff" },
  };
  mock.staffAction.mockImplementationOnce(async () => {
    expect(mock.nova.close).not.toHaveBeenCalled();
    return taken;
  });
  mock.getView.mockResolvedValue(taken);
  const http = await postAction("/api/crew/action", payload);
  let returned = false;
  void http.response.then(() => {
    returned = true;
  });
  try {
    await vi.waitFor(() => expect(mock.staffAction).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mock.nova.drain).toHaveBeenCalledOnce());
    expect(returned).toBe(false);
    drain.resolve();
    expect((await http.response).status).toBe(200);
    expect(mock.staffAction).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: payload.session_id }),
      "takeover",
      undefined,
      { expected_fence: 2, request_id: payload.request_id },
    );
    expect(mock.voiceLease).toHaveBeenLastCalledWith(
      payload.session_id,
      null,
      expect.any(String),
    );
  } finally {
    drain.resolve();
    await runtime.stopVoice(payload.session_id);
    await http.close();
  }
});
it("an HTTP retry of an old takeover does not stop the newly resumed AI session", async () => {
  vi.useRealTimers();
  const scope = {
    ...(await mock.scopeForToken()),
    session_id: crewAction.session_id,
    fence: 4,
  };
  mock.scopeForToken.mockResolvedValue(scope);
  mock.activeScope.mockResolvedValue({ ...scope, actor: "staff" });
  const socket = await connect();
  mock.staffAction.mockResolvedValue({
    session: { id: scope.session_id, fence: 4, owner: "ai" },
  });
  const http = await postAction("/api/crew/action", crewAction);
  try {
    expect((await http.response).status).toBe(200);
    expect(socket.close).not.toHaveBeenCalled();
  } finally {
    await runtime.stopVoice(scope.session_id);
    await http.close();
  }
});
it("customer help fences via MCP before waiting for the voice tool drain", async () => {
  vi.useRealTimers();
  await connect();
  const drain = deferred();
  mock.nova.drain.mockReturnValueOnce(drain.promise);
  mock.client.call.mockImplementationOnce(async () => {
    expect(mock.nova.close).not.toHaveBeenCalled();
    return { summary: "Staff requested." };
  });
  mock.getView.mockResolvedValue({
    session: { id: "voice-unit", fence: 3, needs_staff_review: true },
  });
  const http = await postAction("/api/lane/tool", {
    name: "request_staff_help",
    arguments: { reason: "assistance" },
  });
  try {
    await vi.waitFor(() => expect(mock.nova.drain).toHaveBeenCalledOnce());
    expect(mock.client.call).toHaveBeenCalledWith("request_staff_help", {
      reason: "assistance",
    });
    drain.resolve();
    expect((await http.response).status).toBe(200);
    expect(mock.voiceLease).toHaveBeenLastCalledWith(
      "voice-unit",
      null,
      expect.any(String),
    );
  } finally {
    drain.resolve();
    await http.close();
  }
});
it("customer reset waits for voice tools and lease cleanup before checking the original proposal", async () => {
  vi.useRealTimers();
  await connect();
  const drain = deferred();
  mock.nova.drain.mockReturnValueOnce(drain.promise);
  mock.tool.mockImplementation(async (scope, name, args) => {
    expect(mock.voiceLease).toHaveBeenLastCalledWith(
      "voice-unit",
      null,
      expect.any(String),
    );
    return { scope, name, args, reset: true };
  });
  const { app } = await import("../../apps/runtime/src/app.js");
  const http = createServer(app);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    const port = (http.address() as { port: number }).port;
    const proposal = {
      expected_version: 3,
      reset_token: "server-token-".repeat(6),
    };
    const response = new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/lane/reset",
            method: "POST",
            headers: {
              host: "localhost:3199",
              origin: "http://localhost:3198",
              "content-type": "application/json",
            },
          },
          (reply) => {
            let body = "";
            reply.setEncoding("utf8");
            reply.on("data", (part: string) => {
              body += part;
            });
            reply.on("end", () => resolve({ status: reply.statusCode!, body }));
          },
        );
        request.on("error", reject);
        request.end(JSON.stringify(proposal));
      },
    );
    await vi.waitFor(() => expect(mock.nova.drain).toHaveBeenCalledOnce());
    expect(mock.tool).not.toHaveBeenCalled();
    drain.resolve();
    const result = await response;
    expect(result.status).toBe(200);
    expect(mock.tool).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ session_id: "voice-unit", actor: "customer" }),
      "cancel_draft_order",
      proposal,
    );
  } finally {
    drain.resolve();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
