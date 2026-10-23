import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { WebSocket } from "ws";
import type { Scope } from "@saygo/contracts";
import { config, RESTAURANT, store, transaction } from "@saygo/db";
import { beginInteraction, getView, resetDemo, tool } from "@saygo/domain";
import { runOneJob, SandboxPos } from "@saygo/integrations";
import { BoundedQueue } from "../../packages/integrations/src/audio-state.js";
import { seedProducts } from "../../packages/db/src/menu.js";
import { app } from "../../apps/runtime/src/app.js";
import { attachVoice, stopVoice } from "../../apps/runtime/src/voice.js";
import { customerMcpLog } from "../../apps/runtime/src/customer-mcp-log.js";

// Only the external Bedrock transport is substituted. Authentication, WebSocket
// input, Nova decoding, runtime consent, HTTP MCP, transactions and POS job are real.
// The client playback acknowledgement is synthetic and proves no physical audio.
const server = createServer(app);
const previousVoiceEnabled = config.SAYGO_VOICE_ENABLED;
let scope: Scope, token: string, socket: WebSocket | undefined;
let voiceServer: ReturnType<typeof attachVoice>;
let providerEndedAt = 0;
const calls: { name: string; at: number }[] = [];
const frames: Record<string, unknown>[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => unknown | Promise<unknown>, label: string) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await check()) return;
    await sleep(10);
  }
  throw Error(
    `${label}: ${JSON.stringify(frames.map((event) => ({ ...event, audio: undefined })))}`,
  );
}
beforeAll(async () => {
  expect(config.DYNAMODB_NAMESPACE).toBe("saygo_test");
  expect(new URL(config.DYNAMODB_ENDPOINT).hostname).toMatch(
    /^(127\.0\.0\.1|localhost)$/,
  );
  config.SAYGO_VOICE_ENABLED = "true";
  voiceServer = attachVoice(server, {
    maximumSessionMs: 15000,
    onEvent: (event) => frames.push(event),
    onTool: (name) => calls.push({ name, at: Date.now() }),
    onStreamEnd: (natural) => {
      if (natural) providerEndedAt = Date.now();
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.SAYGO_RUNTIME_PORT, "127.0.0.1", resolve);
  });
});
beforeEach(async () => {
  await resetDemo();
  await transaction(async (tx) => {
    for (const data of seedProducts)
      await tx.update("products", data.id, { data });
    await tx.update("restaurants", RESTAURANT, {
      pos_mode: "accept",
      menu_version: 1,
      price_version: 1,
    });
  });
  const customer = await beginInteraction("lane-1");
  scope = { ...customer.scope, actor: "agent" };
  token = customer.token;
  await tool(scope, "apply_cart_changes", {
    expected_version: 0,
    request_id: randomUUID(),
    commands: [
      { type: "add", product_id: "classic", choices: { remove: ["onions"] } },
      {
        type: "add",
        product_id: "lemonade",
        variant: "medium",
        choices: { ice: ["none"] },
      },
    ],
  });
  calls.length = 0;
  frames.length = 0;
  providerEndedAt = 0;
});
afterEach(async () => {
  try {
    if (scope) await stopVoice(scope.session_id);
  } finally {
    socket?.terminate();
    socket = undefined;
    vi.restoreAllMocks();
  }
});
afterAll(async () => {
  for (const client of voiceServer.clients) client.terminate();
  voiceServer.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  config.SAYGO_VOICE_ENABLED = previousVoiceEnabled;
  await store.close();
});

