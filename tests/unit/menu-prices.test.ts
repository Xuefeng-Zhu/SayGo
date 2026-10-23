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
const price = (options: unknown[], comparison_kind = "price_gap") =>
  compareMenuPrices(menu, { options, comparison_kind });
const meal = (drink: string) => [
  {
    product_id: "cheeseburger-meal",
    meal_drink_variant: "medium",
    choices: { drink: [drink] },
  },
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
      comparisons: [{ label: "lemonade", kind: "price_gap", amount_cents: 50 }],
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
  it.each([
    { cola: 225, lemonade: 275, change: 50 },
    { cola: 461, lemonade: 278, change: -183 },
    { cola: 324, lemonade: 324, change: 0 },
  ])(
    "reports both signed directions using current prices ($cola, $lemonade)",
    ({ cola, lemonade, change }) => {
      const current = structuredClone(menu);
      current.products.find((p) => p.id === "cola")!.variants.small = cola;
      current.products.find((p) => p.id === "lemonade")!.variants.small =
        lemonade;
      const before = structuredClone(current);
      const options = [
        {
          label: "cedar",
          selections: [{ product_id: "cola", variant: "small" }],
        },
        {
          label: "maple",
          selections: [{ product_id: "lemonade", variant: "small" }],
        },
      ];
      for (const reversed of [false, true]) {
        const result = compareMenuPrices(current, {
          comparison_kind: "signed_change",
          options: reversed ? [...options].reverse() : options,
        });
        const amount = change === 0 ? 0 : reversed ? -change : change;
        const reverseAmount = amount === 0 ? 0 : -amount;
        const baseline = reversed ? "maple" : "cedar";
        const compared = reversed ? "cedar" : "maple";
        expect(result.comparisons).toEqual([
          {
            label: compared,
            kind: "signed_change",
            amount_cents: amount,
            subtotal_delta_cents: amount,
            absolute_subtotal_difference_cents: Math.abs(change),
            more_expensive_label:
              change === 0 ? null : change > 0 ? "maple" : "cedar",
          },
        ]);
        expect(result.baseline_label).toBe(baseline);
        expect(result.summary).toContain(
          `${compared} minus ${baseline} = ${amount} cents; ${baseline} minus ${compared} = ${reverseAmount} cents.`,
        );
        expect(result.summary).not.toContain("-0 cents");
        expect(
          toolDataSchemas.compare_menu_prices.safeParse(result).success,
        ).toBe(true);
      }
      expect(current).toEqual(before);
    },
  );
  it("represents tied prices with zero difference and no costlier option", () => {
    expect(
      price([
        { label: "a", selections: [{ product_id: "tea", variant: "large" }] },
        { label: "b", selections: [{ product_id: "cola", variant: "large" }] },
      ]).comparisons[0],
    ).toMatchObject({
      amount_cents: 0,
      absolute_subtotal_difference_cents: 0,
      more_expensive_label: null,
    });
  });
  it("cannot expose a negative signed delta in an unsigned premium response", () => {
    const result = price([
      { label: "high", selections: meal("lemonade") },
      { label: "low", selections: meal("cola") },
    ]);
    expect(result.comparisons[0]).toMatchObject({
      kind: "price_gap",
      amount_cents: 50,
    });
    expect(result.comparisons[0]).not.toHaveProperty("subtotal_delta_cents");
    expect(result.summary).toBe(
      "high: 1225 cents before tax; low: 1175 cents before tax. " +
        "high costs 50 cents MORE than low before tax. Choosing high instead of low adds 50 cents; choosing low instead saves 50 cents. " +
        "No cart change, held quote, approval or order was created.",
    );
    expect(result.summary).not.toContain("minus");
    expect(result.summary).not.toContain("-50");
    const bad = structuredClone(result);
    bad.comparisons[0].amount_cents = -50;
    expect(toolDataSchemas.compare_menu_prices.safeParse(bad).success).toBe(
      false,
    );
  });
  it("requires explicit listed-meal drink size and rejects a silent medium substitution", () => {
    expect(() =>
      price([
        {
          label: "large",
          selections: [
            { product_id: "classic-meal", choices: { drink: ["lemonade"] } },
          ],
        },
      ]),
    ).toThrow("Declare meal_drink_variant");
    expect(() =>
      price([
        {
          label: "large",
          selections: [
            {
              product_id: "classic-meal",
              meal_drink_variant: "large",
              choices: { drink: ["lemonade"] },
            },
          ],
        },
      ]),
    ).toThrow("Select standalone classic");
    const result = price([
      {
        label: "converted",
        selections: [
          {
            product_id: "classic",
            meal: { drink: "lemonade", drink_variant: "large" },
          },
        ],
      },
    ]);
    expect(result.options[0].totals.subtotal).toBe(1200);
    expect(result.options[0].lines[0]).toMatchObject({
      product_id: "classic",
      meal: { drink_variant: "large", kind: "conversion" },
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
      { options: [{ ...option, label: "medium lemonade" }] },
      { options: [{ ...option, label: "a".repeat(41) }] },
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
    expect(
      menuPriceInputSchema.safeParse({
        options: [{ ...option, label: "medium_lemonade-2" }],
      }).success,
    ).toBe(true);
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
    expect(menuPriceGuidance).toContain("signed_change");
    expect(menuAnswerFormatGuidance).toContain("X_minus_Y");
    expect(menuAnswerFormatGuidance).toContain("never with |");
    expect(menuAnswerFormatGuidance).toContain("colon");
    expect(menuAnswerFormatGuidance).toContain(
      "copy the text before that colon verbatim",
    );
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
