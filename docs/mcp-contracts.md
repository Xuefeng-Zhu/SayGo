# MCP contracts, version 0.5

## Equivalent meal savings — October 14, 2026

The current catalog has **eleven** tools. Version 0.5 adds read-only `find_meal_savings` with strict `{proposal, summary}` output. It proposes equivalent combinations from the current cart without writing data. Only the authenticated customer screen can accept a proposal, after revalidation against the current cart and menu. Existing ten tool schemas remain unchanged. See [draft improvements](draft-improvements.md) for proposal fields, customer acceptance, persistent receipts and Undo.

## Read-only price comparisons — October 13, 2026

The 0.4 catalog had **ten** tools. `compare_menu_prices` takes one to eight uniquely labeled options, each containing one to ten selections (at most 30 item copies per option). Product IDs, variants and choices come from menu discovery. Missing multi-size variants, required choices, unavailable components and unsupported conversions fail closed. A listed meal chooses its drink through `choices.drink` and now requires `meal_drink_variant: "medium"`. Omitting this size returns `MEAL_SIZE_REQUIRED`; declaring a non-medium listed meal returns `LISTED_MEAL_SIZE`, with instructions naming the eligible standalone base. For a large drink, use that standalone sandwich with `meal: {drink, drink_variant: "large"}`. The tool never silently replaces a declared large drink with medium.

The result contains current `menu_version` / `price_version`, currency, per-option priced lines and totals, and comparisons against the FIRST option. `comparison_kind` defaults to `price_gap`: each comparison has `kind: "price_gap"` and a nonnegative `amount_cents`; no signed delta is exposed. Explicitly request `signed_change` only for a signed later-minus-first change: `amount_cents` and `subtotal_delta_cents` then preserve the sign. Both modes retain `absolute_subtotal_difference_cents` and `more_expensive_label` (null for a tie). Returned lines echo quantity, variant, choices and the actual drink/size with `kind: "listed"` or `"conversion"`. This makes the priced configuration inspectable; it cannot independently infer an unstated customer intent.

Both totals and modifiers use the existing ordering engine, including the simulator's fixture tax. This is an informational read, not a held quote or approval. It respects the same restaurant, lane, session and staff fences, and does not change any persisted entity. **0.4 is a breaking revision to the 0.3 comparison input/output:** clients must declare listed-meal size, read `amount_cents`, and explicitly select signed mode when needed. The other nine tools and result envelopes are unchanged.

Example input:

```json
{
  "options": [
    {
      "label": "baseline",
      "selections": [
        {
          "product_id": "cheeseburger-meal",
          "meal_drink_variant": "medium",
          "choices": { "drink": ["cola"] }
        }
      ]
    },
    {
      "label": "upgraded",
      "selections": [
        {
          "product_id": "cheeseburger-meal",
          "meal_drink_variant": "medium",
          "choices": { "drink": ["lemonade"] }
        }
      ]
    }
  ]
}
```

