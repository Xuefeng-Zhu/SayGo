# MCP contracts, version 0.5

## Client reference

The runtime advertises server version **0.5.0** and eleven tools. See [tool inputs](../packages/contracts/src/index.ts), [result schemas](../packages/contracts/src/mcp.ts) and [server registration](../apps/runtime/src/mcp.ts). Inputs and nested outputs reject extra fields, including fields copied from the browser view.

### Transport and authentication

- Connect to `POST http://127.0.0.1:3101/mcp` by default; `SAYGO_RUNTIME_PORT` selects a different port. The runtime binds to loopback.
- Initialize the Streamable HTTP client, list tools, then call a tool. The server uses stateless JSON responses and issues no MCP session ID. Other HTTP methods return `405` with `Allow: POST`.
- Send `Authorization: Bearer <scoped-agent-token>` on every request. The runtime creates short-lived credentials scoped to a restaurant, lane, interaction epoch and staff ownership version. Reads also check authentication and ownership. Customer/staff cookies cannot authenticate MCP requests. Public token issuance and OAuth discovery are unavailable.
- Send one JSON-RPC message per POST, with a maximum JSON body of 64 KiB. Batches are rejected. Host must match the configured runtime or web host; if Origin is present, it must match `SAYGO_WEB_ORIGIN`.
- `tools/list` returns the complete catalog without a cursor. Supplying a cursor is an error. An unsupported explicit `MCP-Protocol-Version` is rejected. The server exposes tools only, with no resources or prompts.

The bundled [MCP client](../packages/integrations/src/mcp-client.ts) manages initialization and discovery. Its `openMcp(token)` helper connects to the configured local runtime; `call(name, arguments)` validates and unwraps results, and `close()` releases the client. Never log credentials or copy them into a tool argument.

### Tool catalog

All tools return a `summary` alongside the data below. “Read” means the operation does not change the draft or grant consent; it still requires a valid scoped interaction. The server enforces authorization independently of tool annotations.

