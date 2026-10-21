# Architecture and correctness boundaries

## Runtime topology

```text
Next.js board/crew/kitchen/admin (3100)
  same-origin /api proxy → Node runtime (3101)
  customer gesture → authenticated WebSocket → Nova 2 Sonic (opt-in)
  fixture or completed Nova tool → official MCP HTTP client
    initialize → tools/list → tools/call → /mcp
      scoped conditional transaction → DynamoDB (local 8000 or AWS)
        quote approval → order + outbox job, one transaction
Separate worker → leased job → idempotent POS sandbox → acknowledgement
Kitchen polls only accepted/preparing/ready orders
```

## Code map

| Source                                                                                                                                                                  | Responsibility                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Web app](../apps/web/app), [customer board](../apps/web/app/components/lane-board.tsx)                                                                                 | Customer ordering and staff surfaces, canonical-state polling and explicit customer actions.                       |
| [Runtime routes](../apps/runtime/src/app.ts), [authentication](../apps/runtime/src/auth.ts)                                                                             | HTTP entry points, same-origin actions, customer/staff cookies and scoped MCP credentials.                         |
| [MCP server](../apps/runtime/src/mcp.ts), [result projections](../apps/runtime/src/mcp-results.ts)                                                                      | Tool discovery, input validation and compact success/error envelopes.                                              |
| [Input contracts](../packages/contracts/src/index.ts), [MCP result contracts](../packages/contracts/src/mcp.ts)                                                         | Shared command types, exact wire schemas and recovery actions.                                                     |
| [Domain service](../packages/domain/src/service.ts)                                                                                                                     | Session/ownership checks, customer consent, cart receipts, quotes and order transactions.                          |
| [Ordering engine](../packages/domain/src/engine.ts), [price comparisons](../packages/domain/src/menu-prices.ts), [meal savings](../packages/domain/src/meal-savings.ts) | Deterministic selection validation and pricing; no provider calls.                                                 |
| [DynamoDB repository](../packages/db/src/index.ts), [record types](../packages/db/src/schema.ts)                                                                        | Strongly consistent reads, staged writes, revision guards and maintenance fences.                                  |
| [MCP client](../packages/integrations/src/mcp-client.ts), [POS adapter](../packages/integrations/src/pos.ts), [worker entry point](../apps/worker/src/index.ts)         | Real HTTP MCP exchanges, durable sandbox reconciliation and background polling.                                    |
| [Voice runtime](../apps/runtime/src/voice.ts), [Nova adapter](../packages/integrations/src/nova.ts)                                                                     | Authenticated WebSocket lifecycle and optional provider stream. See [voice](voice.md) for verification boundaries. |

## Domain and transport boundaries

`packages/contracts` defines Zod commands and shared types. `domain/engine.ts` is deterministic: no model pricing. `domain/service.ts` is the transaction and authority boundary. `db/schema.ts` defines persisted entity types. A partition key isolates each environment and restaurant; sort keys identify entity records. The repository stages changes, performs strongly consistent reads, and atomically commits them with a condition on the restaurant revision. Read decisions recheck that revision; transaction conflicts rerun against fresh state. `integrations` contains actual MCP, POS and Nova adapters. Staff routes deliberately use authorized domain services directly; conversational routes never call tool handlers as an MCP shortcut.

The [version 0.5 MCP contract](mcp-contracts.md) validates exact success/error payloads on both server and client. Its eleven tools include read-only `find_meal_savings` for equivalent-cart proposals with [separate customer acceptance](draft-improvements.md), plus a hypothetical price comparison that runs the ordering engine against temporary in-memory selections and never writes cart, quote, consent or order entities. Comparisons default to a nonnegative price gap; explicit `signed_change` returns each later option minus the first. Its summary supplies both subtraction directions with explicit operand labels so answer-field order need not match tool-option order. The signed-summary follow-up preserves the comparison's numeric fields, schema and unsigned price-gap behavior. Compact agent responses omit unnecessary UI state; the browser gateway separately reads the authenticated full view. Structured recovery metadata survives HTTP and Nova adapter boundaries.

Shared pricing guidance reaches both the text evaluation and the Nova voice adapter. It now preserves the same product and unrelated choices across before/after modifications and matches signed differences to the requested operand labels. A [synthetic-input trial through real Sonic](evidence/live-voice-sonic-v4-i-20261014.json) passed before these shared-guidance and signed-summary changes; its [source manifest](evidence/live-voice-i-source-manifest.json) identifies the tested implementation. No Sonic rerun occurred in the later text-only follow-up, so that saved pass does not verify the changed voice behavior. Physical voice remains unverified. See [voice boundaries](voice.md).

## Independent state machines