function installProvider(
  mode: "valid" | "bound negative" | "unbound negative" | "interrupted review",
) {
  const output = new BoundedQueue<{ chunk: { bytes: Uint8Array } }>(120);
  let receivedAudio = false,
    retainedPending = false,
    gracefulEnd = false,
    quoteId = "",
    audioFrames = 0,
    ordinaryReadCompleted = false;
  let driverFailure: unknown;
  const providerInput: Record<string, Record<string, unknown>>[] = [];
  const providerEvidence: { name: string; completionId: string }[] = [];
  // Match the live archive: one completion spans all USER/ASSISTANT/tool
  // contents, and completionEnd occurs only when the stream closes.
  const completionId = "persistent-conversation-completion";
  const emit = (name: string, value: Record<string, unknown>) => {
    providerEvidence.push({ name, completionId });
    output.push({
      chunk: {
        bytes: Buffer.from(
          JSON.stringify({
            event: {
              [name]: { completionId, ...value },
            },
          }),
        ),
      },
    });
  };
  const text = (id: string, role: string, value: string) => {
    emit("contentStart", {
      contentId: id,
      role,
      type: "TEXT",
      additionalModelFields: '{"generationStage":"FINAL"}',
    });
    emit("textOutput", { contentId: id, content: value });
    emit("contentEnd", {
      contentId: id,
      stopReason: role === "USER" ? "PARTIAL_TURN" : "END_TURN",
    });
  };
  const modelTool = (
    id: string,
    name: string,
    args: Record<string, unknown>,
  ) => {
    emit("contentStart", { contentId: id, role: "TOOL", type: "TOOL" });
    emit("toolUse", {
      contentId: id,
      toolUseId: id,
      toolName: name,
      content: JSON.stringify(args),
    });
    emit("contentEnd", { contentId: id, stopReason: "TOOL_USE" });
  };
  const driver = async (
    input: NonNullable<
      InvokeModelWithBidirectionalStreamCommand["input"]["body"]
    >,
  ) => {
    for await (const item of input) {
      if (!item.chunk?.bytes) continue;
      const envelope = JSON.parse(Buffer.from(item.chunk.bytes).toString()) as {
        event: Record<string, Record<string, unknown>>;
      };
      providerInput.push(envelope.event);
      if (envelope.event.promptStart) {
        emit("completionStart", {});
        modelTool("review-tool", "prepare_order_review", {
          expected_version: 1,
        });
      }
      if (envelope.event.toolResult) {
        const result = JSON.parse(
          String(envelope.event.toolResult.content),
        ) as Record<string, unknown>;
        if (typeof result.required_spoken_readback === "string") {
          quoteId = (result.quote as { id: string }).id;
          if (mode === "interrupted review") {
            emit("contentStart", {
              contentId: "readback-text",
              role: "ASSISTANT",
              type: "TEXT",
              additionalModelFields: '{"generationStage":"FINAL"}',
            });
            emit("textOutput", {
              contentId: "readback-text",
              content: result.required_spoken_readback.slice(0, 20),
            });
          } else
            text("readback-text", "ASSISTANT", result.required_spoken_readback);
          emit("contentStart", {
            contentId: "readback-audio",
            role: "ASSISTANT",
            type: "AUDIO",
          });
          emit("audioOutput", {
            contentId: "readback-audio",
            content: Buffer.alloc(4800).toString("base64"),
          });
          if (mode !== "interrupted review")
            emit("contentEnd", {
              contentId: "readback-audio",
              stopReason: "END_TURN",
            });
        } else if (result.code === "PENDING_VERIFICATION") {
          retainedPending = true;
        } else if (result.product) ordinaryReadCompleted = true;
      }
      if (envelope.event.audioInput) {
        audioFrames++;
        if (!receivedAudio) {
          receivedAudio = true;
          if (mode === "interrupted review") {
            text("ordinary-user", "USER", "What comes on the classic burger?");
            modelTool("ordinary-read", "get_item_details", {
              product_id: "classic",
            });
          } else {
            text("approval-user", "USER", "Yes, place my order.");
            modelTool("deferred-submit", "submit_order", { quote_id: quoteId });
          }
        }
      }
      if (envelope.event.sessionEnd) {
        gracefulEnd = true;
        // This fragment arrives after the earlier positive ASR and Pending tool
        // result, during drain. It must still defeat approval before natural EOF.
        if (mode === "bound negative")
          text("late-negative", "USER", "Actually no, do not place my order.");
        if (mode === "unbound negative")
          // Without contentStart, the real Nova decoder cannot infer a role.
          // This must still defeat approval rather than silently dropping text.
          emit("textOutput", {
            contentId: "unbound-late-negative",
            content: "Actually no, do not place my order.",
          });
        emit("completionEnd", { stopReason: "END_TURN" });
        output.close();
      }
    }
  };
  vi.spyOn(BedrockRuntimeClient.prototype, "send").mockImplementation(
    (command) => {
      expect(command).toBeInstanceOf(InvokeModelWithBidirectionalStreamCommand);
      const input = (command as InvokeModelWithBidirectionalStreamCommand).input
        .body;
      if (!input) throw Error("MISSING_BEDROCK_INPUT");
      void driver(input).catch((error) => {
        driverFailure = error;
        output.close();
      });
      return Promise.resolve({ $metadata: {}, body: output }) as never;
    },
  );
  return {
    pending: () => retainedPending,
    ended: () => gracefulEnd,
    failure: () => driverFailure,
    inputs: providerInput,
    evidence: providerEvidence,
    audioFrames: () => audioFrames,
    ordinaryReadCompleted: () => ordinaryReadCompleted,
  };
}

