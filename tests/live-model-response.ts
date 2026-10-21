import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

export function assertUsableModelResponse(
  response: Pick<ConverseCommandOutput, "stopReason">,
) {
  if (response.stopReason === "end_turn" || response.stopReason === "tool_use")
    return;
  // Only fixed classifications may reach receipts; never copy provider text or
  // an unrecognized stop reason into the diagnostic.
  const names = {
    max_tokens: "ProviderMaxTokens",
    model_context_window_exceeded: "ProviderContextWindowExceeded",
    content_filtered: "ProviderContentFiltered",
    guardrail_intervened: "ProviderGuardrailIntervened",
    malformed_model_output: "ProviderMalformedModelOutput",
    malformed_tool_use: "ProviderMalformedToolUse",
    stop_sequence: "ProviderStopSequence",
  };
  const error = new Error("Provider stopped before completing its answer.");
  error.name =
    response.stopReason && Object.hasOwn(names, response.stopReason)
      ? names[response.stopReason as keyof typeof names]
      : "ProviderIncompleteResponse";
  throw error;
}
