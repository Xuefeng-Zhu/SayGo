import { describe, expect, it } from "vitest";
import {
  menuPriceInputSchema,
  toolDataSchemas,
  type Menu,
} from "@saygo/contracts";
import { compareMenuPrices } from "../../packages/domain/src/menu-prices.js";
import { seedProducts } from "../../packages/db/src/menu.js";
import {
  menuPriceGuidance,
  menuAnswerFormatGuidance,
  validMenuAnswerFormat,
} from "../../packages/integrations/src/menu-guidance.js";

const menu: Menu = {
  version: 7,
  price_version: 11,
  currency: "USD",
  products: seedProducts,
  instructions: "Fictional",
  upsell_enabled: false,
};
const price = (options: unknown[]) => compareMenuPrices(menu, { options });
const meal = (drink: string) => [
  { product_id: "cheeseburger-meal", choices: { drink: [drink] } },
];

describe("read-only menu price comparisons", () => {
  it("uses a positive upgraded-minus-baseline difference and current versions", () => {
    const result = price([
      { label: "cola", selections: meal("cola") },
      { label: "lemonade", selections: meal("lemonade") },
    ]);
    expect(result).toMatchObject({
      menu_version: 7,
      price_version: 11,
      baseline_label: "cola",
      comparisons: [{ label: "lemonade", subtotal_delta_cents: 50 }],
    });
    expect(result.options.map((o) => o.totals.subtotal)).toEqual([1175, 1225]);
    expect(result.comparisons[0]).toMatchObject({
      absolute_subtotal_difference_cents: 50,
      more_expensive_label: "lemonade",
    });
    expect(result.summary).toContain("lemonade costs 50 cents MORE than cola");
    expect(toolDataSchemas.compare_menu_prices.safeParse(result).success).toBe(
      true,
    );
    expect(result).not.toHaveProperty("quote");
    expect(result).not.toHaveProperty("approved");
  });
  it("preserves negative savings rather than forcing an absolute value", () => {
    const result = price([
      { label: "lemonade", selections: meal("lemonade") },
      { label: "cola", selections: meal("cola") },
    ]).comparisons[0];
    expect(result.subtotal_delta_cents).toBe(-50);
    expect(result).toMatchObject({
      absolute_subtotal_difference_cents: 50,
      more_expensive_label: "lemonade",
    });
  });
  it("represents tied prices with zero difference and no costlier option", () => {
    expect(
      price([
        { label: "a", selections: [{ product_id: "tea", variant: "large" }] },
        { label: "b", selections: [{ product_id: "cola", variant: "large" }] },
      ]).comparisons[0],
    ).toMatchObject({
      subtotal_delta_cents: 0,
      absolute_subtotal_difference_cents: 0,
      more_expensive_label: null,
    });
  });
  it("uses modifier, quantity and tax arithmetic from the ordering engine", () => {
    const result = price([
      {
        label: "two",
        selections: [
          { product_id: "double", quantity: 2, choices: { extra: ["cheese"] } },
        ],
      },
    ]);
    expect(result.options[0].totals).toEqual({
      subtotal: 1900,
      tax: 152,
      total: 2052,
      currency: "USD",
    });
    expect(result.options[0].lines).toHaveLength(2);
  });
  it("prices standalone sandwich meal conversion for every selected copy", () => {
    const result = price([
      {
        label: "two",
        selections: [
          {
            product_id: "classic",
            quantity: 2,
            meal: { drink: "lemonade", drink_variant: "large" },
          },
        ],
      },
    ]);
    expect(result.options[0].totals.subtotal).toBe(2400);
    expect(result.options[0].lines.map((l) => l.unit_price)).toEqual([
      1200, 1200,
    ]);
  });
  it("does not modify the supplied menu and produces stable results", () => {
    const before = structuredClone(menu);
    const options = [{ label: "snack", selections: [{ product_id: "slaw" }] }];
    expect(price(options)).toEqual(price(options));
    expect(menu).toEqual(before);
  });
  it.each([
    [{ product_id: "tenders" }],
    [{ product_id: "lemonade" }],
    [{ product_id: "classic-meal" }],
    [
      {
        product_id: "classic",
        choices: { remove: ["onions"], extra: ["onions"] },
      },
    ],
    [{ product_id: "tea", variant: "enormous" }],
    [{ product_id: "not-listed" }],
    [
      {
        product_id: "classic-meal",
        choices: { drink: ["cola"] },
        meal: { drink: "cola", drink_variant: "medium" },
      },
    ],
  ])("refuses invalid or incomplete selections: %j", (...selections) => {
    expect(() => price([{ label: "invalid", selections }])).toThrow();
  });
  it("refuses unavailable components instead of quoting partial prices", () => {
    const unavailable = structuredClone(menu);
    unavailable.products.find((p) => p.id === "cola")!.available = false;
    expect(() =>
      compareMenuPrices(unavailable, {
        options: [{ label: "meal", selections: meal("cola") }],
      }),
    ).toThrow();
  });
  it("bounds candidates, selections and total quantity, and rejects consent fields", () => {
    const option = { label: "a", selections: [{ product_id: "slaw" }] };
    for (const input of [
      { options: [] },
      { options: [option, option] },
      {
        options: Array.from({ length: 9 }, (_, i) => ({
          ...option,
          label: "x" + i,
        })),
      },
      {
        options: [
          { ...option, selections: [{ product_id: "slaw", approved: true }] },
        ],
      },
    ])
      expect(menuPriceInputSchema.safeParse(input).success).toBe(false);
    expect(() =>
      price([
        {
          label: "large",
          selections: Array.from({ length: 4 }, () => ({
            product_id: "slaw",
            quantity: 10,
          })),
        },
      ]),
    ).toThrow("30 items");
  });
});

describe("menu answer guidance and validation", () => {
  it("states comparison direction and comma-within-field rules without fixture answers", () => {
    expect(menuPriceGuidance).toContain("changed minus reference");
    expect(menuAnswerFormatGuidance).toContain("never with |");
    for (const secret of ["1225", "1175", "cola,tea", "lemonade-meal-upgrade"])
      expect(menuPriceGuidance + menuAnswerFormatGuidance).not.toContain(
        secret,
      );
  });
  it("validates raw syntax without repairing answers or checking the oracle", () => {
    for (const good of [
      "cola,tea|325|50",
      "garden:no|cheeseburger:yes|0",
      "1225|-50",
    ])
      expect(validMenuAnswerFormat(good)).toBe(true);
    for (const bad of [
      "",
      "`cola,tea|325|50`",
      "cola,tea | 325 | 50",
      "cola,tea|$3.25|50",
      "a||b",
      "a,b,|1",
    ])
      expect(validMenuAnswerFormat(bad)).toBe(false);
  });
});
