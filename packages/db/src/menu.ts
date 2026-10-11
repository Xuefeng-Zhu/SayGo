import type { Product } from "@saygo/contracts";
const remove = (ingredients: string[]) => ({
  label: "Leave off",
  min: 0,
  max: ingredients.length,
  options: Object.fromEntries(
    ingredients.map((i) => [i, { label: `No ${i}`, price: 0 }]),
  ),
});
function burger(
  id: string,
  name: string,
  price: number,
  ingredients: string[],
): Product {
  return {
    id,
    name,
    category: "Burgers",
    description: "Griddled patty on a toasted bun.",
    aliases: [id.replaceAll("-", " ")],
    ingredients,
    available: true,
    variants: { regular: price },
    groups: {
      remove: remove(ingredients),
      extra: {
        label: "Extras",
        min: 0,
        max: 2,
        options: {
          cheese: { label: "Extra cheese", price: 75 },
          patty: { label: "Extra patty", price: 250 },
        },
      },
    },
  };
}
const drink = (id: string, name: string, price: number): Product => ({
  id,
  name,
  category: "Drinks",
  description: "Chilled and poured to order.",
  aliases: [name.toLowerCase()],
  ingredients: [],
  available: true,
  variants: { small: price, medium: price + 50, large: price + 100 },
  groups: {
    ice: {
      label: "Ice",
      min: 0,
      max: 1,
      options: {
        none: { label: "No ice", price: 0 },
        light: { label: "Light ice", price: 0 },
      },
    },
  },
});
export const seedProducts: Product[] = [
  burger("cheeseburger", "Harbor Cheeseburger", 650, [
    "onions",
    "cheese",
    "pickles",
    "sauce",
  ]),
  burger("classic", "Classic Burger", 575, ["onions", "pickles", "sauce"]),
  burger("double", "Double Harbor", 875, [
    "onions",
    "cheese",
    "pickles",
    "sauce",
  ]),
  {
    ...burger("garden", "Garden Burger", 725, [
      "onions",
      "lettuce",
      "tomato",
      "sauce",
    ]),
    description: "A fictional vegetable patty. Not an allergen safety claim.",
  },
  {
    ...burger("chicken", "Crispy Chicken", 750, [
      "lettuce",
      "pickles",
      "sauce",
    ]),
    category: "Chicken",
    description: "Crisp chicken with pickles and slaw.",
  },
  {
    id: "tenders",
    name: "Chicken Tenders",
    category: "Chicken",
    description: "Three crisp tenders; choose your dip.",
    aliases: ["tenders"],
    ingredients: ["chicken", "breading"],
    available: true,
    variants: { regular: 650 },
    groups: {
      dip: {
        label: "Choose a dip",
        min: 1,
        max: 1,
        options: {
          ranch: { label: "Ranch", price: 0 },
          bbq: { label: "Barbecue", price: 0 },
        },
      },
    },
  },
  {
    id: "fries",
    name: "Sea-salt Fries",
    category: "Sides",
    description: "Golden fries with a pinch of sea salt.",
    aliases: ["fries"],
    ingredients: ["potato", "salt"],
    available: true,
    variants: { small: 275, medium: 350, large: 425 },
    groups: { remove: remove(["salt"]) },
  },
  {
    id: "slaw",
    name: "Harbor Slaw",
    category: "Sides",
    description: "Crunchy cabbage and house dressing.",
    aliases: ["slaw"],
    ingredients: ["cabbage", "dressing"],
    available: true,
    variants: { regular: 250 },
    groups: {},
  },
  drink("cola", "Fountain Cola", 225),
  drink("lemonade", "Lemonade", 275),
  drink("tea", "Iced Tea", 225),
  ...(["cheeseburger", "classic", "chicken"] as const).map(
    (base): Product => ({
      id: `${base}-meal`,
      name: `${base === "cheeseburger" ? "Harbor Cheeseburger" : base === "classic" ? "Classic Burger" : "Crispy Chicken"} Meal`,
      category: "Meals",
      description: "Sandwich, medium fries and your choice of medium drink.",
      aliases: [`${base} meal`],
      ingredients: [],
      available: true,
      variants: { regular: 0 },
      groups: {
        drink: {
          label: "Meal drink",
          min: 1,
          max: 1,
          options: {
            cola: { label: "Fountain Cola", price: 0 },
            lemonade: { label: "Lemonade", price: 0 },
            tea: { label: "Iced Tea", price: 0 },
          },
        },
      },
      meal: {
        base,
        side: "fries",
        drinks: ["cola", "lemonade", "tea"],
        discount: 100,
      },
    }),
  ),
];