The MCP-builder guide informed the workflow tool, strict schema validation, read-only annotations and independently verifiable evaluations. Primary references: [MCP tools and structured results](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [pinned SDK generation](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x), and [Nova Converse reasoning/tool use](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-converse-api.html). The repository's SDK generation was retained; this is not a v2 migration.

## Historical 0.2 contract changes

The original nine tools still run through the authenticated Streamable HTTP endpoint. The historical 0.2 revision below changed their data contract; it did not add a transport, OAuth, a deployment, or live provider verification. Its PostgreSQL migration notes describe the old storage layer; current setup and import guidance is in [DynamoDB](dynamodb.md).

## Upgrade notes

Run `pnpm db:migrate` before starting the updated runtime. Migration `0003.sql` adds nullable review-request metadata and a unique constraint without discarding existing quotes. It has been applied locally to `saygo_demo` and the isolated `saygo_test` database.

Direct MCP clients must adapt to both changes below. SayGo's bundled client, fixture runner, Nova adapter and browser gateway have been updated together.

1. `prepare_order_review` now requires `request_id`, a UUID, as well as `expected_version`.
2. `structuredContent` and the JSON text content now contain the same strict envelope:

```json
{
  "result": {
    "ok": true,
    "data": { "order": null, "summary": "No order has been submitted." }
  }
}
```

This is an illustrative `get_order_status` success, with `isError: false`. On execution failure, `result` instead contains `ok: false` and `error`, and the MCP response sets `isError: true`. Both variants conform to that tool's advertised `outputSchema`. Unknown tool names remain protocol errors.

The bundled `openMcp().call()` validates the envelope, unwraps `result.data`, and adds local `timing.tool_ms`. That timing field is not part of the MCP wire payload. Failure throws `McpCallError` with a validated `.recovery` object. Invalid result schemas or contradictory error flags fail closed.

## Per-tool success data

| Tool                             | Data                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `get_menu`                       | Full menu and summary; the dedicated operation for menu discovery.                                                                  |
| `get_item_details`               | One complete product and summary.                                                                                                   |
| `get_cart`, `apply_cart_changes` | Versions, priced lines, integer-cent totals, unresolved choices, ownership/review flags, optional quote, compact order and summary. |
| `prepare_order_review`           | Non-null quote with exact snapshot, expiry and approval state; summary.                                                             |
| `submit_order`                   | Non-null compact order and summary.                                                                                                 |
| `get_order_status`               | Nullable compact order and summary only.                                                                                            |
| `request_staff_help`             | Ownership and staff-review flags; summary.                                                                                          |
| `cancel_draft_order`             | Cart version, proposed reset token and summary. Only the customer action can confirm reset.                                         |

Compact orders include identity, number, status, timestamps and payment-due status. They exclude the order snapshot. Cart responses no longer repeat the menu, raw cart or internal session/fence data. Every object shape is strict, including nested products, quotes and orders. Money is integer USD cents; timestamps are ISO strings.

The authenticated browser gateway fetches the full canonical `View` separately after an MCP action. Menu rendering, quote confirmation and kitchen details therefore do not depend on overloading every MCP response with UI state. The integration fixture asserts that its compact cart data is less than half the serialized full view; this is a fixture-specific payload comparison, not a model-token benchmark.

## Durable review request identity

Generate one UUID for a new review intent and retain it with the exact arguments until its outcome is known. The database records the session, actor, request ID and canonical argument hash under a unique index, inside the domain transaction.

- Concurrent identical requests return one still-valid quote with the same expiry.
- Retrying an already approved, still-valid review preserves approval; it does not recreate consent.
- If a response is lost after commit, a fresh MCP client can reuse the original arguments and request ID to recover that same quote.
- Different arguments under the same identity are rejected with `IDEMPOTENCY_MISMATCH`.
- An expired or invalidated quote is never resurrected. Cart/menu changes and ownership fences are rechecked. Refresh canonical state and use a new request ID for a genuinely new review, followed by fresh customer approval.
- Once an order exists, the draft review operation remains blocked. Reconcile the existing order rather than creating another review.

Submission still uses the original approved `quote_id` as its retry identity. A timeout or lost response is not evidence of rollback. The agent cannot approve a quote or grant itself staff control.

## Recovery metadata

```json
{
  "result": {
    "ok": false,
    "error": {
      "code": "VERSION_CONFLICT",
      "message": "Refresh the cart before making another change.",
      "retryable": false,
      "next_action": "refresh_cart"
    }
  }
}
```

Messages are user-facing; automation should branch on `code` and `next_action`. `retryable` describes whether an identical request can be retried now, not whether eventual recovery is possible. Writes are never automatically replayed by this client.

| Condition                               | Next action                                           |
| --------------------------------------- | ----------------------------------------------------- |
| Stale cart version                      | `refresh_cart`                                        |
| Expired/invalid quote                   | `review_order` with a new review request ID           |
| Missing customer approval               | `confirm_order` via the customer UI                   |
| Staff fence or unresolved staff concern | `wait_for_staff`                                      |
| Invalid arguments                       | `correct_arguments` using the advertised input schema |
| Lost submit response                    | `reconcile_order`, retaining the original quote ID    |
| Lost read response                      | `retry_read` if the session remains active            |

HTTP auth/domain failures and rate limiting also preserve recovery metadata. A rate-limited response includes `retry_after_ms` and `Retry-After`; wait and reconcile before considering a write retry. The Nova adapter forwards the structured recovery object instead of flattening it to a generic string. Raw malformed inputs are not echoed, and unexpected server errors do not expose internals.

## Verification and boundaries

The subsequent [MCP guide review](mcp-best-practices-review.md) adds transport/authentication edge-case checks, clearer discovery metadata, ten read-only evaluation questions and independent Inspector verification. It expands the suite to 70 passing tests; the paragraph below records the initial contract 0.2 verification.

Locally verified October 10, 2026 Pacific: 23 unit tests, 28 PostgreSQL/real-HTTP-MCP integration tests and 3 Chromium browser tests; lint, strict typechecking and the optimized web/runtime/worker build pass. A temporary compiled runtime on port 3112 returned healthy with sandbox POS and voice disabled, then exited cleanly.

New checks cover every tool's success schema, strict/error schema validation, compact projections, concurrent review retries, post-commit response loss followed by a fresh client, approval/expiry preservation, changed request payloads, expired/invalidated quotes, ownership fences and structured Nova recovery events. Browser regression covers order/review/confirmation/kitchen/reload, staff takeover, and stock-change recovery. The review screenshot was inspected after the run.

The build initially failed because Turbopack could not resolve a `.js` re-export of a source-only TypeScript module. The shared package now uses the extensionless import supported by this repository's bundler configuration; the successful build and browser run occurred after that repair.

No live Bedrock request, acoustic test, native Alexa integration, commercial POS, OAuth interoperability, deployment or repository publication was performed. See [evaluation](evaluation.md) for evidence and operating limits. Protocol reference: [official MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
