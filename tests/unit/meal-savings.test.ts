import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  toolDataSchemas,
  type Cart,
  type Line,
  type Menu,
} from "@saygo/contracts";
import { seedProducts } from "../../packages/db/src/menu.js";
import { priceCart } from "../../packages/domain/src/engine.js";
import { findMealSavings } from "../../packages/domain/src/meal-savings.js";

const freshMenu = (): Menu => ({
  version: 7,
  price_version: 11,
  currency: "USD",
  products: structuredClone(seedProducts),
  instructions: "Fictional",
  upsell_enabled: false,
});
const line = (
  id: string,
  product_id: string,
  variant = "regular",
  quantity = 1,
  choices: Line["choices"] = {},
): Line => ({ id, product_id, variant, quantity, choices });
const cart = (lines: Line[]): Cart => ({ version: 9, lines, issues: [] });
const combination = () => [
  line("sandwich", "cheeseburger"),
  line("fries", "fries", "medium"),
  line("drink", "cola", "large"),
];

// Compare physical food quantities and customizations independently of pricing
// or representation, so merging lines cannot silently lose or duplicate food.
function inventory(input: Cart) {
  const quantities = new Map<string, number>();
  const add = (
    product: string,
    variant: string | undefined,
    choices: Line["choices"],
    quantity: number,
  ) => {
    const normalized = Object.entries(choices)
      .filter(([, values]) => values.length)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, values]) => [group, [...values].sort()]);
    const key = JSON.stringify([product, variant, normalized]);
    quantities.set(key, (quantities.get(key) ?? 0) + quantity);
  };
  for (const item of input.lines) {
    add(item.product_id, item.variant, item.choices, item.quantity);
    if (item.meal) {
      add("fries", "medium", {}, item.quantity);
      add(item.meal.drink, item.meal.drink_variant, {}, item.quantity);
    }
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b));
}

