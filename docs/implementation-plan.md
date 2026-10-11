# SayGo implementation plan

Approved scope: the supplied SayGo brief, implemented in this empty starter repository.

1. Build the persistent Harbor Burger menu, deterministic cart, scoped sessions, real Streamable HTTP MCP server, and restaurant-first board.
2. Add expiring quotes, customer-only approval, atomic order/outbox creation, sandbox POS reconciliation, and kitchen workflow.
3. Add the server-side Nova 2 Sonic adapter, bounded browser audio, interruption generations, and honest no-key fixtures over MCP.
4. Finish crew takeover, stock administration, retention, concurrency/isolation tests, browser verification, and handoff documentation.

Constraints: one fictional restaurant and lane; integer USD cents; fixture tax; no real payments, restaurant traffic, paid cloud resources, deployment, or native Alexa+ claims. Tailwind stays on 3.4 per parent repository guidance. PostgreSQL is a dedicated local Compose service. No remote exists to synchronize. Existing starter files are preserved or expanded.

Verification layers will be reported separately: deterministic unit tests, PostgreSQL and actual HTTP MCP integration, browser tests/screenshots, synthetic audio lifecycle tests, and live Bedrock/microphone checks (only if configured). Live provider failure never becomes fixture success.

## Handoff status

All four implementation slices are present. The no-key ordering, correction, review, consent, POS sandbox, kitchen and staff workflows pass local verification. The Nova streaming adapter is implemented with synthetic event tests, but no live provider or microphone trial was run. See [evaluation and exact evidence boundaries](evaluation.md) for the 23 unit, 28 database/MCP and 3 browser tests, measured local timings, build checks and remaining external gates.

The approved MCP follow-up is also complete: exact output schemas, compact agent payloads, durable review-request idempotency, and structured recovery errors. See [MCP contract 0.2](mcp-contracts.md). No new authentication scheme or transport was added.

The subsequent [MCP guide review](mcp-best-practices-review.md) verified 70 tests: 23 unit, 44 integration including Inspector, and three browser workflows. It fixed protocol/authentication edge cases and added ten read-only evaluation questions. OAuth interoperability, latest-generation protocol migration and live model evaluations remain explicit limitations.
