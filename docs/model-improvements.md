# Read-only model-answer improvements

## What changed

The MCP-builder workflow led to one additional workflow tool rather than making the model the pricing authority. Contract 0.4 exposes `compare_menu_prices`, backed by the existing `applyCommands` / `priceCart` engine. It computes hypothetical quantities, modifiers, listed meals, standalone meal conversions and fixture tax without writing customer data. Incomplete sizes/choices, unavailable items/components and unsupported conversions fail closed. Authentication, restaurant/lane scope and staff fences still apply.

Each response separates signed price changes from unsigned price gaps, identifies the more expensive option, returns current menu/price versions, and provides a computed factual comparison summary. A result is not a held quote, consent or an order. Full-entity integration snapshots verify that even an approved customer quote survives comparison unchanged.

Shared pricing guidance is sent to both the Nova voice adapter and the live text evaluator. The evaluator additionally explains comma-separated ID lists, literal prefixes and bare integer money fields. Its syntax check does not repair or normalize answers; exact expected-answer equality remains the acceptance check.

The 0.4 follow-up targets the two earlier 9/10 failures: comparisons default to a nonnegative `amount_cents`, while signed deltas require `signed_change`. Listed meals require an explicit drink size and reject non-medium requests instead of silently substituting medium. Returned configurations are inspectable. The latest complete original run passed the upgrade-sign case but scored 9/10 because a removal answer omitted required literal labels. Template-prefix guidance was clarified. A broader additional-question run stopped when its fifth question exhausted output tokens after four passes; it is not a completed score. Explicitly labeled focused probes preserve the same questions, answers and exact scorer and cannot be aggregated into a full-suite score. Historical failures remain unchanged. [Current receipts and results](evaluation.md).

The owner approved up to $1 additional for text and synthetic Sonic tests. Both runners use the durable owner-only `.local/provider-budgets/<approval-id>.json` ledger through `SAYGO_PROVIDER_APPROVAL_ID`. Existing approvals cannot reset; pending unknown outcomes survive restarts. New reservations stop at 75% of approval, preserving a margin. This scope is additional to, not a reset of, historical $0.786320 usage. New live calls and development failures are accounted for separately; an uncertain early voice attempt retains a $0.25 reservation. Final observed usage is required to settle provider attempts, and known no-provider attempts settle at zero.

## Evaluation boundaries

The original XML questions and answers are unchanged. Ten additional independent questions were authored and checked before their first live run; they cover negative changes, quantity/tax, meal conversions, required choices, permitted removals and tied ID lists. Only questions and discovered read-only tools reach the model. No oracle values or verifier feedback are fed back, and failed final answers are not retried within a run. Configuration-development runs are preserved separately, including failures.

Every question uses a fresh model conversation and interaction. Trials validate tool output schemas, require a real MCP call, fingerprint all database entities before/after, and clean the temporary evaluation namespace. Configuration hashes identify prompt/tool definitions; the final runs also hash the relevant implementation files. [Results and all observed limitations](evaluation.md).

The cumulative ledger includes disabled, low and medium reasoning configurations. Before a call, the runner reserves conservative input plus maximum output with a safety margin. Only validated provider usage settles unused reservation capacity; unknown outcomes retain their full reservation. Rates were rechecked against AWS's regional price list before the October 13 runs. This is an application-level spending guard and usage-based estimate, not an AWS invoice or billing-enforced hard cap.

## What this does not prove

This is a bounded text/MCP evaluation, not statistical reliability, a deployment acceptance test, real POS integration, or a microphone/Sonic speech test. Changing reasoning effort in the text evaluator does **not** change the runtime voice model or prove that voice answers are accurate. Known incorrect answers remain failures, not successes obtained by loosening the scorer.

Nova 2 Lite does not support Bedrock's native structured-output feature in the [current model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html); this work does not claim provider-enforced final-answer schemas. The tool input/output contracts are validated locally, and raw final-answer formatting is still evaluated. The pinned MCP generation follows the [2025-11-25 tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools); a protocol/SDK v2 migration was not bundled into this change.
