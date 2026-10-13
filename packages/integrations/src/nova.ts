import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
  type InvokeModelWithBidirectionalStreamInput,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { randomUUID } from "node:crypto";
import { McpCallError } from "./mcp-client.js";
import { recoveryFor } from "@saygo/contracts";
import { config } from "@saygo/db";
import { z } from "zod";
import { AudioGeneration, BoundedQueue } from "./audio-state.js";
import type { openMcp } from "./mcp-client.js";
import { menuPriceGuidance } from "./menu-guidance.js";
export type VoiceEvent = {
  type: string;
  generation?: number;
  audio?: string;
  text?: string;
  final?: boolean;
  role?: string;
  pending?: boolean;
  ms?: number;
};
const eventSchema = z.object({
  event: z.record(z.string(), z.record(z.string(), z.unknown())),
});
const string = (v: unknown) => (typeof v === "string" ? v : "");
export class NovaSession {
  private queue = new BoundedQueue<InvokeModelWithBidirectionalStreamInput>(
    120,
  );
  private client = new BedrockRuntimeClient({
    region: config.AWS_REGION,
    requestHandler: new NodeHttp2Handler({
      requestTimeout: 470000,
      sessionTimeout: 470000,
    }),
    maxAttempts: 1,
  });
  private controller = new AbortController();
  private closed = false;
  private prompt = randomUUID();
  private audioName = randomUUID();
  private gen = new AudioGeneration();
  private blocks = new Map<
    string,
    {
      role: string;
      final: boolean;
      text: string;
      tool?: { name: string; id: string; args: string };
    }
  >();
  private tasks: Promise<void> = Promise.resolve();
  private lastFinalInput = 0;
  private pending = 0;
  constructor(
    private mcp: Pick<Awaited<ReturnType<typeof openMcp>>, "tools" | "call">,
    private emit: (e: VoiceEvent) => void,
  ) {}
  private send(name: string, data: object) {
    if (!this.closed)
      this.queue.push({
        chunk: {
          bytes: Buffer.from(JSON.stringify({ event: { [name]: data } })),
        },
      });
  }
  private text(role: string, content: string, interactive = false) {
    const contentName = randomUUID();
    this.send("contentStart", {
      promptName: this.prompt,
      contentName,
      type: "TEXT",
      interactive,
      role,
      textInputConfiguration: { mediaType: "text/plain" },
    });
    this.send("textInput", { promptName: this.prompt, contentName, content });
    this.send("contentEnd", { promptName: this.prompt, contentName });
  }
  async start() {
    this.send("sessionStart", {
      inferenceConfiguration: { maxTokens: 2048, topP: 0.9, temperature: 0.2 },
      turnDetectionConfiguration: { endpointingSensitivity: "MEDIUM" },
    });
    this.send("promptStart", {
      promptName: this.prompt,
      textOutputConfiguration: { mediaType: "text/plain" },
      audioOutputConfiguration: {
        mediaType: "audio/lpcm",
        sampleRateHertz: 24000,
        sampleSizeBits: 16,
        channelCount: 1,
        voiceId: "tiffany",
        encoding: "base64",
        audioType: "SPEECH",
      },
      toolUseOutputConfiguration: { mediaType: "application/json" },
      toolConfiguration: {
        tools: this.mcp.tools.map((t) => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: JSON.stringify(t.inputSchema) },
          },
        })),
      },
    });
    this.text(
      "SYSTEM",
      menuPriceGuidance +
        "\n" +
        `You are SayGo, a concise AI order taker at fictional Harbor Burger. This is an independent Alexa+ concept simulator, not Alexa. Disclose AI speech once. Always get_menu and get_cart before ordering. Ground items, prices, availability and acceptance ONLY in tools. Ask one necessary question. Use exact stable line IDs and cart versions; customized copies stay separate. Never guess what 'one' or 'that' refers to. Use apply_cart_changes clarification for ambiguity. Do not invent notes, modifiers, promotions, preparation times, prices or safety guarantees. On allergy concerns call request_staff_help immediately. Never approve an order yourself: prepare_order_review then direct the customer to the Confirm order button; voice yes is not consent in this simulator. Never supply reset_token; reset confirmation is touch-only. Submitted/unknown is not accepted. Payment is due at the window, never collect card details. Accepted changes go to staff. On version conflict re-read canonical cart and reconcile; do not replay blindly. A barge-in stops speech, not committed changes. No upselling unless explicitly enabled in menu, then at most one optional question, never add without request. Do not read full cart after every change. At review use the server quote, do not claim your spoken summary constitutes approval. Use a request_id UUID for each review; reuse it only for identical retries. Expired or changed quotes require a new review and customer approval. Follow structured error.next_action; retryable=false never authorizes blindly replaying a write. Wait for staff on FENCED and never try to bypass ownership.`,
    );
    this.send("contentStart", {
      promptName: this.prompt,
      contentName: this.audioName,
      type: "AUDIO",
      interactive: true,
      role: "USER",
      audioInputConfiguration: {
        mediaType: "audio/lpcm",
        sampleRateHertz: 16000,
        sampleSizeBits: 16,
        channelCount: 1,
        audioType: "SPEECH",
        encoding: "base64",
      },
    });
    const response = await this.client.send(
      new InvokeModelWithBidirectionalStreamCommand({
        modelId: config.SAYGO_VOICE_MODEL,
        body: this.queue,
      }),
      { abortSignal: this.controller.signal },
    );
    this.emit({ type: "ready" });
    for await (const chunk of response.body ?? []) {
      if (this.closed) break;
      if (!chunk.chunk?.bytes) throw new Error("Live provider stream failed");
      const envelope = eventSchema.parse(
        JSON.parse(Buffer.from(chunk.chunk.bytes).toString()),
      );
      for (const [name, event] of Object.entries(envelope.event))
        this.handle(name, event);
    }
  }
  audio(bytes: Buffer) {
    if (bytes.length > 4096 || bytes.length % 2)
      throw new Error("Invalid PCM frame");
    this.send("audioInput", {
      promptName: this.prompt,
      contentName: this.audioName,
      content: bytes.toString("base64"),
    });
  }
  userText(text: string) {
    this.text("USER", text.slice(0, 500), true);
  }
  interrupt() {
    this.emit({ type: "interrupt", generation: this.gen.interrupt() });
  }
  // Complete tool blocks only. Provisional transcripts never drive business state.
  handle(name: string, e: Record<string, unknown>) {
    const contentId = string(e.contentId),
      completion = string(e.completionId);
    if (name === "completionStart") this.gen.start(completion);
    if (name === "contentStart") {
      if (this.blocks.size > 100)
        throw new Error("Too many pending provider blocks");
      let stage = "";
      try {
        stage = JSON.parse(
          string(e.additionalModelFields) || "{}",
        ).generationStage;
      } catch {
        /* non-final remains provisional */
      }
      this.blocks.set(contentId, {
        role: string(e.role),
        final: stage === "FINAL",
        text: "",
      });
    }
    if (name === "textOutput") {
      const text = string(e.content);
      if (text.includes('"interrupted"') && text.includes("true")) {
        this.interrupt();
        return;
      }
      const block = this.blocks.get(contentId);
      if (block) {
        block.text += text;
        if (block.text.length > 16000) throw new Error("Provider text limit");
      }
    }
    if (name === "audioOutput" && this.gen.accepts(completion)) {
      this.emit({
        type: "audio",
        generation: this.gen.generation,
        audio: string(e.content),
      });
      if (this.lastFinalInput) {
        this.emit({ type: "timing", ms: Date.now() - this.lastFinalInput });
        this.lastFinalInput = 0;
      }
    }
    if (name === "toolUse") {
      const b = this.blocks.get(contentId) ?? {
        role: "TOOL",
        final: true,
        text: "",
      };
      b.tool = {
        name: string(e.toolName),
        id: string(e.toolUseId),
        args: (b.tool?.args ?? "") + string(e.content),
      };
      if (b.tool.args.length > 32768) throw new Error("Tool arguments limit");
      this.blocks.set(contentId, b);
    }
    if (name === "contentEnd") {
      if (e.stopReason === "INTERRUPTED") this.interrupt();
      const block = this.blocks.get(contentId);
      this.blocks.delete(contentId);
      if (!block) return;
      if (block.role === "USER" && block.final)
        this.lastFinalInput = Date.now();
      if (block.text && this.gen.accepts(completion))
        this.emit({
          type: "caption",
          text: block.text,
          role: block.role,
          final: block.final,
        });
      if (block.tool && e.stopReason === "TOOL_USE") {
        const request = block.tool;
        if (++this.pending > 8) throw new Error("Too many queued tool calls");
        this.emit({ type: "pending", pending: true });
        this.tasks = this.tasks
          .then(async () => {
            if (this.closed) return;
            let result: Record<string, unknown>;
            try {
              const args = z
                .record(z.string(), z.unknown())
                .parse(JSON.parse(request.args));
              if (request.name === "cancel_draft_order" && args.reset_token)
                throw new Error("Reset requires customer action");
              result = await this.mcp.call(request.name, args);
              this.emit({ type: "cart_changed" });
            } catch (e) {
              result = {
                error:
                  e instanceof McpCallError
                    ? e.recovery
                    : recoveryFor(
                        "INVALID_ARGUMENTS",
                        "Check the tool schema. Reset confirmation requires customer action.",
                      ),
              };
            }
            const contentName = randomUUID();
            this.send("contentStart", {
              promptName: this.prompt,
              contentName,
              type: "TOOL",
              role: "TOOL",
              interactive: false,
              toolResultInputConfiguration: {
                toolUseId: request.id,
                type: "TEXT",
                textInputConfiguration: { mediaType: "text/plain" },
              },
            });
            this.send("toolResult", {
              promptName: this.prompt,
              contentName,
              content: JSON.stringify(result),
            });
            this.send("contentEnd", { promptName: this.prompt, contentName });
          })
          .finally(() => {
            this.pending--;
            this.emit({ type: "pending", pending: this.pending > 0 });
          })
          .catch(() => {
            this.emit({
              type: "error",
              text: "Voice tool processing stopped. Refresh the order board.",
            });
            this.close();
          });
      }
    }
  }
  drain() {
    return this.tasks;
  }
  close() {
    if (this.closed) return;
    try {
      this.send("contentEnd", {
        promptName: this.prompt,
        contentName: this.audioName,
      });
      this.send("promptEnd", { promptName: this.prompt });
      this.send("sessionEnd", {});
    } finally {
      this.closed = true;
      this.queue.close();
      setTimeout(() => {
        this.controller.abort();
        this.client.destroy();
      }, 200);
      this.blocks.clear();
    }
  }
}
