# Read-only model-answer improvements

## Final text verification — October 14, 2026

Both unchanged full benchmarks passed on the same final implementation: **10/10 original and 10/10 additional questions**, using Nova 2 Lite with low reasoning and an 8,192-token output limit. Each was a separate complete run with a fresh conversation per question, real read-only HTTP MCP calls, preserved database state and cleaned temporary data. [Original receipt](evidence/live-model-evaluation-reasoning-low-8192-run-identity-original-20261014.json), [additional-question receipt](evidence/live-model-evaluation-reasoning-low-8192-run-identity-generalization-20261014.json), [verification and budget receipt](evidence/model-fix-verification-20261014.json).

The verified source was checked after both runs and preserved in a reconstructable [manifest and patch](evidence/model-fix-source-manifest-20261014.json). Separate draft-order feature changes subsequently became commit `118eef4`, adding contract 0.5 and an eleventh tool. Those changes are preserved in the October 20 publication base and are not covered by these model results.

The failing arithmetic receipts show a valid comparison requested in the opposite order from the answer template: the question asks for first minus second, while the tool returns second minus first for the supplied option order. The engine's prices and signed delta are correct. The old guidance told the model to retain that sign while also requiring a different answer direction. This mismatch is a plausible contributor to the subsequent `max_tokens` stop, not proof of the model's internal reasoning.

Signed comparison summaries now give both subtraction equations with explicit operand labels. Shared guidance maps the requested subtraction to those labels and requires before/after comparisons to preserve the same product, quantity and unrelated choices. Numeric fields, unsigned price-gap summaries, schemas, meal-size checks, benchmark questions/answers and exact scoring are unchanged. No fixture prices or expected answers were added to the instructions. Truncated provider responses now receive the sanitized `ProviderMaxTokens` classification instead of generic `Error`; the runner still stops without retrying or accepting a partial answer.

A reusable helper derives field-by-field formatting instructions only from the question's explicit `Return` template. It distinguishes literal prefixes, bare numeric fields and lists, and conservatively declines unsupported templates. It never reads the expected answer or repairs model output. This addressed extra header rows and an unwanted field-name prefix observed in the preserved development runs. A later wrong-product baseline prompted the identity guidance above. Low reasoning was used for the final runs; these development results do not isolate the effect of reasoning effort from the prompt changes.

Local verification during the follow-up passed **101 unit tests and 49 DynamoDB/HTTP MCP integration tests**, plus lint and strict typecheck. The optional Inspector test was skipped. Regressions cover both subtraction directions, reversed options, ties, changed menu prices, strict output schemas, template parsing, provider-stop classification and preserved cart/quote/database state. After the final guidance-only edit, 39 focused tests and both full live suites passed. Browser/build checks and Sonic were not rerun.

The owner approved $1 and then another $0.50 for this text-only follow-up. Its two ledgers record **$0.798272640 observed usage and $0 pending**, within the $1.50 combined authorization. Paid testing is stopped and the owned in-memory database/listeners are stopped. The older $0.25 unknown voice-outcome reservation remains separate and unchanged. These are token-based estimates, not an invoice. [Complete accounting and preserved intermediate results](evidence/model-fix-verification-20261014.json).

## Run an authorized text evaluation

Start DynamoDB Local first using the [local setup guide](local-development.md). The runner creates and cleans a temporary namespace and binds MCP on port 3113. It calls real Bedrock Nova 2 Lite, even though the database is local. Use an authorized AWS profile/credential chain and an explicitly approved additional budget before running it.

Use an already initialized `SAYGO_PROVIDER_APPROVAL_ID` and set `SAYGO_EVAL_MAX_USD` to that ledger's approved limit. Each approval supports at most $1; the recorded $1.50 follow-up used two separate approvals. Initializing a ledger records an authorization that has already been given; it does not grant permission to spend. Existing ledgers cannot be reset. Do not reuse a historical approval without checking its remaining scope, observed usage and pending reservations.

With those two variables set, run a complete original suite with a fresh `SAYGO_EVAL_RUN_ID` (letters, digits, underscores and hyphens; at most 40 characters):

```sh
: "${SAYGO_PROVIDER_APPROVAL_ID:?Set an initialized approval ID}"
: "${SAYGO_EVAL_MAX_USD:?Set the approved ledger limit}"
unset SAYGO_EVAL_IDS
DYNAMODB_ENDPOINT=http://127.0.0.1:8000 \
DYNAMODB_TABLE=saygo-local \
SAYGO_DEMO=true \
SAYGO_LIVE_EVAL=true \
SAYGO_PROVIDER_APPROVAL_ID="$SAYGO_PROVIDER_APPROVAL_ID" \
SAYGO_EVAL_MAX_USD="$SAYGO_EVAL_MAX_USD" \
SAYGO_EVAL_REASONING=low \
SAYGO_EVAL_MAX_TOKENS=8192 \
SAYGO_EVAL_SUITE=original \
SAYGO_EVAL_RUN_ID=original-your-unique-id \
pnpm test:live
```

