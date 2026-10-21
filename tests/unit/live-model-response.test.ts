import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { assertUsableModelResponse } from "../live-model-response.js";

describe("live model response diagnostics", () => {
  it.each(["end_turn", "tool_use"] as const)(
    "allows %s to follow the existing answer/tool path",
    (stopReason) => {
      expect(() => assertUsableModelResponse({ stopReason })).not.toThrow();
    },
  );

  it.each([
    ["max_tokens", "ProviderMaxTokens"],
    ["model_context_window_exceeded", "ProviderContextWindowExceeded"],
    ["content_filtered", "ProviderContentFiltered"],
    ["guardrail_intervened", "ProviderGuardrailIntervened"],
    ["malformed_model_output", "ProviderMalformedModelOutput"],
    ["malformed_tool_use", "ProviderMalformedToolUse"],
    ["stop_sequence", "ProviderStopSequence"],
  ] as const)(
    "classifies %s without accepting its partial answer",
    (stopReason, name) => {
      const response: ConverseCommandOutput = {
        $metadata: {},
        stopReason,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        metrics: { latencyMs: 1 },
        output: {
          message: { role: "assistant", content: [{ text: "partial" }] },
        },
      };
      expect(() => assertUsableModelResponse(response)).toThrow(
        expect.objectContaining({ name }),
      );
    },
  );

  it.each([undefined, "private-provider-detail", "constructor", "__proto__"])(
    "fails closed without reflecting unknown reason %s",
    (stopReason) => {
      const response = { stopReason } as Pick<
        ConverseCommandOutput,
        "stopReason"
      >;
      expect(() => assertUsableModelResponse(response)).toThrow(
        expect.objectContaining({
          name: "ProviderIncompleteResponse",
          message: "Provider stopped before completing its answer.",
        }),
      );
    },
  );
});
