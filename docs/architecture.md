# Architecture and correctness boundaries

## Runtime topology

```text
Next.js board/crew/kitchen/admin (3100)
  same-origin /api proxy → Node runtime (3101)
  customer gesture → authenticated WebSocket → Nova 2 Sonic (opt-in)
  fixture or completed Nova tool → official MCP HTTP client
    initialize → tools/list → tools/call → /mcp
      scoped domain transaction → PostgreSQL (55432)
        quote approval → order + outbox job, one transaction
Separate worker → leased job → idempotent POS sandbox → acknowledgement
Kitchen polls only accepted/preparing/ready orders
```

`packages/contracts` defines Zod commands and shared types. `domain/engine.ts` is deterministic: no model pricing. `domain/service.ts` is the transaction and authority boundary. `db/schema.ts` is the Drizzle model; checked-in SQL migrations also include database constraints. Drizzle seeds the menu/staff and `pg` transactions implement explicit locks. `integrations` contains actual MCP, POS and Nova adapters. Staff routes deliberately use authorized domain services directly; conversational routes never call tool handlers as an MCP shortcut.

The [version 0.2 MCP contract](mcp-contracts.md) validates exact success/error payloads on both server and client. Compact agent responses omit unnecessary UI state; the browser gateway separately reads the authenticated full view. Structured recovery metadata survives HTTP and Nova adapter boundaries.

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

The restaurant row serializes menu changes and domain operations for this one-lane MVP. Interaction/cart locks are held only for short database work. This intentionally prioritizes clarity over multi-restaurant throughput. Two concurrent cart requests with the same expected version cannot both apply. A batch rolls back entirely if any command is invalid. Missing required choices can remain visibly unresolved in a draft; they block review.

Every added quantity becomes individual lines. Updating quantity is supported, but meal conversion requires a single selected sandwich. Modifiers are allowlisted options, not arbitrary notes. Standalone meals use explicit base sandwich + medium fries + selected medium drink minus a fictional $1 bundle discount. Converted sandwiches retain their permitted modifiers. No implicit substitutions or paid upgrades.

## Consent and idempotency

An authenticated customer cookie calls the approval route. It validates quote expiry, snapshot hash, cart/menu versions, fence, unresolved choices and staff review. Live voice has a database-backed lease; confirmation is blocked until voice is stopped and queued work drains. The ordering agent never receives the customer's cookie and cannot call the approval route.

Review creation uses a UUID scoped to session and actor, with an argument hash persisted on the quote. Identical retries return the same still-valid quote without renewing expiry or approval. Expired, changed or fenced reviews cannot be revived by replaying their request ID. A new review requires a new identity and fresh approval.

Submission atomically consumes approval, inserts one order (unique session and quote), and inserts its outbox job. The stable external key is derived from session + operation, not generated on every retry. Duplicate submissions for the same quote return the existing order. A different quote or a reused cart request ID with different payload is rejected. Draft reset has a version-bound token which only the customer action can consume.

The worker claims with `FOR UPDATE SKIP LOCKED`, commits a 30-second lease, then does POS work without holding those row locks. Every attempt first looks up the external key. A timeout can mean the sandbox accepted; the visible order remains `unknown`, staff receives a handoff, and reconciliation keeps the same key. Receipt keys and payload hashes are unique/checked. Completion updates require the lease token, preventing a superseded worker from overwriting a newer result. This is not a promise of exactly-once delivery for a hypothetical commercial POS.

Accepted-order amendments/cancellation are intentionally **staff handoff only**. The MVP does not provide automatic ticket amendments or real cancellation. Departing the lane revokes the interaction, not the accepted order.

## Persistent records

Restaurant/timezone, lane/epoch, staff roles, menu products (versioned structured JSON including modifiers), interactions, carts/stable lines, quotes, approvals, orders/snapshots, outbox jobs, POS receipts/attempts, handoffs, idempotency hashes and redacted audit events are persisted. Timestamps use `timestamptz`; Harbor Burger's display timezone is America/Los_Angeles. Browser views poll canonical state every second; no cart or transcript is restored from localStorage.
