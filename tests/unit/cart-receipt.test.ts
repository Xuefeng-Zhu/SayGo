import { describe, expect, it } from "vitest";
import type { Cart, Menu } from "@saygo/contracts";
import { cartReceipt } from "@saygo/domain";
import { seedProducts } from "../../packages/db/src/menu.js";

const menu: Menu = {
  version: 1,
  price_version: 1,
  currency: "USD",
  products: seedProducts,
  instructions: "",
  upsell_enabled: false,
};
const metadata = {
  id: "receipt",
  kind: "correction" as const,
  created_at: "2026-10-15T00:00:00.000Z",
};
const before: Cart = {
  version: 1,
  issues: [],
  lines: [
    {
      id: "drink",
      product_id: "lemonade",
      variant: "medium",
      quantity: 1,
      choices: {},
    },
    {
      id: "burger",
      product_id: "cheeseburger",
      variant: "regular",
      quantity: 1,
      choices: { remove: ["onions"] },
    },
  ],
};
describe("stable correction receipts", () => {
  it("includes only changed identities, their exact prices and the tax-inclusive difference", () => {
    const after = structuredClone(before);
    after.version++;
    after.lines[0].variant = "large";
    const result = cartReceipt(before, after, menu, metadata)!;
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      line_id: "drink",
      before: { variant: "medium" },
      after: { variant: "large" },
    });
    expect(result.total_delta_cents).toBe(
      result.after_totals.total - result.before_totals.total,
    );
    expect(result.total_delta_cents).toBe(54);
    expect(result.cart_version).toBe(2);
    expect(result.undo_available).toBe(false);
  });
  it("preserves added and removed identities rather than matching duplicate products", () => {
    const after = structuredClone(before);
    after.version++;
    after.lines[0].id = "replacement-drink";
    const result = cartReceipt(before, after, menu, metadata)!;
    expect(result.changes).toMatchObject([
      { line_id: "drink", before: { id: "drink" }, after: null },
      {
        line_id: "replacement-drink",
        before: null,
        after: { id: "replacement-drink" },
      },
    ]);
    expect(result.total_delta_cents).toBe(0);
  });
  it("suppresses no-op and clarification-only receipts", () => {
    expect(
      cartReceipt(
        before,
        {
          ...before,
          version: 2,
          issues: [{ code: "ambiguous", message: "Which one?" }],
        },
        menu,
        metadata,
      ),
    ).toBeNull();
  });
  it("allows removing an unpriceable old meal but never accepts unpriceable new contents", () => {
    const changedMenu = structuredClone(menu);
    for (const product of changedMenu.products)
      product.variants = Object.fromEntries(
        Object.keys(product.variants).map((variant) => [variant, 0]),
      );
    const invalid: Cart = {
      version: 2,
      issues: [],
      lines: [
        {
          id: "meal",
          product_id: "classic",
          variant: "regular",
          quantity: 1,
          choices: {},
          meal: { drink: "cola", drink_variant: "medium" },
        },
      ],
    };
    const empty: Cart = { version: 3, issues: [], lines: [] };
    expect(cartReceipt(invalid, empty, changedMenu, metadata)).toBeNull();
    expect(() => cartReceipt(empty, invalid, changedMenu, metadata)).toThrow(
      "staff price review",
    );
  });
});