| Entity      | States / versions                                                                | Purpose                                                 |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Interaction | active → ended; lane epoch                                                       | Isolate each fictional vehicle; expiry after 15 minutes |
| Ownership   | ai ↔ staff; monotonic fence                                                     | Reject old AI credentials on takeover/handoff           |
| Cart        | integer version; stable individual line IDs                                      | Optimistic correction target and deterministic pricing  |
| Quote       | valid → invalidated; 2-minute expiry                                             | Exact cart/menu/price snapshot and SHA-256 binding      |
| Approval    | absent → customer-recorded → consumed                                            | Not a model-supplied boolean                            |
| Order       | submitted → unknown/accepted/rejected; accepted → preparing → ready → handed_off | Acceptance is separate from submission and fulfillment  |
| Outbox job  | pending → leased → done; expired lease → reclaimed                               | Durable retry; worker-token fencing                     |
| Audio       | playback generation, interrupted audio content IDs (completion-ID fallback)      | Drop interrupted audio, independent of cart/ownership   |

The restaurant revision serializes changes for this one-lane MVP. Every writer increments it within the same `TransactWriteItems` bundle as its entity changes. This protects missing-key checks, query results, cart versions, approvals and leases. Read snapshots recheck the revision, and unknown transport outcomes return for reconciliation instead of replaying an arbitrary write. This intentionally prioritizes clarity over multi-restaurant throughput. Two concurrent cart requests with the same expected version cannot both apply. A batch rolls back entirely if any command is invalid. Missing required choices can remain visibly unresolved in a draft; they block review.

Every added quantity becomes individual lines. Updating quantity is supported, but meal conversion requires a single selected sandwich. Modifiers are allowlisted options, not arbitrary notes. Standalone meal conversions use an explicit base sandwich + medium fries + selected drink and supported size minus a fictional $1 bundle discount. Listed meals include a medium drink; a different drink size requires standalone conversion. Converted sandwiches retain their permitted modifiers. No implicit substitutions or paid upgrades.

Meaningful draft changes persist a receipt and one Undo snapshot when both selections can be priced. The authenticated full view exposes `last_change` and `meal_savings`; compact MCP cart responses keep their existing shape. Applying savings recomputes the displayed proposal inside the transaction and checks its session, fence, cart, menu and price binding. Undo restores the prior selections and stable line IDs at a new cart version. Both customer actions require idle voice and an editable, unsubmitted draft; both invalidate the old quote and require fresh review/approval. An Undo cannot itself be undone. See [draft improvements](draft-improvements.md) for route inputs and guard conditions.

## Consent and idempotency

An authenticated customer cookie calls the approval route. It validates quote expiry, snapshot hash, cart/menu versions, fence, unresolved choices and staff review. Live voice has a database-backed lease; confirmation is blocked until voice is stopped and queued work drains. The ordering agent never receives the customer's cookie and cannot call the approval route.

Review creation uses a UUID scoped to session and actor, with an argument hash persisted on the quote. Identical retries return the same still-valid quote without renewing expiry or approval. Expired, changed or fenced reviews cannot be revived by replaying their request ID. A new review requires a new identity and fresh approval.

Submission atomically consumes approval, inserts one order (unique session and quote), and inserts its outbox job. The stable external key is derived from session + operation, not generated on every retry. Duplicate submissions for the same quote return the existing order. A different quote or a reused cart request ID with different payload is rejected. Draft reset has a version-bound token which only the customer action can consume.

The worker selects a pending or expired job and conditionally commits a 30-second lease. Concurrent claimers lose the revision condition and reread, then POS work runs outside the database transaction. Every attempt first looks up the external key. A timeout can mean the sandbox accepted; the visible order remains `unknown`, staff receives a handoff, and reconciliation keeps the same key. Receipt keys and payload hashes are unique/checked. Completion updates require the lease token, preventing a superseded worker from overwriting a newer result. This is not a promise of exactly-once delivery for a hypothetical commercial POS.

Accepted-order amendments/cancellation are intentionally **staff handoff only**. The MVP does not provide automatic ticket amendments or real cancellation. Departing the lane revokes the interaction, not the accepted order.

## Persistent records

Restaurant/timezone, lane/epoch, staff roles, menu products (versioned structured JSON including modifiers), interactions, carts/stable lines/latest receipt/Undo snapshot, quotes, approvals, orders/snapshots, outbox jobs, POS receipts/attempts, handoffs, idempotency hashes and redacted audit events are persisted. Timestamps are UTC ISO strings; Harbor Burger's display timezone is America/Los_Angeles. Browser views poll canonical state every second; no cart or transcript is restored from localStorage. See [DynamoDB](dynamodb.md) for key layout and transaction limits.