async function connectAndCapture() {
  socket = new WebSocket(`ws://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/voice`, {
    origin: config.SAYGO_WEB_ORIGIN,
    headers: { Cookie: `saygo_lane=${token}` },
  });
  await once(socket, "open");
  await until(
    () => frames.some((e) => e.type === "confirmation_readback_complete"),
    "EXACT_READBACK_NOT_VERIFIED",
  );
  const binding = frames.find(
    (e) => e.type === "confirmation_readback_complete",
  )!;
  await sleep(120);
  socket.send(
    JSON.stringify({
      type: "readback_played",
      readback_id: binding.readback_id,
      readback_hash: binding.readback_hash,
      generation: binding.generation,
    }),
  );
  await until(
    () => frames.some((e) => e.type === "confirmation_ready"),
    "READBACK_NOT_ARMED",
  );
  socket.send(
    JSON.stringify({
      type: "confirmation_capture_start",
      readback_id: binding.readback_id,
      readback_hash: binding.readback_hash,
      generation: binding.generation,
    }),
  );
  await until(
    () => frames.some((e) => e.type === "confirmation_capture_started"),
    "CAPTURE_NOT_ACKNOWLEDGED",
  );
  const captureId = frames.find(
    (e) => e.type === "confirmation_capture_started",
  )!.capture_id;
  const pcm = Buffer.alloc(640);
  for (let sample = 0; sample < pcm.length; sample += 2)
    pcm.writeInt16LE(1000, sample);
  for (let frame = 0; frame < 10; frame++) {
    socket.send(pcm);
    await sleep(20);
  }
  return captureId;
}