Change the suite to `generalization` and choose a different run ID for the ten additional questions, within the same authorized ledger limit. Reports are saved under `docs/evidence/live-model-evaluation-…-run-<id>.json`; existing reports are refused rather than overwritten. `SAYGO_EVAL_IDS` selects focused probes, whose `fullSuite:false` results do not replace a full benchmark.

The runner defaults to the original suite, disabled reasoning and 2,048 output tokens; the command explicitly selects the saved successful configuration. Its read-only allowlist contains only `get_menu`, `get_item_details` and `compare_menu_prices`, so this benchmark does not evaluate `find_meal_savings`. Answers are scored by exact trimmed equality without repair or failed-answer retries. Record the new report's source hash and outcome separately from the October 14 results above.

## What changed

The MCP-builder workflow led to one additional workflow tool rather than making the model the pricing authority. The tested contract 0.4 snapshot exposes `compare_menu_prices`, backed by the existing `applyCommands` / `priceCart` engine. It computes hypothetical quantities, modifiers, listed meals, standalone meal conversions and fixture tax without writing customer data. Incomplete sizes/choices, unavailable items/components and unsupported conversions fail closed. Authentication, restaurant/lane scope and staff fences still apply.

Each response separates signed price changes from unsigned price gaps, identifies the more expensive option, returns current menu/price versions, and provides a computed factual comparison summary. A result is not a held quote, consent or an order. Full-entity integration snapshots verify that even an approved customer quote survives comparison unchanged.

Shared pricing guidance is sent to both the Nova voice adapter and the live text evaluator. The evaluator additionally explains comma-separated ID lists, literal prefixes and bare integer money fields. Its syntax check does not repair or normalize answers; exact expected-answer equality remains the acceptance check.

The earlier 0.4 follow-up introduced nonnegative price gaps and explicit listed-meal size checks. It still produced a 9/10 original run and an incomplete additional-question run; focused probes did not complete either suite. Those failures remain preserved alongside the later development runs. The final complete results above supersede them for the preserved tested implementation, without combining partial results or changing any expected answer. [Dated receipts and results](evaluation.md).

Both runners use the durable owner-only `.local/provider-budgets/<approval-id>.json` ledger through `SAYGO_PROVIDER_APPROVAL_ID`. Existing approvals cannot reset; pending unknown outcomes survive restarts. New reservations stop at 75% of approval, preserving a margin. Each new approval is separate from historical usage. Final observed usage is required to settle provider attempts, and known no-provider attempts settle at zero.

The [prior text/voice approval's closing receipt](evidence/provider-budget-close-20261014.json) remains unchanged: $0.484806577 observed additional usage, $0.25 reserved for an unknown outcome and $0.734806577 accounted against its $1 authorization. Its focused signed-arithmetic probe exhausted 8,192 output tokens. The separately authorized text follow-up above resolves that benchmark case in the final full suite; it does not settle the earlier voice uncertainty.

## Evaluation boundaries

The original XML questions and answers are unchanged. Ten additional independent questions were authored and checked before their first live run; they cover negative changes, quantity/tax, meal conversions, required choices, permitted removals and tied ID lists. Only questions and discovered read-only tools reach the model. No oracle values or verifier feedback are fed back, and failed final answers are not retried within a run. Configuration-development runs are preserved separately, including failures.

Every question uses a fresh model conversation and interaction. Trials validate tool output schemas, require a real MCP call, fingerprint all database entities before/after, and clean the temporary evaluation namespace. Per-trial configuration hashes include the question-derived formatting guidance and therefore differ between templates. Both final suites share the same implementation hash, including the helper and evaluator source. [Results and all observed limitations](evaluation.md).

Preserved runs include disabled, low and medium reasoning configurations. Before a call, the runner reserves conservative input plus maximum output with a safety margin. Only validated provider usage settles unused reservation capacity; unknown outcomes retain their full reservation. Rates were rechecked against AWS's regional price list for this follow-up: $0.33/M input and $2.75/M output tokens. [Pricing receipt](evidence/provider-pricing-20261014-model-fix.json). This is an application-level spending guard and usage-based estimate, not an AWS invoice or billing-enforced hard cap.

## What this does not prove

This is a bounded text/MCP development evaluation, not statistical reliability, a deployment acceptance test, real POS integration, or a microphone/Sonic speech test. The additional questions have now informed development and are not an unseen holdout. Changing reasoning effort in the text evaluator does **not** change the runtime voice model or prove that voice answers are accurate. Shared pricing guidance and tool summaries changed after the saved Sonic trial; there is no new Sonic evidence for these edits. Known incorrect answers remain failures, not successes obtained by loosening the scorer.

Nova 2 Lite does not support Bedrock's native structured-output feature in the [current model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html); this work does not claim provider-enforced final-answer schemas. The tool input/output contracts are validated locally, and raw final-answer formatting is still evaluated. The pinned MCP generation follows the [2025-11-25 tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools); a protocol/SDK v2 migration was not bundled into this change.
