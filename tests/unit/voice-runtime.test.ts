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
  const client = { close: vi.fn<() => Promise<void>>() };
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
      vi.fn<(sessionId: string, until: string | null) => Promise<void>>(),
    openMcp: vi.fn<() => Promise<typeof client>>(),
    onEnd: vi.fn(),
    onTool: vi.fn(),
    options: {} as VoiceSessionOptions,
    laneScope: vi.fn(),
    tool: vi.fn(),
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
  tool: mock.tool,
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
}));
vi.mock("../../packages/integrations/src/nova.js", () => ({
  NovaSession: class {
    constructor(_mcp: unknown, _emit: unknown, options: VoiceSessionOptions) {
      mock.options = options;
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
async function connect() {
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
  return mock.sockets.at(-1)!;
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
  mock.getView.mockResolvedValue({ session: { needs_staff_review: false } });
  mock.voiceLease.mockResolvedValue();
  mock.openMcp.mockResolvedValue(mock.client);
  mock.client.close.mockResolvedValue();
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
  expect(mock.voiceLease).toHaveBeenLastCalledWith("voice-unit", null);
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
  expect(mock.voiceLease).toHaveBeenLastCalledWith("voice-unit", null);
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
  expect(mock.voiceLease).toHaveBeenLastCalledWith("voice-unit", null);
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
  expect(mock.voiceLease).toHaveBeenLastCalledWith("voice-unit", null);
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
  expect(mock.voiceLease).toHaveBeenLastCalledWith("voice-unit", null);
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
it("customer reset waits for voice tools and lease cleanup before checking the original proposal", async () => {
  vi.useRealTimers();
  await connect();
  const drain = deferred();
  mock.nova.drain.mockReturnValueOnce(drain.promise);
  mock.tool.mockImplementation(async (scope, name, args) => {
    expect(mock.voiceLease).toHaveBeenLastCalledWith("voice-unit", null);
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
