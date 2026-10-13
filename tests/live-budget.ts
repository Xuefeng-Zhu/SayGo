export const INPUT_USD_PER_MILLION = 0.33;
export const OUTPUT_USD_PER_MILLION = 2.75;
export const MAX_OUTPUT_TOKENS = 2048;
export const READ_ONLY_TOOLS = new Set(["get_menu", "get_item_details"]);
export function requireReadOnly(name: string) {
  if (!READ_ONLY_TOOLS.has(name))
    throw new Error(
      "Evaluation attempted a tool outside its read-only allowlist.",
    );
}
export class EvaluationBudget {
  reservedUsd = 0;
  reportedUsd = 0;
  inputTokens = 0;
  outputTokens = 0;
  calls = 0;
  constructor(
    readonly maximumUsd: number,
    readonly maximumOutputTokens = MAX_OUTPUT_TOKENS,
  ) {
    if (!Number.isFinite(maximumUsd) || maximumUsd <= 0 || maximumUsd > 1)
      throw new Error(
        "Live evaluation budget must be explicitly set between $0 and $1.",
      );
    if (
      !Number.isSafeInteger(maximumOutputTokens) ||
      maximumOutputTokens < 1 ||
      maximumOutputTokens > 8192
    )
      throw new Error("Output token limit must be between 1 and 8192.");
  }
  reserve(request: unknown) {
    const bytes = Buffer.byteLength(JSON.stringify(request));
    if (bytes > 48000)
      throw new Error("Evaluation context exceeds its bounded input size.");
    // Nova lacks CountTokens. Use two tokens per serialized UTF-8 byte plus
    // 8192 tokens for provider framing, reserve maximum output, and retain 25%
    // of the approved dollar limit. Reservations survive unknown outcomes.
    const inputBound = bytes * 2 + 8192;
    const usd =
      (inputBound * INPUT_USD_PER_MILLION +
        this.maximumOutputTokens * OUTPUT_USD_PER_MILLION) /
      1e6;
    if (this.reservedUsd + usd > this.maximumUsd * 0.75 || this.calls >= 80)
      throw new Error(
        "Evaluation spending cutoff reached before another model call.",
      );
    this.reservedUsd += usd;
    this.calls++;
    return { inputBound, usd };
  }
  record(input: number, output: number, bound: number) {
    if (
      !Number.isSafeInteger(input) ||
      !Number.isSafeInteger(output) ||
      input < 0 ||
      output < 0
    )
      throw new Error(
        "Provider usage was missing or invalid; no further calls permitted.",
      );
    this.inputTokens += input;
    this.outputTokens += output;
    this.reportedUsd +=
      (input * INPUT_USD_PER_MILLION + output * OUTPUT_USD_PER_MILLION) / 1e6;
    if (input > bound || output > this.maximumOutputTokens)
      throw new Error(
        "Provider usage exceeded the conservative request bound; stop evaluation.",
      );
  }
}
export function remainingBudget(
  approved: number,
  prior: number,
  outputLimit = MAX_OUTPUT_TOKENS,
) {
  new EvaluationBudget(approved, outputLimit);
  if (!Number.isFinite(prior) || prior < 0)
    throw new Error("Prior spending evidence is invalid.");
  return new EvaluationBudget(approved - prior, outputLimit);
}
