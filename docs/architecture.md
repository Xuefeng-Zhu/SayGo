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

`packages/contracts` defines Zod commands and shared types. `domain/engine.ts` is deterministic: no model pricing. `domain/service.ts` is the transaction and authority boundary. `db/schema.ts` defines persisted entity types. A partition key isolates each environment and restaurant; sort keys identify entity records. The repository stages changes, performs strongly consistent reads, and atomically commits them with a condition on the restaurant revision. Read decisions recheck that revision; transaction conflicts rerun against fresh state. Checked-in SQL migrations remain only for legacy PostgreSQL import. `integrations` contains actual MCP, POS and Nova adapters. Staff routes deliberately use authorized domain services directly; conversational routes never call tool handlers as an MCP shortcut.

The [version 0.3 MCP contract](mcp-contracts.md) validates exact success/error payloads on both server and client. Its ten tools include a read-only hypothetical price comparison that runs the ordering engine against temporary in-memory selections and never writes cart, quote, consent or order entities. Signed subtotal deltas use the first option as baseline. Compact agent responses omit unnecessary UI state; the browser gateway separately reads the authenticated full view. Structured recovery metadata survives HTTP and Nova adapter boundaries. Shared pricing guidance reaches both the text evaluation and the Nova voice adapter; real voice remains unverified.

## Independent state machines

| Entity      | States / versions                                                                | Purpose                                                 |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Interaction | active → ended; lane epoch                                                       | Isolate each fictional vehicle; expiry after 15 minutes |
| Ownership   | ai ↔ staff; monotonic fence                                                     | Reject old AI credentials on takeover/handoff           |
| Cart        | integer version; stable individual line IDs                                      | Optimistic correction target and deterministic pricing  |
| Quote       | valid, expires in 2 minutes, invalidated/consumed                                | Exact cart/menu/price snapshot and SHA-256 binding      |
| Approval    | absent → customer-recorded → consumed                                            | Not a model-supplied boolean                            |
| Order       | submitted → unknown/accepted/rejected; accepted → preparing → ready → handed_off | Acceptance is separate from submission and fulfillment  |
| Outbox job  | pending → leased → done; expired lease → reclaimed                               | Durable retry; worker-token fencing                     |
| Audio       | playback generation, blocked completion IDs                                      | Drop interrupted audio, independent of cart/ownership   |

The restaurant revision serializes changes for this one-lane MVP. Every writer increments it within the same `TransactWriteItems` bundle as its entity changes. This protects missing-key checks, query results, cart versions, approvals and leases. Read snapshots recheck the revision, and unknown transport outcomes return for reconciliation instead of replaying an arbitrary write. This intentionally prioritizes clarity over multi-restaurant throughput. Two concurrent cart requests with the same expected version cannot both apply. A batch rolls back entirely if any command is invalid. Missing required choices can remain visibly unresolved in a draft; they block review.

Every added quantity becomes individual lines. Updating quantity is supported, but meal conversion requires a single selected sandwich. Modifiers are allowlisted options, not arbitrary notes. Standalone meals use explicit base sandwich + medium fries + selected medium drink minus a fictional $1 bundle discount. Converted sandwiches retain their permitted modifiers. No implicit substitutions or paid upgrades.

## Consent and idempotency

An authenticated customer cookie calls the approval route. It validates quote expiry, snapshot hash, cart/menu versions, fence, unresolved choices and staff review. Live voice has a database-backed lease; confirmation is blocked until voice is stopped and queued work drains. The ordering agent never receives the customer's cookie and cannot call the approval route.

Review creation uses a UUID scoped to session and actor, with an argument hash persisted on the quote. Identical retries return the same still-valid quote without renewing expiry or approval. Expired, changed or fenced reviews cannot be revived by replaying their request ID. A new review requires a new identity and fresh approval.

Submission atomically consumes approval, inserts one order (unique session and quote), and inserts its outbox job. The stable external key is derived from session + operation, not generated on every retry. Duplicate submissions for the same quote return the existing order. A different quote or a reused cart request ID with different payload is rejected. Draft reset has a version-bound token which only the customer action can consume.

The worker selects a pending or expired job and conditionally commits a 30-second lease. Concurrent claimers lose the revision condition and reread, then POS work runs outside the database transaction. Every attempt first looks up the external key. A timeout can mean the sandbox accepted; the visible order remains `unknown`, staff receives a handoff, and reconciliation keeps the same key. Receipt keys and payload hashes are unique/checked. Completion updates require the lease token, preventing a superseded worker from overwriting a newer result. This is not a promise of exactly-once delivery for a hypothetical commercial POS.

Accepted-order amendments/cancellation are intentionally **staff handoff only**. The MVP does not provide automatic ticket amendments or real cancellation. Departing the lane revokes the interaction, not the accepted order.

## Persistent records

Restaurant/timezone, lane/epoch, staff roles, menu products (versioned structured JSON including modifiers), interactions, carts/stable lines, quotes, approvals, orders/snapshots, outbox jobs, POS receipts/attempts, handoffs, idempotency hashes and redacted audit events are persisted. Timestamps are UTC ISO strings; Harbor Burger's display timezone is America/Los_Angeles. Browser views poll canonical state every second; no cart or transcript is restored from localStorage.
