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
  /** Server-only sealed-recording gate; this never invokes MCP or approves. */
  retainSubmission?: (
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  onSubmissionPendingSent?: () => void;
  /** Server-only observations from the provider decoder, never browser proof. */
  onProviderEvidence?: (e: ProviderVoiceEvidence) => void;
  transformToolResult?: (
    name: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};
export type ProviderVoiceEvidence = {
  name: string;
  at: number;
  generation: number;
  contentId?: string;
  completionId?: string;
  role?: string;
  contentType?: string;
  final?: boolean;
  stopReason?: string;
  text?: string;
  audioBytes?: number;
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
// JSON object order is not part of a request's business identity. Preserve array
// order (commands can be order-dependent), and forward the same canonical form.
function stableArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableArguments);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, stableArguments(object[key])]),
    );
  }
  return value;
}
const gatewayRequestTools = new Set([
  "apply_cart_changes",
  "prepare_order_review",
]);
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
  private inputFinished = false;
  private sessionFinished = false;
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
      contentType?: string;
      completionId?: string;
      tool?: { name: string; id: string; args: string };
    }
  >();
  private tasks: Promise<void> = Promise.resolve();
  private lastFinalInput = 0;
  private pending = 0;
  private toolCalls = 0;
  private generatedRequestIds = new Map<string, string>();
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
        // The customer board owns approval and submission after voice stops.
        // Do not expose an action that a spoken "yes" cannot authorize.
        tools: this.mcp.tools
          .filter(
            (t) => t.name !== "submit_order" || !!this.options.retainSubmission,
          )
          .map((t) => {
            const inputSchema = structuredClone(t.inputSchema);
            if (gatewayRequestTools.has(t.name)) {
              if (inputSchema.properties)
                delete inputSchema.properties.request_id;
              if (inputSchema.required)
                inputSchema.required = inputSchema.required.filter(
                  (name) => name !== "request_id",
                );
            }
            return {
              toolSpec: {
                name: t.name,
                description:
                  (t.description ?? "") +
                  (gatewayRequestTools.has(t.name)
                    ? " The voice gateway supplies request_id; omit that transport field."
                    : ""),
                inputSchema: { json: JSON.stringify(inputSchema) },
              },
            };
          }),
      },
    });
    this.text(
      "SYSTEM",
      menuPriceGuidance +
        "\n" +
        "When asked to make the current order cheaper or find meal savings, use find_meal_savings. Describe only its exact equivalent grouping and savings. This read does not edit the cart. The customer must stop voice and select Apply meal savings on the board; do not apply that proposal yourself through apply_cart_changes. Never add food or alter a size/modification to manufacture savings. For undo requests, direct the customer to stop voice and use Undo last change; do not reconstruct earlier cart state yourself.\n" +
        "For an existing item's size, choice or quantity correction, use a type:update command with its existing line_id; do not remove and re-add that item. For a read-tool error with next_action=correct_arguments, inspect the menu/schema and submit corrected complete arguments; do not refuse a supported menu inquiry merely because an earlier argument was incomplete.\n" +
        "Distinguish an explicit cart edit from a hypothetical price question. When the customer unambiguously requests adding, removing or changing an item, perform that edit with apply_cart_changes at the current cart version, then briefly acknowledge only the changed items and their confirmed quantities, sizes and modifiers from the successful tool result. Do not announce totals after routine edits; use canonical tool prices/totals only when asked, needed to resolve a price question, or reviewing the order. Do not replace a requested edit with a price comparison or ask again whether to perform that same edit. Ask only when the target or required choice is ambiguous. Use compare_menu_prices for informational inquiries that do not request a cart edit. Prepare an order review only when the customer asks to review or finalize, not automatically after each edit.\n" +
        `You are SayGo, a concise AI order taker at fictional Harbor Burger. This is an independent Alexa+ concept simulator, not Alexa. Disclose AI speech once. Always get_menu and get_cart before ordering. Ground items, prices, availability and acceptance ONLY in tools. Ask one necessary question. When a category matches several menu items, ask which item before adding; never pick a default. Offer at most three relevant choices. Use exact stable line IDs and cart versions; customized copies stay separate. Never guess what 'one' or 'that' refers to. Use apply_cart_changes clarification for ambiguity. Do not invent notes, modifiers, promotions, preparation times, prices or safety guarantees. On allergy concerns call request_staff_help immediately. ${this.options.retainSubmission ? "At finalization call prepare_order_review and read required_spoken_readback exactly. The customer may then explicitly record and finish spoken approval using the board. Only after actual customer speech saying Yes, place the order may you request submit_order with that exact quote_id. The server independently verifies the complete sealed audio and may defer this request. PENDING_VERIFICATION means NO order has been submitted; do not claim success or repeat the request. Never infer consent from your own words, typed input, a review request or an earlier customer turn." : "Never approve or submit an order yourself: prepare_order_review then direct the customer to stop voice and use the Confirm order button. The board handles approval and submission; never call submit_order, even after a spoken yes, confirm or finalize request. Voice yes is not consent in this simulator."} The voice gateway supplies transport request IDs for cart edits and reviews; do not invent those IDs. Never supply reset_token; reset confirmation is touch-only. A successful cancel_draft_order call only PROPOSES a reset: the draft is unchanged until the customer touches Confirm reset. Never say it is cancelled, cleared or reset at that stage. Say: Your draft is unchanged. Please stop voice and select Confirm reset on the screen to clear it. Submitted/unknown is not accepted. Payment is due at the window, never collect card details. Accepted changes go to staff. On version conflict re-read canonical cart and reconcile; do not replay blindly. A barge-in stops speech, not committed changes. No unsolicited upselling, optional suggestions or additions. Answer requested menu questions directly. Do not read full cart after every change. At review use the server quote, do not claim your spoken summary constitutes approval. The gateway retains request identity for identical review retries. Expired or changed quotes require a new review and customer approval; after STALE_QUOTE, re-read the cart and request a fresh review. Follow structured error.next_action; retryable=false never authorizes blindly replaying a write. Wait for staff on FENCED and never try to bypass ownership.` +
        "\n" +
        `Spoken delivery: Keep routine acknowledgments to one short, natural sentence about the change just confirmed by tools, then let the customer speak. Do not repeat unchanged items, full-cart summaries, totals, AI disclosures, payment details or confirmation instructions after each edit. Skip filler, praise, explanations of your tool use and repeated Anything else questions. Ask only one clarification question at a time when an item, quantity or required choice is ambiguous. After a successful change to a medium lemonade with no ice, for example, say: Medium lemonade, no ice. Use that example only if the actual tool result matches; never infer success from the customer's request. ${this.options.retainSubmission ? "If the customer asks to finish, prepare_order_review and read required_spoken_readback exactly, including every modifier and total. Do not shorten or paraphrase that required readback. Then wait for the customer to record spoken approval; never claim the readback itself is consent." : "If the customer asks to finish, prepare_order_review and briefly say: Stop voice and tap Confirm order on the screen. Do not request spoken approval."} Concision never overrides truthful errors, unresolved ambiguity, allergy/staff escalation or customer consent. If a tool fails, briefly state the failure and the necessary next step; never imply the change succeeded. Give enough detail to resolve those cases or answer an explicitly requested review, without a rigid word limit.`,
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
    if (this.inputFinished) throw new Error("Audio input is sealed");
    if (bytes.length > 4096 || bytes.length % 2)
      throw new Error("Invalid PCM frame");
    this.send("audioInput", {
      promptName: this.prompt,
      contentName: this.audioName,
      content: bytes.toString("base64"),
    });
  }
  userText(text: string) {
    if (this.inputFinished) throw new Error("Audio input is sealed");
    this.text("USER", text.slice(0, 500), true);
  }
  interrupt() {
    const generation = this.gen.interrupt();
    this.emit({ type: "interrupt", generation });
    return generation;
  }
  // Complete tool blocks only. Provisional transcripts never drive business state.
  handle(name: string, e: Record<string, unknown>) {
    const contentId = string(e.contentId),
      completion = string(e.completionId);
    const previousBlock = this.blocks.get(contentId);
    let observedFinal = previousBlock?.final;
    if (name === "contentStart") {
      try {
        observedFinal =
          JSON.parse(string(e.additionalModelFields) || "{}")
            .generationStage === "FINAL";
      } catch {
        observedFinal = false;
      }
    }
    this.options.onProviderEvidence?.({
      name,
      at: Date.now(),
      generation: this.gen.generation,
      contentId: contentId || undefined,
      completionId: completion || previousBlock?.completionId,
      role: string(e.role) || previousBlock?.role,
      contentType: string(e.type) || previousBlock?.contentType,
      final: observedFinal,
      stopReason: string(e.stopReason) || undefined,
      ...(name === "textOutput" ? { text: string(e.content) } : {}),
      ...(name === "audioOutput"
        ? { audioBytes: Buffer.from(string(e.content), "base64").length }
        : {}),
    });
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
        contentType: string(e.type),
        completionId: completion,
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
            let generatedKey: string | undefined;
            let retained = false;
            try {
              args = z
                .record(z.string(), z.unknown())
                .parse(JSON.parse(request.args));
              if (
                request.name === "submit_order" &&
                !this.options.retainSubmission
              )
                throw new McpCallError(
                  recoveryFor(
                    "VOICE_PENDING",
                    "Stop voice and use the Confirm order button. Spoken confirmation cannot approve or submit an order.",
                  ),
                );
              if (request.name === "cancel_draft_order" && args.reset_token)
                throw new Error("Reset requires customer action");
              if (gatewayRequestTools.has(request.name)) {
                // The gateway owns transport UUIDs. Model-provided IDs never
                // distinguish an identical retry from the same business call.
                const business = { ...args };
                delete business.request_id;
                const normalized = stableArguments(business) as Record<
                  string,
                  unknown
                >;
                generatedKey = JSON.stringify([request.name, normalized]);
                const id =
                  this.generatedRequestIds.get(generatedKey) ?? randomUUID();
                this.generatedRequestIds.set(generatedKey, id);
                args = { ...normalized, request_id: id };
              }
              retained =
                request.name === "submit_order" &&
                !!this.options.retainSubmission;
              result = retained
                ? await this.options.retainSubmission!(args)
                : await this.mcp.call(request.name, args);
              if (!retained && this.options.transformToolResult)
                result = await this.options.transformToolResult(
                  request.name,
                  args,
                  result,
                );
              if (!retained) this.emit({ type: "cart_changed" });
            } catch (e) {
              if (
                generatedKey &&
                request.name === "prepare_order_review" &&
                e instanceof McpCallError &&
                e.recovery.code === "STALE_QUOTE"
              )
                this.generatedRequestIds.delete(generatedKey);
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
            // Retained requests have not crossed MCP and are not tool-call evidence.
            if (!retained) this.options.onTool?.(request.name, args, result);
            const providerResult = { ...result };
            if (
              request.name === "cancel_draft_order" &&
              !result.error &&
              typeof result.reset_token === "string"
            ) {
              // The opaque token goes only to the customer's scoped dialog.
              // A successful proposal is not a completed cancellation.
              delete providerResult.reset_token;
              providerResult.reset_status = "awaiting_customer_confirmation";
              providerResult.summary =
                "The draft is unchanged and has NOT been cancelled or cleared. A confirmation dialog is open on the customer board. Ask the customer to stop voice and select Confirm reset on the screen to clear the draft.";
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
              content: JSON.stringify(providerResult),
            });
            this.send("contentEnd", { promptName: this.prompt, contentName });
            if (retained) this.options.onSubmissionPendingSent?.();
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
  /** Seal only the application-defined audio recording. Keep tool responses open. */
  finishInput() {
    if (this.closed || this.inputFinished) return;
    this.send("contentEnd", {
      promptName: this.prompt,
      contentName: this.audioName,
    });
    this.inputFinished = true;
  }
  /** Called only after a pending tool response or response completion is drained. */
  finishSession() {
    if (this.closed || this.sessionFinished) return;
    this.finishInput();
    this.send("promptEnd", { promptName: this.prompt });
    this.send("sessionEnd", {});
    this.sessionFinished = true;
    this.queue.close();
  }
  close() {
    if (this.closed) return;
    try {
      this.finishSession();
    } catch {
      // Backpressure may be why we are stopping. A full queue cannot accept
      // graceful teardown; abort it instead of throwing from socket callbacks.
      this.controller.abort();
      this.client.destroy();
    } finally {
      this.closed = true;
      this.queue.close();
      this.abortTimer = setTimeout(() => {
        this.controller.abort();
        this.client.destroy();
      }, 2000);
      this.blocks.clear();
      this.generatedRequestIds.clear();
    }
  }
}
