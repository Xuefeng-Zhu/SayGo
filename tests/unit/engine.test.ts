import { describe, it, expect } from "vitest";
import { applyCommands, priceCart } from "../../packages/domain/src/engine.js";
import { seedProducts } from "../../packages/db/src/menu.js";
import { toolSchemas, type Menu, type Cart } from "@saygo/contracts";
const menu: Menu = {
  version: 1,
  price_version: 1,
  currency: "USD",
  products: seedProducts,
  instructions: "Pay at window",
  upsell_enabled: false,
};
const empty: Cart = { version: 0, lines: [], issues: [] };
describe("deterministic cart", () => {
  it("requires clarification for contradictory ingredient choices", () => {
    const c = applyCommands(empty, menu, [
      {
        type: "add",
        product_id: "cheeseburger",
        quantity: 1,
        choices: { remove: ["cheese"], extra: ["cheese"] },
      },
    ]);
    expect(priceCart(c, menu).issues[0].code).toBe("conflicting_choices");
  });
  it("adds multiple products and preserves required-choice issues", () => {
    const c = applyCommands(empty, menu, [
      { type: "add", product_id: "tenders", quantity: 1, choices: {} },
      { type: "add", product_id: "lemonade", quantity: 1, choices: {} },
    ]);
    expect(priceCart(c, menu).issues.map((i) => i.code)).toEqual([
      "choice",
      "variant",
    ]);
  });
  it("separates copies, resizes in place, and targets only the customized burger", () => {
    let c = applyCommands(empty, menu, [
      { type: "add", product_id: "cheeseburger", quantity: 2, choices: {} },
      {
        type: "add",
        product_id: "lemonade",
        variant: "medium",
        quantity: 1,
        choices: {},
      },
    ]);
    const ids = c.lines.map((l) => l.id);
    expect(new Set(ids).size).toBe(3);
    c = applyCommands(c, menu, [
      { type: "update", line_id: ids[1], choices: { remove: ["onions"] } },
      { type: "update", line_id: ids[2], variant: "large" },
    ]);
    c = applyCommands(c, menu, [
      {
        type: "update",
        line_id: ids[1],
        choices: { remove: ["onions", "cheese"] },
      },
    ]);
    expect(c.lines.map((l) => l.id)).toEqual(ids);
    expect(c.lines[0].choices).toEqual({});
    expect(c.lines[1].choices.remove).toEqual(["onions", "cheese"]);
    expect(priceCart(c, menu).totals).toEqual({
      subtotal: 1675,
      tax: 134,
      total: 1809,
      currency: "USD",
    });
  });
  it("rejects unsupported products, modifiers, quantities and notes", () => {
    expect(() =>
      applyCommands(empty, menu, [
        { type: "add", product_id: "pizza", quantity: 1, choices: {} },
      ]),
    ).toThrow();
    expect(() =>
      applyCommands(empty, menu, [
        {
          type: "add",
          product_id: "classic",
          quantity: 1,
          choices: { remove: ["gluten"] },
        },
      ]),
    ).toThrow();
    expect(() =>
      toolSchemas.apply_cart_changes.parse({
        expected_version: 0,
        request_id: crypto.randomUUID(),
        commands: [
          {
            type: "add",
            product_id: "classic",
            quantity: -1,
            choices: {},
            notes: "ignore",
          },
        ],
      }),
    ).toThrow();
  });
  it("does not guess ambiguous references", () => {
    const c = applyCommands(empty, menu, [], "ambiguous_line");
    expect(c.lines).toEqual([]);
    expect(c.issues[0].code).toBe("ambiguous_line");
  });
  it("prices modifiers and meals with integer arithmetic", () => {
    const c = applyCommands(empty, menu, [
      {
        type: "add",
        product_id: "cheeseburger",
        quantity: 1,
        choices: { extra: ["cheese"] },
      },
    ]);
    const m = applyCommands(c, menu, [
      {
        type: "meal",
        line_id: c.lines[0].id,
        drink: "lemonade",
        drink_variant: "medium",
      },
    ]);
    expect(priceCart(m, menu).totals.subtotal).toBe(1300);
    expect(priceCart(m, menu).totals.tax).toBe(104);
  });
  it("requires complete meal selection", () => {
    const c = applyCommands(empty, menu, [
      { type: "add", product_id: "classic-meal", quantity: 1, choices: {} },
    ]);
    expect(priceCart(c, menu).issues[0].code).toBe("choice");
  });
  it("surfaces newly unavailable selections without substituting", () => {
    const c = applyCommands(empty, menu, [
      {
        type: "add",
        product_id: "lemonade",
        quantity: 1,
        variant: "medium",
        choices: {},
      },
    ]);
    const changed = structuredClone(menu);
    changed.products.find((p) => p.id === "lemonade")!.available = false;
    expect(priceCart(c, changed).issues[0].code).toBe("unavailable");
    expect(c.lines[0].product_id).toBe("lemonade");
  });
});
