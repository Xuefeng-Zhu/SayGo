# Correction receipts and equivalent meal savings

The order board shows the latest draft change: affected items, before/after selections, and the exact total difference including fixture tax. Updated rows are highlighted. Receipts survive reloads. **Undo last change** restores the previous selections and stable item IDs once, increments the cart version, and invalidates any previous review. The restored order requires a new review and customer confirmation.

Undo is unavailable after submission, while voice tools are active, during staff handling, or when menu versions or ownership have changed. Only the latest change is undoable; this is not a full order-history editor. Clarification-only/no-op writes clear obsolete receipts. If an old selection cannot be priced, removing it or resetting still works, but no historical price or undo receipt is invented.

For eligible drafts, a **Meal savings** card proposes equivalent groupings of an existing sandwich, medium fries, and the existing drink at its selected size. It shows the old/new totals and savings both before and after fixture tax. **Apply meal savings** is a customer action; the proposal itself never changes the cart. The accepted grouping creates its own receipt and can be undone.

The optimizer finds the maximum number of supported equivalent conversions using the current engine's fixed $1 conversion discount. It preserves quantities and sandwich customizations, handles grouped quantities with stable UUIDs, and leaves existing meals unchanged. It does not add food, change sizes, or substitute products. Modified fries or drinks are excluded because the current meal representation cannot preserve those component choices. This is not a general promotion/coupon optimizer.

## API and MCP

- `find_meal_savings` is the eleventh MCP tool, added in contract 0.5. It takes `{}` and returns `{proposal, summary}`. A proposal contains its identity, cart/menu/price versions, exact totals, savings, and source item groups. A null proposal means no supported equivalent saving is available.
- The full authenticated browser view adds `last_change` and `meal_savings`; existing compact MCP cart responses retain their prior shape.
- `GET /api/lane/meal-savings` is read-only.
- `POST /api/lane/meal-savings/apply` accepts `{proposal_id, expected_version, request_id}`.
- `POST /api/lane/undo` accepts `{receipt_id, expected_version, request_id}`.

Both writes require the authenticated customer, a same-origin request, an editable draft, and idle voice. They accept no client-supplied cart snapshot or price. Acceptance recomputes the proposal inside the transaction; its canonical identity includes the session, staff fence, cart, menu/price versions and exact plan. Stale proposals are rejected. Request IDs make identical retries idempotent, including concurrent retries, and reject reuse with different arguments.

The no-key phrase **Can you make this cheaper?** invokes the real read-only MCP tool. The voice adapter is instructed to use that same tool and direct the customer to the acceptance button. These additions have local software verification only; no new paid model calls or physical voice tests were performed.

## Local verification

October 15, 2026: the isolated feature source passed **91 unit tests, 61 local DynamoDB/MCP integration tests, and seven Chromium journeys**, plus lint, strict TypeScript checks, and production web/runtime/worker compilation. The optional Inspector integration test was skipped. Web compilation used the documented webpack path, and Chromium exercised that production build with `next start`; the default Turbopack production build was not rerun. Unrelated local model-evaluation changes were excluded from this verification.

The exported source reused installed dependencies via symlinks, which Turbopack development resolution rejected. A webpack development diagnostic run passed six journeys but reloaded the customer page when compiling the admin route, clearing the transient review-expiration message. The production run passed all seven journeys, including stock-change recovery, without application changes.

Coverage includes selection/quantity conservation, menu price changes, missing choices, unavailable items, modified drinks/sides, deterministic split UUIDs, receipt persistence, idempotency, competing updates, staff/allergy/voice/submission guards, invalid old-price recovery, authenticated HTTP, strict MCP output schemas and read-only transport recovery.

Chromium journeys exercise correction → receipt → reload → review → Undo → fresh review, meal proposal → explicit acceptance → reload → Undo, and customized-drink exclusion. Desktop and 390px mobile screenshots are kept outside the repository. Existing ordering, kitchen, staff takeover, stock-change and synthetic no-provider voice journeys remain part of the regression suite.
