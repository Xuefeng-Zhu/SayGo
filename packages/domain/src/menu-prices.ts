import { menuPriceInputSchema, type Menu } from "@saygo/contracts";
import { applyCommands, assert, priceCart, product } from "./engine.js";

// Uses exactly the ordering engine, but never reads or writes a customer's cart.
// This is an informational comparison, not a review, approval, or price hold.
export function compareMenuPrices(menu: Menu, input: unknown) {
  const { options: candidates, comparison_kind } =
    menuPriceInputSchema.parse(input);
  const options = candidates.map(({ label, selections }) => {
    for (const selection of selections) {
      const p = product(menu, selection.product_id);
      if (p.meal) {
        assert(
          selection.meal_drink_variant,
          "MEAL_SIZE_REQUIRED",
          `Declare meal_drink_variant from the customer's requested size. Listed ${p.id} includes medium only; for another size use standalone ${p.meal.base} with meal:{drink:<listed ID>,drink_variant:<requested size>}.`,
          400,
        );
        assert(
          selection.meal_drink_variant === "medium",
          "LISTED_MEAL_SIZE",
          `Listed ${p.id} cannot represent a non-medium drink. Select standalone ${p.meal.base} and set meal.drink and meal.drink_variant to the requested drink/size. Never silently substitute medium.`,
          400,
        );
      } else {
        assert(
          selection.meal_drink_variant === undefined,
          "INVALID_ARGUMENTS",
          "Standalone meal conversion uses meal.drink_variant, not meal_drink_variant.",
          400,
        );
      }
    }
    let cart = applyCommands(
      { version: 0, lines: [], issues: [] },
      menu,
      selections.map((s) => ({
        type: "add" as const,
        product_id: s.product_id,
        variant: s.variant,
        quantity: s.quantity,
        choices: s.choices,
      })),
    );
    let offset = 0;
    for (const selection of selections) {
      if (selection.meal) {
        const targets = cart.lines.slice(offset, offset + selection.quantity);
        cart = applyCommands(
          cart,
          menu,
          targets.map((line) => ({
            type: "meal" as const,
            line_id: line.id,
            ...selection.meal!,
          })),
        );
      }
      offset += selection.quantity;
    }
    const priced = priceCart(cart, menu);
    assert(
      priced.issues.length === 0,
      "INCOMPLETE_SELECTION",
      "Price comparison requires available items, explicit sizes for multi-size products, and all required choices. Inspect get_item_details and correct the selections.",
      400,
    );
    return {
      label,
      totals: priced.totals,
      lines: priced.lines.map((line) => ({
        product_id: line.product_id,
        variant: line.variant,
        quantity: line.quantity,
        choices: line.choices,
        ...(line.meal
          ? { meal: { ...line.meal, kind: "conversion" as const } }
          : product(menu, line.product_id).meal
            ? {
                meal: {
                  drink: line.choices.drink[0],
                  drink_variant: "medium",
                  kind: "listed" as const,
                },
              }
            : {}),
        unit_price: line.unit_price,
        line_total: line.line_total,
        modifiers: line.modifiers,
      })),
    };
  });
  const baseline = options[0];
  const comparisons = options.slice(1).map((option) => ({
    label: option.label,
    kind: comparison_kind,
    amount_cents:
      comparison_kind === "signed_change"
        ? option.totals.subtotal - baseline.totals.subtotal
        : Math.abs(option.totals.subtotal - baseline.totals.subtotal),
    ...(comparison_kind === "signed_change"
      ? {
          subtotal_delta_cents:
            option.totals.subtotal - baseline.totals.subtotal,
        }
      : {}),
    absolute_subtotal_difference_cents: Math.abs(
      option.totals.subtotal - baseline.totals.subtotal,
    ),
    more_expensive_label:
      option.totals.subtotal === baseline.totals.subtotal
        ? null
        : option.totals.subtotal > baseline.totals.subtotal
          ? option.label
          : baseline.label,
  }));
  // Name both operands for signed questions so the requested direction does
  // not depend on the model using the same option order as its answer fields.
  // Unsigned price gaps keep their existing magnitude-only summary.
  const summary =
    options
      .map((o) => `${o.label}: ${o.totals.subtotal} cents before tax`)
      .join("; ") +
    ". " +
    comparisons
      .map((c) => {
        if (c.kind === "signed_change")
          return `${c.label} minus ${baseline.label} = ${c.amount_cents} cents; ${baseline.label} minus ${c.label} = ${-c.amount_cents} cents.`;
        if (c.more_expensive_label === null)
          return `${c.label} and ${baseline.label} have the same subtotal.`;
        const lower =
          c.more_expensive_label === baseline.label ? c.label : baseline.label;
        return `${c.more_expensive_label} costs ${c.absolute_subtotal_difference_cents} cents MORE than ${lower} before tax. Choosing ${c.more_expensive_label} instead of ${lower} adds ${c.absolute_subtotal_difference_cents} cents; choosing ${lower} instead saves ${c.absolute_subtotal_difference_cents} cents.`;
      })
      .join(" ") +
    " No cart change, held quote, approval or order was created.";
  return {
    menu_version: menu.version,
    price_version: menu.price_version,
    currency: "USD" as const,
    baseline_label: baseline.label,
    options,
    comparisons,
    summary,
  };
}
