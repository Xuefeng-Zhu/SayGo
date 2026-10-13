import type { MenuEvaluation } from "./mcp-evaluations.js";

// Authored and independently verified before running the improved model.
// These extend, rather than replace or soften, the unchanged original benchmark.
export const menuGeneralizationEvaluations: MenuEvaluation[] = [
  {
    id: "fresh-chicken-drink-upgrade",
    question:
      "In Harbor Burger v1, compare the listed Crispy Chicken Meal with medium cola against the same listed meal with medium lemonade. Ignore tax. Return cola_meal_cents|lemonade_meal_cents|lemonade_upgrade_cents.",
    answer: "1275|1325|50",
    products: ["chicken-meal", "chicken", "fries", "cola", "lemonade"],
    solve: (p) => {
      const a =
        p.chicken.variants.regular +
        p.fries.variants.medium +
        p.cola.variants.medium -
        p["chicken-meal"].meal!.discount;
      const delta = p.lemonade.variants.medium - p.cola.variants.medium;
      return `${a}|${a + delta}|${delta}`;
    },
  },
  {
    id: "fresh-cheaper-drink-change",
    question:
      "In Harbor Burger v1, change the drink in a listed Classic Burger Meal from medium lemonade to medium tea. Ignore tax. Return original_meal_cents|changed_meal_cents|signed_changed_minus_original_cents.",
    answer: "1150|1100|-50",
    products: ["classic-meal", "classic", "fries", "lemonade", "tea"],
    solve: (p) => {
      const common =
        p.classic.variants.regular +
        p.fries.variants.medium -
        p["classic-meal"].meal!.discount;
      return `${common + p.lemonade.variants.medium}|${common + p.tea.variants.medium}|${p.tea.variants.medium - p.lemonade.variants.medium}`;
    },
  },
  {
    id: "fresh-garden-extras",
    question:
      "In Harbor Burger v1, price one regular Garden Burger with both extra cheese and an extra patty. Use only allowed extras. Return subtotal_cents|premium_over_plain_garden_cents. Ignore tax.",
    answer: "1050|325",
    products: ["garden"],
    solve: (p) => {
      const extras =
        p.garden.groups.extra.options.cheese.price +
        p.garden.groups.extra.options.patty.price;
      return `${p.garden.variants.regular + extras}|${extras}`;
    },
  },
  {
    id: "fresh-quantity-tax",
    question:
      "In Harbor Burger v1, price two regular Double Harbor burgers, each with extra cheese. Apply the simulator's 8% tax rounded to the nearest cent. Return subtotal_cents|tax_cents|total_cents.",
    answer: "1900|152|2052",
    products: ["double"],
    solve: (p) => {
      const subtotal =
          2 *
          (p.double.variants.regular +
            p.double.groups.extra.options.cheese.price),
        tax = Math.floor((subtotal * 8 + 50) / 100);
      return `${subtotal}|${tax}|${subtotal + tax}`;
    },
  },
  {
    id: "fresh-two-size-tradeoff",
    question:
      "In Harbor Burger v1, compare small lemonade plus large fries with large lemonade plus small fries. No meal discount or tax. Return first_cents|second_cents|first_minus_second_cents.",
    answer: "700|650|50",
    products: ["lemonade", "fries"],
    solve: (p) => {
      const a = p.lemonade.variants.small + p.fries.variants.large,
        b = p.lemonade.variants.large + p.fries.variants.small;
      return `${a}|${b}|${a - b}`;
    },
  },
  {
    id: "fresh-small-drink-ties",
    question:
      "In Harbor Burger v1, inspect all standalone drinks. Return the alphabetically sorted IDs tied for the cheapest SMALL drink in one comma-separated field, its price, and the small-lemonade premium: sorted_ids|small_cents|lemonade_premium_cents.",
    answer: "cola,tea|225|50",
    products: ["cola", "tea", "lemonade"],
    solve: (p) => {
      const min = Math.min(...Object.values(p).map((x) => x.variants.small));
      return `${Object.values(p)
        .filter((x) => x.variants.small === min)
        .map((x) => x.id)
        .sort()
        .join(",")}|${min}|${p.lemonade.variants.small - min}`;
    },
  },
  {
    id: "fresh-two-cheapest-sizes",
    question:
      "In Harbor Burger v1, inspect all standalone sides and all standalone drinks. Select the cheapest side at any size and the cheapest drink at any size, retaining every tied drink ID. Return side_id|side_size|sorted_tied_drink_ids|drink_size|combined_cents. Put multiple drink IDs in one comma-separated field. Ignore tax.",
    answer: "slaw|regular|cola,tea|small|475",
    products: ["slaw", "fries", "cola", "tea", "lemonade"],
    solve: (p) => {
      const side = Object.values(p)
        .filter((x) => x.category === "Sides")
        .flatMap((x) =>
          Object.entries(x.variants).map(([size, cents]) => ({
            id: x.id,
            size,
            cents,
          })),
        )
        .sort((a, b) => a.cents - b.cents)[0];
      const drinks = Object.values(p).filter((x) => x.category === "Drinks"),
        min = Math.min(...drinks.map((x) => x.variants.small));
      return `${side.id}|${side.size}|${drinks
        .filter((x) => x.variants.small === min)
        .map((x) => x.id)
        .sort()
        .join(",")}|small|${side.cents + min}`;
    },
  },
  {
    id: "fresh-tenders-side",
    question:
      "In Harbor Burger v1, compare Chicken Tenders with barbecue dip plus small fries against regular Crispy Chicken plus Harbor Slaw. Use only permitted choices and ignore tax. Return first_cents|second_cents|first_combination_savings_cents.",
    answer: "925|1000|75",
    products: ["tenders", "fries", "chicken", "slaw"],
    solve: (p) => {
      const a =
          p.tenders.variants.regular +
          p.tenders.groups.dip.options.bbq.price +
          p.fries.variants.small,
        b = p.chicken.variants.regular + p.slaw.variants.regular;
      return `${a}|${b}|${b - a}`;
    },
  },
  {
    id: "fresh-chicken-no-lettuce",
    question:
      "In Harbor Burger v1, check whether regular Crispy Chicken explicitly permits removing lettuce. Price that modification and compare its subtotal to the plain sandwich. This is not an allergy-safety question. Return permitted:yes_or_no|modified_cents|signed_modified_minus_plain_cents.",
    answer: "permitted:yes|750|0",
    products: ["chicken"],
    solve: (p) =>
      `permitted:${Object.hasOwn(p.chicken.groups.remove.options, "lettuce") ? "yes" : "no"}|${p.chicken.variants.regular + p.chicken.groups.remove.options.lettuce.price}|${p.chicken.groups.remove.options.lettuce.price}`,
  },
  {
    id: "fresh-large-meal-conversion",
    question:
      "In Harbor Burger v1, convert a standalone regular Classic Burger into a meal with the included medium fries and LARGE lemonade. Compare it with buying that burger, medium fries and large lemonade separately. Ignore tax. Return converted_meal_cents|separate_cents|savings_cents.",
    answer: "1200|1300|100",
    products: ["classic", "classic-meal", "fries", "lemonade"],
    solve: (p) => {
      const sum =
        p.classic.variants.regular +
        p.fries.variants.medium +
        p.lemonade.variants.large;
      return `${sum - p["classic-meal"].meal!.discount}|${sum}|${p["classic-meal"].meal!.discount}`;
    },
  },
];
