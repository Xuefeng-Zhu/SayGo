# SayGo implementation plan

The four slices from the approved SayGo brief are implemented. This page summarizes the handoff against the saved October 14, 2026 evidence; earlier milestones remain in [evaluation history](evaluation.md).

## Implemented slices

1. Build the persistent Harbor Burger menu, deterministic cart, scoped sessions, real Streamable HTTP MCP server, and restaurant-first board.
2. Add expiring quotes, customer-only approval, atomic order/outbox creation, sandbox POS reconciliation, and kitchen workflow.
3. Add the server-side Nova 2 Sonic adapter, bounded browser audio, interruption generations, and honest no-key fixtures over MCP.
4. Finish crew takeover, stock administration, retention, concurrency/isolation tests, browser verification, and handoff documentation.

Scope: one fictional restaurant and lane; integer USD cents; fixture tax; no real payments, restaurant traffic, application deployment or native Alexa+ integration. Tailwind stays on 3.4. Runtime persistence is DynamoDB Local or AWS DynamoDB; PostgreSQL is retained only as a legacy import source. Separately authorized AWS database and bounded provider trials followed the original local-only build. The October 20 publication preparation starts from `118eef4`, which includes contract 0.5 and draft improvements; the October 14 model results remain bound to their [preserved source snapshot](evidence/model-fix-source-manifest-20261014.json).

Verification layers remain separate: deterministic unit tests, DynamoDB and actual HTTP MCP integration, browser tests/screenshots, software-only audio lifecycle tests, synthetic audio through real Bedrock, and physical microphone/speaker tests. Live provider failure never becomes fixture success.

## Handoff status

The model-fix checkpoint verification passed **101 unit tests and 49 DynamoDB/MCP integration tests**, plus lint and strict typecheck; the optional Inspector check was skipped. The four Chromium journeys and production webpack/runtime/worker compilation remain earlier recorded results and were not rerun for this text-model follow-up. The earlier default Turbopack build encountered an environment port-binding failure. See the [model-fix receipt](evidence/model-fix-verification-20261014.json) and [evaluation boundaries](evaluation.md). Subsequent concurrent draft-order edits are outside that checkpoint; its exact tested source is preserved in the [source manifest](evidence/model-fix-source-manifest-20261014.json).

The separate [October 15 draft-feature checkpoint](draft-improvements.md#local-verification) passed seven Chromium journeys and production compilation on isolated feature source. [October 20 combined-source checks](evidence/model-fix-prepush-20261020.json) passed 124 unit and 61 integration tests, with optional Inspector skipped, plus lint/typecheck; browser/build and provider checks were not rerun.

The no-key ordering, correction, review, customer consent, POS sandbox, kitchen and staff workflows are verified locally. A separate [AWS DynamoDB acceptance check](evidence/aws-dynamodb-smoke.json) verified bounded cloud persistence, duplicate submissions, competing workers, recovery and isolation. This does not establish application hosting or commercial POS integration.

Current [MCP contract 0.5](mcp-contracts.md) exposes eleven tools with strict schemas, compact responses, durable review-request idempotency and structured recovery. Read-only price comparisons use the deterministic ordering engine; `find_meal_savings` adds equivalent-cart proposals with separate customer acceptance. The [earlier Inspector report](evidence/mcp-inspector.json) discovered the then-current ten tools with zero strict schema findings; it does not verify the added tool. OAuth interoperability and a protocol/SDK generation migration remain outside this implementation.

One earlier [synthetic audio trial through real Nova 2 Sonic](evidence/live-voice-sonic-v4-i-20261014.json) passed all 16 assertions using offline TTS and muted Chromium. The latest shared pricing-guidance changes have no new Sonic verification; physical microphones/speakers, independent spoken-price accuracy and acoustic barge-in remain unverified.

The final [original text benchmark](evidence/live-model-evaluation-reasoning-low-8192-run-identity-original-20261014.json) and [additional-question suite](evidence/live-model-evaluation-reasoning-low-8192-run-identity-generalization-20261014.json) each passed **10/10** in complete low-reasoning runs with an 8,192-output-token cap on the same [preserved October 14 implementation](evidence/model-fix-source-manifest-20261014.json), before the contract 0.5 draft improvements. Every trial preserved read-only state, and both runs cleaned their temporary namespaces. Questions, expected answers and exact scoring are unchanged; older failures remain preserved. These fixed-menu runs are bounded evidence, not a general reliability estimate.

A **2:36 local narrated demo** now covers the fixture ordering, correction, confirmation, kitchen and staff flow. It made zero provider calls and is not uploaded. See [recording details and submission copy](demo-and-submission.md).

## Remaining work

1. Run an explicitly authorized physical microphone/speaker acceptance session: order, interrupt, correct, verify spoken prices, stop voice, confirm and check the kitchen. Include permission denial, reconnect and staff takeover; expand browser/noise coverage separately.
2. Review current competition requirements, repository access/license and final claims, then publish the reviewed demo and complete participant-controlled submission steps. The rules snapshot in [integrations](integrations.md) is historical.
3. Before shared hosting, implement and verify deployment routing, HTTPS/WSS and credentials, then run the operational checks listed in [security and privacy](security-privacy.md). Broader model reliability requires independent trials beyond the fixed-menu suites. Application hosting, commercial POS, native Alexa+ and payments remain separate work.

The [model-fix receipt](evidence/model-fix-verification-20261014.json) records $0.79827264 observed usage against $1.50 approved for this follow-up, with no pending reservation. The [prior approval's closing receipt](evidence/provider-budget-close-20261014.json) remains separate, including its $0.25 unknown voice reservation. These are usage-based estimates, not an invoice or a new spending authorization.