describe("equivalent meal savings", () => {
  it("keeps sandwich customizations, identity and the requested large drink", () => {
    const menu = freshMenu();
    const input = cart(combination());
    input.lines[0].choices = { extra: ["cheese"], remove: ["onions"] };
    const result = findMealSavings(input, menu)!;
    expect(result.cart.lines).toEqual([
      {
        ...input.lines[0],
        meal: { drink: "cola", drink_variant: "large" },
      },
    ]);
    expect(result.before).toEqual({
      subtotal: 1400,
      tax: 112,
      total: 1512,
      currency: "USD",
    });
    expect(result.after).toEqual({
      subtotal: 1300,
      tax: 104,
      total: 1404,
      currency: "USD",
    });
    expect(result.savings_cents).toBe(108);
    expect(result.subtotal_savings_cents).toBe(100);
    expect(result.groups).toEqual([
      {
        sandwich_line_id: "sandwich",
        side_line_id: "fries",
        drink_line_id: "drink",
        product_id: "cheeseburger",
        drink: "cola",
        drink_variant: "large",
        quantity: 1,
        summary:
          "1 × Harbor Cheeseburger meal with medium fries and large Fountain Cola",
      },
    ]);
    expect(inventory(result.cart)).toEqual(inventory(input));
    expect(result.cart.version).toBe(input.version);
  });

  it("maximizes combinations across quantities and preserves every remaining item", () => {
    const menu = freshMenu();
    const input = cart([
      line("a", "classic", "regular", 3, { remove: ["onions"] }),
      line("b", "chicken", "regular", 2, { extra: ["cheese"] }),
      line("f1", "fries", "medium", 3),
      line("f2", "fries", "medium", 1),
      line("d1", "lemonade", "large", 2),
      line("d2", "cola", "small", 1),
      line("d3", "tea", "medium", 3),
      line("slaw", "slaw", "regular", 2),
    ]);
    const result = findMealSavings(input, menu)!;
    expect(result.subtotal_savings_cents).toBe(400);
    expect(result.savings_cents).toBe(432);
    expect(result.groups.reduce((sum, group) => sum + group.quantity, 0)).toBe(
      4,
    );
    expect(inventory(result.cart)).toEqual(inventory(input));
    expect(result.cart.lines.find((item) => item.id === "a")?.choices).toEqual({
      remove: ["onions"],
    });
    expect(result.cart.lines.find((item) => item.id === "b")?.choices).toEqual({
      extra: ["cheese"],
    });
    expect(result.cart.lines.find((item) => item.id === "slaw")).toEqual(
      input.lines[7],
    );
    expect(new Set(result.cart.lines.map((item) => item.id)).size).toBe(
      result.cart.lines.length,
    );
    expect(priceCart(result.cart, menu).issues).toEqual([]);
  });

  it("is deterministic and shares no mutable data with the original cart or menu", () => {
    const menu = freshMenu();
    const input = cart([
      line("sandwich", "classic", "regular", 3, { remove: ["onions"] }),
      line("fries", "fries", "medium", 2),
      line("drink1", "tea", "small"),
      line("drink2", "tea", "large"),
    ]);
    const original = structuredClone({ input, menu });
    const result = findMealSavings(input, menu)!;
    expect(findMealSavings(input, menu)).toEqual(result);
    expect(result.cart.lines).toHaveLength(3);
    expect(result.cart.lines[0].id).toBe("sandwich");
    expect({ input, menu }).toEqual(original);
    result.cart.lines[0].choices.remove.push("pickles");
    expect({ input, menu }).toEqual(original);
  });

  it("uses stable UUIDs for split lines accepted by the strict cart tool contract", () => {
    const menu = freshMenu();
    const input = cart([
      line(randomUUID(), "classic", "regular", 3),
      line(randomUUID(), "fries", "medium", 2),
      line(randomUUID(), "tea", "small"),
      line(randomUUID(), "cola", "large"),
    ]);
    const result = findMealSavings(input, menu)!;
    const priced = priceCart(result.cart, menu);
    expect(result.cart.lines).toHaveLength(3);
    expect(
      toolDataSchemas.get_cart.safeParse({
        cart_version: input.version,
        menu_version: menu.version,
        price_version: menu.price_version,
        lines: priced.lines,
        totals: priced.totals,
        unresolved_choices: [],
        control: { owner: "ai", needs_staff_review: false },
        quote: null,
        order: null,
        summary: "Draft updated.",
      }).success,
    ).toBe(true);
    expect(findMealSavings(input, menu)).toEqual(result);
    // Avoid collisions even with an unrelated existing line at a derived ID.
    input.lines.push(line(result.cart.lines[1].id, "slaw"));
    const collisionResult = findMealSavings(input, menu)!;
    expect(
      new Set(collisionResult.cart.lines.map((item) => item.id)).size,
    ).toBe(collisionResult.cart.lines.length);
    expect(inventory(collisionResult.cart)).toEqual(inventory(input));
  });

  it.each(["small", "large"])(
    "never silently replaces %s fries with medium fries",
    (size) => {
      const input = cart(combination());
      input.lines[1].variant = size;
      expect(findMealSavings(input, freshMenu())).toBeNull();
    },
  );

  it.each<{ index: number; choices: Line["choices"] }>([
    { index: 1, choices: { remove: ["salt"] } },
    { index: 2, choices: { ice: ["none"] } },
    { index: 2, choices: { ice: ["light"] } },
  ])("does not lose side or drink customizations: %j", ({ index, choices }) => {
    const input = cart(combination());
    input.lines[index].choices = choices;
    expect(findMealSavings(input, freshMenu())).toBeNull();
  });

  it("allows empty optional choice groups and does not consume customized alternatives", () => {
    const input = cart([
      ...combination(),
      line("salt-free", "fries", "medium", 2, { remove: ["salt"] }),
      line("ice-free", "tea", "large", 2, { ice: ["none"] }),
    ]);
    input.lines[1].choices = { remove: [] };
    input.lines[2].choices = { ice: [] };
    const result = findMealSavings(input, freshMenu())!;
    expect(result.cart.lines.find((item) => item.id === "salt-free")).toEqual(
      input.lines[3],
    );
    expect(result.cart.lines.find((item) => item.id === "ice-free")).toEqual(
      input.lines[4],
    );
    expect(inventory(result.cart)).toEqual(inventory(input));
  });

  it("leaves listed and converted meals intact, including their existing drink sizes", () => {
    const input = cart([
      line("listed", "classic-meal", "regular", 2, { drink: ["lemonade"] }),
      {
        ...line("converted", "chicken"),
        meal: { drink: "tea", drink_variant: "small" },
      },
      ...combination(),
    ]);
    const menu = freshMenu();
    menu.products.find((p) => p.id === "classic-meal")!.meal!.discount = 165;
    const result = findMealSavings(input, menu)!;
    expect(result.cart.lines[0]).toEqual(input.lines[0]);
    expect(result.cart.lines[1]).toEqual(input.lines[1]);
    expect(result.subtotal_savings_cents).toBe(100);
    expect(inventory(result.cart)).toEqual(inventory(input));
    expect(findMealSavings(cart(input.lines.slice(0, 2)), menu)).toBeNull();
  });

  it("prices the whole proposal with current menu prices instead of cached fixtures", () => {
    const menu = freshMenu();
    menu.products.find((p) => p.id === "cheeseburger")!.variants.regular = 799;
    menu.products.find((p) => p.id === "fries")!.variants.medium = 413;
    menu.products.find((p) => p.id === "cola")!.variants.large = 368;
    menu.products.find(
      (p) => p.id === "cheeseburger",
    )!.groups.extra.options.cheese.price = 91;
    const input = cart(combination());
    input.lines[0].choices = { extra: ["cheese"] };
    const result = findMealSavings(input, menu)!;
    expect(result.before.subtotal).toBe(1671);
    expect(result.after.subtotal).toBe(1571);
    expect(result.before).toEqual(priceCart(input, menu).totals);
    expect(result.after).toEqual(priceCart(result.cart, menu).totals);
    expect(result.savings_cents).toBe(result.before.total - result.after.total);
  });

  it("finds a maximum matching when one cheap sandwich cannot pair with a cheap drink", () => {
    const menu = freshMenu();
    menu.products.find((p) => p.id === "classic")!.variants.regular = 20;
    menu.products.find((p) => p.id === "chicken")!.variants.regular = 80;
    menu.products.find((p) => p.id === "fries")!.variants.medium = 0;
    menu.products.find((p) => p.id === "tea")!.variants.small = 90;
    menu.products.find((p) => p.id === "cola")!.variants.small = 30;
    const input = cart([
      line("high", "chicken"),
      line("low", "classic"),
      line("fries", "fries", "medium", 2),
      line("high-drink", "tea", "small"),
      line("low-drink", "cola", "small"),
    ]);
    const result = findMealSavings(input, menu)!;
    expect(result.subtotal_savings_cents).toBe(200);
    expect(
      result.cart.lines.map((item) => [item.product_id, item.meal?.drink]),
    ).toEqual([
      ["chicken", "cola"],
      ["classic", "tea"],
    ]);
    expect(inventory(result.cart)).toEqual(inventory(input));
  });

  it.each(["cheeseburger", "fries", "cola"])(
    "does not propose unavailable %s",
    (id) => {
      const menu = freshMenu();
      menu.products.find((p) => p.id === id)!.available = false;
      expect(findMealSavings(cart(combination()), menu)).toBeNull();
    },
  );

  it("requires a fully resolved cart and remains safe if the menu removes a product", () => {
    const menu = freshMenu();
    const input = cart(combination());
    expect(
      findMealSavings(
        {
          ...input,
          issues: [{ code: "ambiguous_line", message: "Which item?" }],
        },
        menu,
      ),
    ).toBeNull();
    expect(
      findMealSavings(cart([...input.lines, line("dip", "tenders")]), menu),
    ).toBeNull();
    const noSize = structuredClone(input);
    delete noSize.lines[2].variant;
    expect(findMealSavings(noSize, menu)).toBeNull();
    menu.products = menu.products.filter((p) => p.id !== "cola");
    expect(findMealSavings(input, menu)).toBeNull();
  });

  it("returns no plan for missing components, unsupported sandwiches, or invalid negative meal prices", () => {
    const menu = freshMenu();
    for (const lines of [
      [],
      combination().slice(0, 2),
      combination().slice(1),
      [line("garden", "garden"), ...combination().slice(1)],
    ])
      expect(findMealSavings(cart(lines), menu)).toBeNull();
    for (const product of menu.products) {
      for (const variant of Object.keys(product.variants))
        product.variants[variant] = 0;
    }
    expect(findMealSavings(cart(combination()), menu)).toBeNull();
  });

  it("keeps quantities bounded without expanding ten identical meals into ten lines", () => {
    const input = cart([
      line("sandwich", "classic", "regular", 10),
      line("fries", "fries", "medium", 10),
      line("drink", "tea", "small", 10),
      ...Array.from({ length: 27 }, (_, i) => line(`slaw-${i}`, "slaw")),
    ]);
    const result = findMealSavings(input, freshMenu())!;
    expect(result.subtotal_savings_cents).toBe(1000);
    expect(result.cart.lines).toHaveLength(28);
    expect(result.cart.lines[0].quantity).toBe(10);
    expect(inventory(result.cart)).toEqual(inventory(input));
  });
});
