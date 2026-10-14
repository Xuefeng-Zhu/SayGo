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
  usage?: {
    inputSpeech: number;
    inputText: number;
    outputSpeech: number;
    outputText: number;
  };
  completionId?: string;
};
export type VoiceSessionOptions = {
  onProviderRequest?: () => void;
  onStreamEnd?: (naturalEnd: boolean, failureCode?: string) => void;
  onTool?: (
    name: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>,
  ) => void;
  maximumToolCalls?: number;
};
const usageCounts = z.object({
  speechTokens: z.number().int().nonnegative(),
  textTokens: z.number().int().nonnegative(),
});
const usageSchema = z.object({
  details: z.object({
    total: z.object({ input: usageCounts, output: usageCounts }),
  }),
});
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
      generation: number;
      tool?: { name: string; id: string; args: string };
    }
  >();
  private tasks: Promise<void> = Promise.resolve();
  private lastFinalInput = 0;
  private pending = 0;
  private toolCalls = 0;
  private abortTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private mcp: Pick<Awaited<ReturnType<typeof openMcp>>, "tools" | "call">,
    private emit: (e: VoiceEvent) => void,
    private options: VoiceSessionOptions = {},
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
        "For an existing item's size, choice or quantity correction, use a type:update command with its existing line_id; do not remove and re-add that item. For a read-tool error with next_action=correct_arguments, inspect the menu/schema and submit corrected complete arguments; do not refuse a supported menu inquiry merely because an earlier argument was incomplete.\n" +
        "Distinguish an explicit cart edit from a hypothetical price question. When the customer unambiguously requests adding, removing or changing an item, perform that edit with apply_cart_changes at the current cart version, then report the new canonical cart totals. Do not replace a requested edit with a price comparison or ask again whether to perform that same edit. Ask only when the target or required choice is ambiguous. Use compare_menu_prices for informational inquiries that do not request a cart edit. Prepare an order review only when the customer asks to review or finalize, not automatically after each edit.\n" +
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
    let naturalEnd = false,
      failureCode: string | undefined;
    try {
      this.options.onProviderRequest?.();
      const response = await this.client.send(
        new InvokeModelWithBidirectionalStreamCommand({
          modelId: config.SAYGO_VOICE_MODEL,
          body: this.queue,
        }),
        { abortSignal: this.controller.signal },
      );
      this.emit({ type: "ready" });
      for await (const chunk of response.body ?? []) {
        if (!chunk.chunk?.bytes) {
          const code = Object.keys(chunk).find((key) =>
            /^(?:validation|modelStreamError|internalServer|throttling|modelTimeout|serviceUnavailable)Exception$/.test(
              key,
            ),
          );
          const error = new Error("Live provider stream failed");
          error.name = code ?? "ProviderStreamError";
          throw error;
        }
        const envelope = eventSchema.parse(
          JSON.parse(Buffer.from(chunk.chunk.bytes).toString()),
        );
        for (const [name, event] of Object.entries(envelope.event))
          if (!this.closed || name === "usageEvent" || name === "completionEnd")
            this.handle(name, event);
      }
      naturalEnd = true;
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      failureCode =
        /^(?:[A-Za-z]+Exception|ProviderStreamError|ZodError|SyntaxError|AbortError)$/.test(
          name,
        )
          ? name
          : "ProviderStreamError";
      if (!this.closed) throw error;
    } finally {
      clearTimeout(this.abortTimer);
      this.queue.close();
      this.client.destroy();
      this.options.onStreamEnd?.(naturalEnd, failureCode);
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
    if (name === "usageEvent") {
      const counts = usageSchema.parse(e).details.total;
      this.emit({
        type: "usage",
        usage: {
          inputSpeech: counts.input.speechTokens,
          inputText: counts.input.textTokens,
          outputSpeech: counts.output.speechTokens,
          outputText: counts.output.textTokens,
        },
      });
    }
    if (name === "completionEnd")
      this.emit({ type: "turn_complete", completionId: completion });
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
      // A new audio CONTENT resumes playback even when Sonic reuses the
      // completion ID. Interrupted old contents must remain suppressed.
      if (e.type === "AUDIO" && e.role === "ASSISTANT" && contentId)
        this.gen.start(contentId);
      this.blocks.set(contentId, {
        role: string(e.role),
        final: stage === "FINAL",
        text: "",
        generation: this.gen.generation,
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
    if (
      name === "audioOutput" &&
      this.gen.accepts(contentId || completion) &&
      (!contentId ||
        this.blocks.get(contentId)?.generation === this.gen.generation)
    ) {
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
        generation: this.gen.generation,
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
      const block = this.blocks.get(contentId);
      if (
        e.stopReason === "INTERRUPTED" &&
        (!block || block.generation === this.gen.generation)
      )
        this.interrupt();
      this.blocks.delete(contentId);
      if (!block) return;
      if (block.role === "USER" && block.final)
        this.lastFinalInput = Date.now();
      if (
        block.text &&
        (block.role === "USER" || block.generation === this.gen.generation)
      )
        this.emit({
          type: "caption",
          text: block.text,
          role: block.role,
          final: block.final,
        });
      if (block.tool && e.stopReason === "TOOL_USE") {
        const request = block.tool;
        if (++this.toolCalls > (this.options.maximumToolCalls ?? 80))
          throw new Error("Voice session tool-call limit reached");
        if (++this.pending > 8) throw new Error("Too many queued tool calls");
        this.emit({ type: "pending", pending: true });
        this.tasks = this.tasks
          .then(async () => {
            if (this.closed) return;
            let result: Record<string, unknown>;
            let args: Record<string, unknown> = {};
            try {
              args = z
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
            this.options.onTool?.(request.name, args, result);
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
      this.abortTimer = setTimeout(() => {
        this.controller.abort();
        this.client.destroy();
      }, 2000);
      this.blocks.clear();
    }
  }
}
