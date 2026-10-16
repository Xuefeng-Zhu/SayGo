import type { Cart, CartReceipt, Menu } from "@saygo/contracts";
import { DomainError, priceCart } from "./engine.js";

/** Compare stable item identities, preserving the prices displayed at the change. */
export function cartReceipt(
  before: Cart,
  after: Cart,
  menu: Menu,
  metadata: Pick<CartReceipt, "id" | "kind" | "created_at">,
): CartReceipt | null {
  const next = priceCart(after, menu);
  let old: ReturnType<typeof priceCart>;
  try {
    old = priceCart(before, menu);
  } catch (error) {
    // Current menu edits can make a saved draft unpriceable. Removing that
    // item must still work; omit historical prices and undo rather than
    // inventing them. The new cart's pricing above must always succeed.
    if (error instanceof DomainError) return null;
    throw error;
  }
  const ids = new Set([...old.lines, ...next.lines].map((line) => line.id));
  const changes: CartReceipt["changes"] = [];
  for (const line_id of ids) {
    const a = old.lines.find((line) => line.id === line_id) ?? null;
    const b = next.lines.find((line) => line.id === line_id) ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b))
      changes.push({ line_id, before: a, after: b });
  }
  if (!changes.length) return null;
  return {
    ...metadata,
    cart_version: after.version,
    changes,
    before_totals: old.totals,
    after_totals: next.totals,
    total_delta_cents: next.totals.total - old.totals.total,
    undo_available: false,
  };
}
