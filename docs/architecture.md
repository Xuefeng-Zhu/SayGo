# Architecture

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

`packages/contracts` defines Zod commands and shared types. `domain/engine.ts` validates selections and calculates prices without model calls. `domain/service.ts` checks authority and coordinates transactions. `db/schema.ts` defines persisted records. Environment and restaurant partition keys isolate datasets; sort keys identify records. The repository reads consistently, stages changes and commits them only if the restaurant revision still matches. Conflicts rerun against fresh state.

Conversational requests use the HTTP MCP client. Staff routes call authorized domain services directly. `integrations` contains the MCP, POS and Nova adapters.

The [version 0.5 MCP contract](mcp-contracts.md) validates success and error payloads on both server and client. Its eleven tools include two read-only pricing tools:

- `find_meal_savings` proposes equivalent cart groupings for [customer acceptance](draft-improvements.md).
- `compare_menu_prices` prices temporary in-memory selections. It defaults to a nonnegative gap; `signed_change` returns each later option minus the first. Summaries label both subtraction directions.

Neither tool writes carts, quotes, approvals or orders. Agent responses contain compact results and recovery actions; the browser separately fetches the full authenticated view. Shared model guidance preserves the product and unrelated choices during price comparisons. [Text evaluation](model-improvements.md) and [voice verification](voice.md) record which versions were tested.

## Independent state machines

| Entity      | States / versions                                                                | Purpose                                                 |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Interaction | active → ended; lane epoch                                                       | Isolate each fictional vehicle; expiry after 15 minutes |
| Ownership   | ai ↔ staff; monotonic fence                                                     | Reject old AI credentials on takeover/handoff           |
| Cart        | integer version; stable individual line IDs                                      | Optimistic correction target and deterministic pricing  |
| Quote       | valid → invalidated; 2-minute expiry                                             | Exact cart/menu/price snapshot and SHA-256 binding      |
| Approval    | absent → customer-recorded → consumed                                            | Bind customer consent to the exact quote                |
| Order       | submitted → unknown/accepted/rejected; accepted → preparing → ready → handed_off | Acceptance is separate from submission and fulfillment  |
| Outbox job  | pending → leased → done; expired lease → reclaimed                               | Durable retry; worker-token fencing                     |
| Audio       | playback generation, interrupted audio content IDs (completion-ID fallback)      | Drop interrupted audio, independent of cart/ownership   |

The restaurant revision serializes changes for this one-lane demo. Every writer increments it within the same `TransactWriteItems` bundle as its entity changes. This protects missing-key checks, query results, cart versions, approvals and leases. Reads recheck the revision. An uncertain transport outcome requires reconciliation before another write. Two cart requests with the same expected version cannot both apply, and a batch rolls back if any command is invalid. Missing choices may remain visible in a draft, but block review. Multi-restaurant throughput has not been tested.

Each added item gets its own line. Quantity updates are supported; meal conversion requires a single selected sandwich. Modifiers must come from the menu's allowed options. A conversion combines the sandwich, medium fries and a selected drink/size, then subtracts a fictional $1 discount. Listed meals include a medium drink; other sizes require standalone conversion. Sandwich modifiers are preserved, and substitutions or paid upgrades require explicit choices.

Draft changes save a receipt and one Undo snapshot when both selections can be priced. The full browser view exposes `last_change` and `meal_savings`; compact MCP cart responses keep their existing shape. Applying savings recomputes the proposal in the transaction and checks its session, ownership, cart, menu and prices. Undo restores the previous selections and line IDs at a new cart version. Both actions require idle voice and an editable, unsubmitted draft, invalidate the old quote and require a new review. Undo can be used once per change. See [draft improvements](draft-improvements.md) for route inputs and guards.

## Consent and idempotency

Screen approval uses the authenticated customer cookie. The route checks quote expiry, snapshot hash, cart/menu versions, ownership, unresolved choices and staff review. A database voice lease blocks screen approval until voice stops and queued work drains. The agent never receives the customer cookie.

The current Nova adapter uses screen approval only. Its transcript fragments cannot establish a complete final customer utterance, so spoken approval remains disabled. The [voice-confirmation core](voice-confirmation.md) and controlled tests support a future adapter with complete speech evidence.

Review creation uses a UUID scoped to session and actor, with an argument hash persisted on the quote. Identical retries return the same still-valid quote without renewing expiry or approval. Expired, changed or fenced reviews cannot be revived by replaying their request ID. A new review requires a new identity and fresh approval.

Submission atomically consumes approval and inserts one order and its outbox job. The external key is derived from the session and operation, so retries retain the same key. Duplicate submissions for the same quote return the existing order. A different quote or a reused cart request ID with a different payload is rejected. Draft reset has a version-bound token consumed only by a customer action.

The worker claims pending or expired jobs with a 30-second lease. Concurrent claimers reread after a revision conflict; POS work runs outside the transaction. Every attempt first looks up the external key. A timeout may occur after acceptance, so the order remains `unknown`, staff receives a handoff and reconciliation keeps the same key. Receipt keys are unique and payload hashes are checked. Completion requires the current lease token. These guarantees apply to the local sandbox; commercial POS behavior remains untested.

Accepted-order changes and cancellation require **staff handoff**. The demo has no automatic ticket amendment or cancellation. Departing the lane ends the interaction and preserves the accepted order.

## Persistent records

Restaurant/timezone, lane/epoch, staff roles, menu products (versioned structured JSON including modifiers), interactions, carts/stable lines/latest receipt/Undo snapshot, quotes, approvals, orders/snapshots, outbox jobs, POS receipts/attempts, handoffs, idempotency hashes and redacted audit events are persisted. Timestamps are UTC ISO strings; Harbor Burger's display timezone is America/Los_Angeles. Browser views poll canonical state every second; no cart or transcript is restored from localStorage. See [DynamoDB](dynamodb.md) for key layout and transaction limits.