describe("sealed voice approval across real WebSocket, HTTP MCP and DynamoDB", () => {
  it("continues ordinary voice audio and real MCP reads when fresh customer input interrupts an unsolicited readback", async () => {
    const provider = installProvider("interrupted review");
    socket = new WebSocket(
      `ws://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/voice`,
      {
        origin: config.SAYGO_WEB_ORIGIN,
        headers: { Cookie: `saygo_lane=${token}` },
      },
    );
    await once(socket, "open");
    await until(
      () => provider.evidence.some((event) => event.name === "audioOutput"),
      "UNSOLICITED_READBACK_NOT_STARTED",
    );
    expect(frames.some((event) => event.type === "confirmation_readback")).toBe(
      true,
    );
    expect(
      frames.some((event) => event.type === "confirmation_readback_complete"),
    ).toBe(false);
    for (let frame = 0; frame < 5; frame++) {
      socket.send(Buffer.alloc(640));
      await sleep(20);
    }
    await until(
      () => frames.some((event) => event.type === "confirmation_invalidated"),
      "ORDINARY_USER_DID_NOT_INVALIDATE_APPROVAL_WINDOW",
    );
    await until(provider.ordinaryReadCompleted, "ORDINARY_MCP_READ_BLOCKED");
    await until(() => provider.audioFrames() === 5, "ORDINARY_PCM_BLOCKED");
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(provider.failure()).toBeUndefined();
    expect(calls.map((call) => call.name)).toEqual([
      "prepare_order_review",
      "get_item_details",
    ]);
    expect((await getView(scope)).voice_confirmation).toBeNull();
    expect(await store.list("orders")).toHaveLength(0);
    expect(await store.list("approvals")).toHaveLength(0);
    expect(await store.list("jobs")).toHaveLength(0);
    expect(provider.pending()).toBe(false);
  });
  it("defers the model submit until natural EOF, records Voice approval, releases the lease and submits exactly once", async () => {
    const provider = installProvider("valid");
    const captureId = await connectAndCapture();
    await until(provider.pending, "MODEL_REQUEST_NOT_DEFERRED");
    expect(await store.list("orders")).toHaveLength(0);
    expect(await store.list("approvals")).toHaveLength(0);
    expect(customerMcpLog.read(scope).entries.map((e) => e.tool)).toEqual([
      "prepare_order_review",
    ]);
    socket!.send(
      JSON.stringify({
        type: "confirmation_capture_end",
        capture_id: captureId,
      }),
    );
    await until(
      () => frames.some((e) => e.type === "confirmation_committed"),
      "VOICE_SUBMISSION_DID_NOT_COMMIT",
    );
    await until(
      async () =>
        !(await store.get("interactions", scope.session_id))?.voice_until,
      "LEASE_NOT_RELEASED",
    );
    expect(provider.failure()).toBeUndefined();
    expect(provider.ended()).toBe(true);
    expect(
      provider.evidence.filter((event) => event.name === "completionStart"),
    ).toHaveLength(1);
    expect(
      provider.evidence.filter((event) => event.name === "completionEnd"),
    ).toHaveLength(1);
    expect(
      new Set(provider.evidence.map((event) => event.completionId)),
    ).toEqual(new Set(["persistent-conversation-completion"]));
    const approvals = await store.list("approvals"),
      orders = await store.list("orders");
    expect(orders).toHaveLength(1);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ source: "voice" });
    expect(Date.parse(approvals[0].created_at)).toBeGreaterThanOrEqual(
      providerEndedAt,
    );
    expect(orders[0].snapshot.totals.total).toBe(972);
    expect(calls.filter((call) => call.name === "submit_order")).toHaveLength(
      1,
    );
    expect(
      calls.find((call) => call.name === "submit_order")!.at,
    ).toBeGreaterThanOrEqual(providerEndedAt);
    const log = customerMcpLog.read(scope).entries;
    expect(log.map((e) => [e.tool, e.source, e.status])).toEqual([
      ["prepare_order_review", "voice", "succeeded"],
      ["submit_order", "voice", "succeeded"],
    ]);
    await runOneJob(new SandboxPos());
    expect((await getView(scope)).order?.status).toBe("accepted");
    expect(await store.list("pos_receipts")).toHaveLength(1);
  });
  it.each(["bound negative", "unbound negative"] as const)(
    "rejects late %s ASR after Pending through the actual decoder and never approves or submits",
    async (mode) => {
      const provider = installProvider(mode);
      const captureId = await connectAndCapture();
      await until(provider.pending, "MODEL_REQUEST_NOT_DEFERRED");
      socket!.send(
        JSON.stringify({
          type: "confirmation_capture_end",
          capture_id: captureId,
        }),
      );
      await until(provider.ended, "INPUT_NOT_GRACEFULLY_ENDED");
      await until(
        () => frames.some((e) => e.type === "confirmation_invalidated"),
        "NEGATIVE_CAPTURE_NOT_REJECTED",
      );
      await stopVoice(scope.session_id);
      expect(provider.failure()).toBeUndefined();
      expect(await store.list("orders")).toHaveLength(0);
      expect(await store.list("approvals")).toHaveLength(0);
      expect(await store.list("jobs")).toHaveLength(0);
      expect(calls.some((call) => call.name === "submit_order")).toBe(false);
      expect(customerMcpLog.read(scope).entries.map((e) => e.tool)).toEqual([
        "prepare_order_review",
      ]);
    },
  );
});
