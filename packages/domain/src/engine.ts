import { randomUUID } from "node:crypto";
import type {
  Cart,
  Command,
  Issue,
  Line,
  Menu,
  PricedLine,
  Product,
  Totals,
} from "@saygo/contracts";
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function assert(
  value: unknown,
  code: string,
  message: string,
  status = 409,
): asserts value {
  if (!value) throw new DomainError(code, message, status);
}
export function product(menu: Menu, id: string) {
  const p = menu.products.find((p) => p.id === id);
  assert(p, "UNKNOWN_PRODUCT", "That item is not on this menu.", 400);
  return p;
}
export function validateSelection(line: Line, menu: Menu): Issue[] {
  const p = product(menu, line.product_id);
  const issues: Issue[] = [];
  if (!p.available)
    issues.push({
      code: "unavailable",
      message: `${p.name} is unavailable. Please choose a replacement or remove it.`,
      line_id: line.id,
    });
  assert(
    Number.isInteger(line.quantity) &&
      line.quantity >= 1 &&
      line.quantity <= 10,
    "QUANTITY",
    "Choose a quantity from 1 to 10.",
    400,
  );
  if (!line.variant)
    issues.push({
      code: "variant",
      message: `Which size for ${p.name}?`,
      line_id: line.id,
    });
  else
    assert(
      Object.hasOwn(p.variants, line.variant),
      "VARIANT",
      "That size is not offered.",
      400,
    );
  for (const [group, values] of Object.entries(line.choices)) {
    const definition = p.groups[group];
    assert(definition, "MODIFIER", "That modification is not supported.", 400);
    assert(
      new Set(values).size === values.length && values.length <= definition.max,
      "MODIFIER",
      "Check the number of choices.",
      400,
    );
    for (const choice of values)
      assert(
        Object.hasOwn(definition.options, choice),
        "MODIFIER",
        "That modification is not supported.",
        400,
      );
  }
  for (const [group, def] of Object.entries(p.groups))
    if ((line.choices[group]?.length ?? 0) < def.min)
      issues.push({
        code: "choice",
        message: `${p.name}: ${def.label.toLowerCase()}.`,
        line_id: line.id,
      });
  if (
    line.choices.remove?.some((choice) => line.choices.extra?.includes(choice))
  )
    issues.push({
      code: "conflicting_choices",
      message: `${p.name} has both remove and extra for the same ingredient. Which would you like?`,
      line_id: line.id,
    });
  if (line.meal || p.meal) {
    const drink = line.meal?.drink ?? line.choices.drink?.[0];
    if (drink) {
      const d = product(menu, drink),
        f = product(menu, "fries");
      assert(
        ["cola", "lemonade", "tea"].includes(drink),
        "MEAL",
        "Choose a supported meal drink.",
        400,
      );
      if (!d.available || !f.available)
        issues.push({
          code: "unavailable",
          message:
            "A meal component is unavailable. Please choose another item.",
          line_id: line.id,
        });
      assert(
        Object.hasOwn(d.variants, line.meal?.drink_variant ?? "medium"),
        "VARIANT",
        "That meal drink size is not offered.",
        400,
      );
    }
    if (p.meal && !product(menu, p.meal.base).available)
      issues.push({
        code: "unavailable",
        message: "The meal sandwich is unavailable.",
        line_id: line.id,
      });
  }
  return issues;
}
function basePrice(p: Product, line: Line): number {
  return line.variant ? (p.variants[line.variant] ?? 0) : 0;
}
export function priceCart(
  cart: Cart,
  menu: Menu,
): { lines: PricedLine[]; totals: Totals; issues: Issue[] } {
  const issues = [...cart.issues];
  const lines = cart.lines.map((line) => {
    const p = product(menu, line.product_id);
    try {
      issues.push(...validateSelection(line, menu));
    } catch (e) {
      if (e instanceof DomainError)
        issues.push({ code: e.code, message: e.message, line_id: line.id });
      else throw e;
    }
    let unit = basePrice(p, line);
    const modifiers: string[] = [];
    if (line.variant && line.variant !== "regular")
      modifiers.push(line.variant[0].toUpperCase() + line.variant.slice(1));
    for (const [group, choices] of Object.entries(line.choices))
      for (const c of choices) {
        const option = p.groups[group]?.options[c];
        if (option) {
          unit += option.price;
          modifiers.push(option.label);
        }
      }
    if (p.meal) {
      const base = product(menu, p.meal.base);
      unit +=
        base.variants.regular +
        product(menu, p.meal.side).variants.medium -
        p.meal.discount;
      const drink = line.choices.drink?.[0];
      if (drink) unit += product(menu, drink).variants.medium;
      modifiers.push("Medium fries");
    }
    if (line.meal) {
      unit +=
        product(menu, "fries").variants.medium +
        product(menu, line.meal.drink).variants[line.meal.drink_variant] -
        100;
      modifiers.push(
        `Meal: medium fries + ${line.meal.drink_variant} ${product(menu, line.meal.drink).name}`,
      );
    }
    assert(
      Number.isSafeInteger(unit) && unit >= 0,
      "PRICE",
      "This item needs staff price review.",
    );
    return {
      ...line,
      name: p.name,
      unit_price: unit,
      line_total: unit * line.quantity,
      modifiers,
    };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
  const tax = Math.floor((subtotal * 8 + 50) / 100);
  return {
    lines,
    totals: { subtotal, tax, total: subtotal + tax, currency: "USD" },
    issues,
  };
}
export function applyCommands(
  cart: Cart,
  menu: Menu,
  commands: Command[],
  clarification?: "ambiguous_line" | "unsupported_request",
): Cart {
  const lines = structuredClone(cart.lines);
  for (const command of commands) {
    if (command.type === "add") {
      const p = product(menu, command.product_id);
      assert(
        p.available,
        "UNAVAILABLE",
        `${p.name} is unavailable. Choose another item.`,
      );
      const variant =
        command.variant ??
        (Object.keys(p.variants).length === 1
          ? Object.keys(p.variants)[0]
          : undefined);
      // Individual stable lines prevent a later customization from changing every copy.
      for (let n = 0; n < command.quantity; n++)
        lines.push({
          id: randomUUID(),
          product_id: p.id,
          variant,
          choices: command.choices,
          quantity: 1,
        });
    } else {
      const index = lines.findIndex((l) => l.id === command.line_id);
      assert(
        index >= 0,
        "LINE",
        "That line is no longer in this cart. Re-read the cart.",
      );
      const line = lines[index];
      if (command.type === "remove") lines.splice(index, 1);
      if (command.type === "update")
        lines[index] = {
          ...line,
          ...(command.variant ? { variant: command.variant } : {}),
          ...(command.choices ? { choices: command.choices } : {}),
          ...(command.quantity ? { quantity: command.quantity } : {}),
        };
      if (command.type === "meal") {
        assert(
          ["cheeseburger", "classic", "chicken"].includes(line.product_id) &&
            !line.meal,
          "MEAL",
          "That line cannot be converted to a meal.",
        );
        assert(
          line.quantity === 1,
          "AMBIGUOUS",
          "Select one individual sandwich before converting it to a meal.",
        );
        line.meal = {
          drink: command.drink,
          drink_variant: command.drink_variant,
        };
      }
    }
  }
  assert(
    lines.length <= 30,
    "CART_LIMIT",
    "Please ask staff for orders over 30 items.",
  );
  const next: Cart = {
    version: cart.version + 1,
    lines,
    issues: clarification
      ? [
          {
            code: clarification,
            message:
              clarification === "ambiguous_line"
                ? "Which item do you mean? Choose a specific line before making that change."
                : "That request is not supported by this menu. Please choose a menu option or ask staff.",
          },
        ]
      : [],
  };
  for (const line of lines) validateSelection(line, menu);
  return next;
}
