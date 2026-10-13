import { menuPriceInputSchema, type Menu } from "@saygo/contracts";
import { applyCommands, assert, priceCart } from "./engine.js";

// Uses exactly the ordering engine, but never reads or writes a customer's cart.
// This is an informational comparison, not a review, approval, or price hold.
export function compareMenuPrices(menu: Menu, input: unknown) {
  const { options: candidates } = menuPriceInputSchema.parse(input);
  const options = candidates.map(({ label, selections }) => {
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
        unit_price: line.unit_price,
        line_total: line.line_total,
        modifiers: line.modifiers,
      })),
    };
  });
  const baseline = options[0];
  const comparisons = options.slice(1).map((option) => ({
    label: option.label,
    subtotal_delta_cents: option.totals.subtotal - baseline.totals.subtotal,
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
  // A factual human-readable summary conveys direction without requiring a
  // model to reinterpret the sign of a caller-ordered numeric delta.
  const summary =
    options
      .map((o) => `${o.label}: ${o.totals.subtotal} cents before tax`)
      .join("; ") +
    ". " +
    comparisons
      .map((c) => {
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