| Tool                   | Input                                                                  | Success data and effect                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_menu`             | `{}`                                                                   | Read: full menu, prices, availability and allowed choices.                                                                                                |
| `get_item_details`     | `product_id`                                                           | Read: one complete product. Discover IDs through the menu.                                                                                                |
| `compare_menu_prices`  | `options`; optional `comparison_kind`                                  | Read: hypothetical priced selections, menu/price versions, totals and comparisons. See [comparison rules](#read-only-price-comparisons--october-13-2026). |
| `find_meal_savings`    | `{}`                                                                   | Read: equivalent-cart `proposal` or null. Customer acceptance is a separate action.                                                                       |
| `get_cart`             | `{}`                                                                   | Read: versions, priced lines, totals, unresolved choices, control flags, nullable quote and compact order.                                                |
| `apply_cart_changes`   | `expected_version`, `request_id`, `commands`; optional `clarification` | Atomic draft write; returns the same compact shape as `get_cart`. Reuse the exact request after an uncertain outcome.                                     |
| `prepare_order_review` | `expected_version`, `request_id`                                       | Non-null quote with exact snapshot, expiry and approval state. Identical valid retries retain expiry and approval.                                        |
| `submit_order`         | `quote_id`                                                             | Non-null compact order. Requires existing customer approval; retry identity is the same quote ID.                                                         |
| `get_order_status`     | `{}`                                                                   | Read: nullable compact order. `submitted` and `unknown` do not establish restaurant acceptance.                                                           |
| `request_staff_help`   | `reason`; optional `concern`                                           | Writes a staff handoff and fences the agent; returns ownership and staff-review flags.                                                                    |
| `cancel_draft_order`   | `expected_version`; agents omit `reset_token`                          | Proposes a reset and returns its token. Only the customer reset action can consume it.                                                                    |

Cart commands are `add`, `update`, `remove` and `meal`, with at most 20 commands per atomic batch. Target exact stable line IDs from `get_cart`. An `update.choices` value replaces the whole choices map, so preserve wanted groups; `{}` clears them. For an ambiguous target or unsupported change, send `commands: []` with the appropriate `clarification` instead of guessing. Cart-change and review `request_id` values are caller-generated UUIDs; keep the same ID and arguments until the outcome is known.

### Customer actions outside MCP

The ordering flow is menu/cart discovery → cart changes → exact review → customer approval → order status check. `POST /api/lane/confirm` records customer approval and then calls `submit_order` through MCP. The approval route uses the authenticated customer cookie and checks idle voice, quote expiry and current state; an agent cannot approve its own quote.

The [sealed spoken confirmation flow](voice.md#spoken-order-approval) offers a second approval path. The server checks the completed recording against the readback and current quote. After the provider stream ends naturally, it records consent, releases the connection's voice lease and executes the retained `submit_order` request through MCP. The input remains `quote_id`; transcripts and approval flags cannot grant consent. `PENDING_VERIFICATION` means the request is waiting for these checks and has not called MCP or submitted an order.

`POST /api/lane/reset` consumes a customer-approved reset token. `POST /api/lane/meal-savings/apply` and `POST /api/lane/undo` accept displayed proposal/receipt identities and current versions. These same-origin customer routes are implemented in [runtime routes](../apps/runtime/src/app.ts) and are separate from the MCP catalog. See [draft improvements](draft-improvements.md) for their inputs and retry behavior. Browser actions retrieve the full current `View` separately from the compact MCP response.

## Result envelope and client validation

The bundled client, fixture runner, Nova adapter and browser gateway share the same contracts. `structuredContent` and the JSON text content contain the same strict envelope:

```json
{
  "result": {
    "ok": true,
    "data": { "order": null, "summary": "No order has been submitted." }
  }
}
```

This is an illustrative `get_order_status` success, with `isError: false`. On execution failure, `result` instead contains `ok: false` and `error`, and the MCP response sets `isError: true`. Both variants conform to that tool's advertised `outputSchema`. Unknown tool names remain protocol errors.

The bundled `openMcp().call()` validates the envelope, unwraps `result.data`, and adds local `timing.tool_ms`. That timing field is not part of the MCP wire payload. Failure throws `McpCallError` with a validated `.recovery` object. Invalid results or contradictory error flags are rejected.

Compact orders include identity, number, status, timestamps and payment-due status. They exclude the order snapshot. Cart responses no longer repeat the menu, raw cart or internal session/fence data. Every object shape is strict, including nested products, quotes and orders. Money is integer USD cents; timestamps are ISO strings.

The authenticated browser gateway fetches the full `View` after an MCP action for menu, confirmation and kitchen rendering. In the integration fixture, the compact cart payload is less than half the serialized full view. That measurement applies to the fixture payload; model-token usage was not measured.

## Durable review request identity

Generate one UUID for a new review intent and retain it with the exact arguments until its outcome is known. The domain transaction stores an idempotency record linking the session, actor and request ID to the argument hash and quote ID. The DynamoDB implementation uses a deterministic record key.

- Concurrent identical requests return one still-valid quote with the same expiry.
- Retrying an already approved, still-valid review preserves approval; it does not recreate consent.
- If a response is lost after commit, a fresh MCP client can reuse the original arguments and request ID to recover that same quote.
- Different arguments under the same identity are rejected with `IDEMPOTENCY_MISMATCH`.
- An expired or invalidated quote is never resurrected. Cart/menu changes and ownership fences are rechecked. Refresh state, use a new request ID for the new review and obtain fresh customer approval.
- Once an order exists, the draft review operation remains blocked. Reconcile the existing order rather than creating another review.

Submission uses the approved `quote_id` as its retry identity. A timeout or lost response is not evidence of rollback. The agent cannot approve a quote or grant itself staff control.

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

Show `message` to the user; branch on `code` and `next_action`. `retryable` describes whether an identical request can be retried now, not whether eventual recovery is possible. Writes are never automatically replayed by this client.

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

## Equivalent meal savings — October 14, 2026

Version 0.5 adds read-only `find_meal_savings`, bringing the catalog to eleven tools. Its strict `{proposal, summary}` output proposes equivalent combinations from the current cart without writing data. Only the authenticated customer screen can accept a proposal, after revalidation against the current cart and menu. Existing ten tool schemas remain unchanged. See [draft improvements](draft-improvements.md) for proposal fields, customer acceptance, persistent receipts and Undo.

## Read-only price comparisons — October 13, 2026

The 0.4 catalog had **ten** tools. `compare_menu_prices` takes one to eight uniquely labeled options, each containing one to ten selections (at most 30 item copies per option). Product IDs, variants and choices come from menu discovery. Missing multi-size variants or required choices, unavailable components and unsupported conversions are rejected. A listed meal chooses its drink through `choices.drink` and now requires `meal_drink_variant: "medium"`. Omitting this size returns `MEAL_SIZE_REQUIRED`; declaring a non-medium listed meal returns `LISTED_MEAL_SIZE`, with instructions naming the eligible standalone base. For a large drink, use that standalone sandwich with `meal: {drink, drink_variant: "large"}`. The tool never silently replaces a declared large drink with medium.

The result contains current `menu_version` / `price_version`, currency, per-option priced lines and totals, and comparisons against the first option. `comparison_kind` defaults to `price_gap`: each comparison has `kind: "price_gap"` and a nonnegative `amount_cents`; no signed delta is exposed. Explicitly request `signed_change` only for a signed later-minus-first change: `amount_cents` and `subtotal_delta_cents` then preserve the sign. Both modes retain `absolute_subtotal_difference_cents` and `more_expensive_label` (null for a tie). Returned lines echo quantity, variant, choices and the actual drink/size with `kind: "listed"` or `"conversion"`. Clients can inspect the exact configuration that was priced.

The October 14 text-only follow-up added both labeled equations to the signed comparison's `summary`: later option minus baseline, and baseline minus later option. Both are computed from the same authoritative subtotals. Clients should match the requested subtraction to those labels; `amount_cents` and `subtotal_delta_cents` still mean later-minus-first. That follow-up preserved numeric fields, input/output schemas, unsigned price-gap summaries and the then-current contract version **0.4**. The current 0.5 catalog adds the separate savings tool described above.

Totals and modifiers use the ordering engine, including fixture tax. The tool checks restaurant, lane, session and staff ownership, changes no stored data and reserves no price or approval. **0.4 is a breaking revision to the 0.3 comparison input/output:** clients must declare listed-meal size, read `amount_cents`, and explicitly select signed mode when needed. The other nine tools and result envelopes are unchanged.

Shared price guidance matches signed operands and preserves product identity across before/after modifications. The saved [Sonic receipt](evidence/live-voice-sonic-v4-i-20261014.json) predates that guidance and the signed summaries. Sonic was not rerun for the text-only follow-up; see [voice verification](voice.md).

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

Protocol and SDK references: [MCP tools and structured results](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [pinned SDK generation](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x), and [Nova Converse reasoning/tool use](https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-converse-api.html). The repository retains SDK v1.

## Historical 0.2 contract update

The original nine tools used the same authenticated Streamable HTTP endpoint. Revision 0.2 introduced the required review `request_id` and strict result envelope retained above; it did not add OAuth, deployment or live provider verification.

## Historical verification and boundaries

The later [MCP guide review](mcp-best-practices-review.md) added transport/authentication tests, discovery metadata, ten read-only evaluation questions and Inspector checks, bringing the suite to 70 passing tests. The results below describe the initial 0.2 checkpoint.

At the initial contract 0.2 checkpoint on October 10, 2026 Pacific, lint, strict typechecking and the optimized web/runtime/worker build passed. A temporary compiled runtime on port 3112 returned healthy with sandbox POS and voice disabled, then exited cleanly.

Tests covered every tool's success schema, strict/error schemas, compact results, concurrent review retries, response loss followed by a fresh client, approval/expiry preservation, changed payloads, expired/invalidated quotes, ownership fences and structured Nova recovery. Browser tests covered ordering, review, confirmation, kitchen, reload, staff takeover and stock-change recovery. The review screenshot was inspected.

The build initially failed because Turbopack could not resolve a `.js` re-export of a source-only TypeScript module. The shared package now uses the extensionless import supported by this repository's bundler configuration; the successful build and browser run occurred after that repair.

At the October 10 checkpoint, Bedrock, physical audio, native Alexa, commercial POS, OAuth interoperability, deployment and repository publication were untested. See [evaluation](evaluation.md) for later results.
