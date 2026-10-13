import type { Product } from "@saygo/contracts";

// Fixed Harbor Burger v1 fixture. Only the verifier knows these calculations;
// an evaluated agent receives the XML questions and read-only MCP tools.
export type MenuEvaluation = {
  id: string;
  question: string;
  answer: string;
  products: string[];
  solve: (products: Record<string, Product>) => string;
};
export const mcpEvaluations: MenuEvaluation[] = [
  {
    id: "cheapest-burger-meal",
    question:
      "Using the untouched Harbor Burger v1 fixture, compare every burger-based listed meal with medium fries and a medium drink. What is the cheapest combination before tax? Break drink-price ties by alphabetically smallest product ID. Return meal_id|drink_id|cents.",
    answer: "classic-meal|cola|1100",
    products: [
      "classic-meal",
      "cheeseburger-meal",
      "classic",
      "cheeseburger",
      "fries",
      "cola",
      "tea",
      "lemonade",
    ],
    solve: (p) =>
      ["classic-meal", "cheeseburger-meal"]
        .flatMap((id) =>
          p[id].meal!.drinks.map((drink) => ({
            id,
            drink,
            price:
              p[p[id].meal!.base].variants.regular +
              p.fries.variants.medium +
              p[drink].variants.medium -
              p[id].meal!.discount,
          })),
        )
        .sort((a, b) => a.price - b.price || a.drink.localeCompare(b.drink))
        .map((x) => `${x.id}|${x.drink}|${x.price}`)[0],
  },
  {
    id: "lemonade-meal-upgrade",
    question:
      "In Harbor Burger v1, calculate a listed Harbor Cheeseburger Meal with its included medium fries and medium lemonade, then compare it with the same meal using medium cola. Ignore tax. Return lemonade_meal_cents|upgrade_cents.",
    answer: "1225|50",
    products: [
      "cheeseburger-meal",
      "cheeseburger",
      "fries",
      "lemonade",
      "cola",
    ],
    solve: (p) =>
      `${p.cheeseburger.variants.regular + p.fries.variants.medium + p.lemonade.variants.medium - p["cheeseburger-meal"].meal!.discount}|${p.lemonade.variants.medium - p.cola.variants.medium}`,
  },
  {
    id: "burger-extras-comparison",
    question:
      "In Harbor Burger v1, compare a Double Harbor with extra cheese and a Harbor Cheeseburger with an extra patty. Using only allowed extras and before tax, which costs less and by how much? Return cheaper_product_id|cheaper_cents|difference_cents.",
    answer: "cheeseburger|900|50",
    products: ["double", "cheeseburger"],
    solve: (p) => {
      const a =
          p.double.variants.regular +
          p.double.groups.extra.options.cheese.price,
        b =
          p.cheeseburger.variants.regular +
          p.cheeseburger.groups.extra.options.patty.price;
      return `${a < b ? "double" : "cheeseburger"}|${Math.min(a, b)}|${Math.abs(a - b)}`;
    },
  },
  {
    id: "required-dip",
    question:
      "Compare Chicken Tenders and Classic Burger in Harbor Burger v1. Which requires an explicit modifier-group choice before review? Return that product ID, required group ID, sorted permitted option IDs and its regular base-price premium over the other item: product|group|option1,option2|cents.",
    answer: "tenders|dip|bbq,ranch|75",
    products: ["tenders", "classic"],
    solve: (p) => {
      const item = Object.values(p).find((x) =>
          Object.values(x.groups).some((g) => g.min > 0),
        )!,
        [group, spec] = Object.entries(item.groups).find(([, g]) => g.min > 0)!;
      return `${item.id}|${group}|${Object.keys(spec.options).sort().join(",")}|${p.tenders.variants.regular - p.classic.variants.regular}`;
    },
  },
  {
    id: "size-tradeoff",
    question:
      "In Harbor Burger v1, compare large lemonade plus small fries with medium lemonade plus large fries, before tax and without a meal discount. Return first_combination_cents|second_combination_cents|first_combination_savings_cents.",
    answer: "650|750|100",
    products: ["lemonade", "fries"],
    solve: (p) => {
      const a = p.lemonade.variants.large + p.fries.variants.small,
        b = p.lemonade.variants.medium + p.fries.variants.large;
      return `${a}|${b}|${b - a}`;
    },
  },
  {
    id: "allowed-removal",
    question:
      "Compare Garden Burger and Harbor Cheeseburger in Harbor Burger v1. Does each explicitly allow the cheese option in the remove group, and what is the cheeseburger's price for that removal? This asks only about listed modifications, not allergy safety. Return garden:yes_or_no|cheeseburger:yes_or_no|removal_cents.",
    answer: "garden:no|cheeseburger:yes|0",
    products: ["garden", "cheeseburger"],
    solve: (p) =>
      `garden:${Object.hasOwn(p.garden.groups.remove.options, "cheese") ? "yes" : "no"}|cheeseburger:${Object.hasOwn(p.cheeseburger.groups.remove.options, "cheese") ? "yes" : "no"}|${p.cheeseburger.groups.remove.options.cheese.price}`,
  },
  {
    id: "meal-components",
    question:
      "Inspect all listed meals in Harbor Burger v1. List their distinct base-product IDs alphabetically, their shared side-product ID and their shared discount in cents. Return base1,base2,base3|side|discount. Do not treat a meal's zero placeholder variant price as its full price.",
    answer: "cheeseburger,chicken,classic|fries|100",
    products: ["cheeseburger-meal", "classic-meal", "chicken-meal"],
    solve: (p) => {
      const meals = Object.values(p).map((x) => x.meal!);
      return `${meals
        .map((x) => x.base)
        .sort()
        .join(
          ",",
        )}|${[...new Set(meals.map((x) => x.side))].join(",")}|${[...new Set(meals.map((x) => x.discount))].join(",")}`;
    },
  },
  {
    id: "drink-size-pricing",
    question:
      "Compare all standalone drinks in Harbor Burger v1. Which product IDs share the cheapest large size, what is that price and how much more is large lemonade? Return sorted_ids|large_cents|lemonade_premium_cents.",
    answer: "cola,tea|325|50",
    products: ["cola", "tea", "lemonade"],
    solve: (p) => {
      const min = Math.min(...Object.values(p).map((x) => x.variants.large));
      return `${Object.values(p)
        .filter((x) => x.variants.large === min)
        .map((x) => x.id)
        .sort()
        .join(",")}|${min}|${p.lemonade.variants.large - min}`;
    },
  },
  {
    id: "chicken-meal-savings",
    question:
      "In Harbor Burger v1, compare the listed Crispy Chicken Meal with medium tea to buying its sandwich, medium fries and medium tea individually. Ignore tax and extras. Return meal_cents|separate_cents|savings_cents.",
    answer: "1275|1375|100",
    products: ["chicken-meal", "chicken", "fries", "tea"],
    solve: (p) => {
      const sum =
          p.chicken.variants.regular +
          p.fries.variants.medium +
          p.tea.variants.medium,
        discount = p["chicken-meal"].meal!.discount;
      return `${sum - discount}|${sum}|${discount}`;
    },
  },
  {
    id: "full-menu-budget-comparison",
    question:
      "In Harbor Burger v1, choose the most expensive regular item in the Burgers category, the cheapest standalone side at any size, and the cheapest large drink. Compare its pre-tax sum with the same side and drink plus the cheapest regular burger. No extras or meal discount. Return expensive_burger_id|side_id|sorted_tied_drink_ids|expensive_sum_cents|difference_cents.",
    answer: "double|slaw|cola,tea|1450|300",
    products: [
      "cheeseburger",
      "classic",
      "double",
      "garden",
      "fries",
      "slaw",
      "cola",
      "tea",
      "lemonade",
    ],
    solve: (p) => {
      const burgers = Object.values(p)
          .filter((x) => x.category === "Burgers")
          .sort((a, b) => b.variants.regular - a.variants.regular),
        sides = Object.values(p)
          .filter((x) => x.category === "Sides")
          .sort(
            (a, b) =>
              Math.min(...Object.values(a.variants)) -
              Math.min(...Object.values(b.variants)),
          ),
        drinks = Object.values(p).filter((x) => x.category === "Drinks"),
        min = Math.min(...drinks.map((x) => x.variants.large));
      return `${burgers[0].id}|${sides[0].id}|${drinks
        .filter((x) => x.variants.large === min)
        .map((x) => x.id)
        .sort()
        .join(
          ",",
        )}|${burgers[0].variants.regular + Math.min(...Object.values(sides[0].variants)) + min}|${burgers[0].variants.regular - burgers.at(-1)!.variants.regular}`;
    },
  },
];

const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const evaluationXml = () =>
  `<evaluation>\n${mcpEvaluations.map((item) => `  <qa_pair>\n    <question>${xml(item.question)}</question>\n    <answer>${xml(item.answer)}</answer>\n  </qa_pair>`).join("\n")}\n</evaluation>\n`;
