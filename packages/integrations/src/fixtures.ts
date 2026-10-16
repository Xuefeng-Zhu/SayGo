import { cartResultSchema, type Command } from "@saygo/contracts";
import { randomUUID } from "node:crypto";
import { McpCallError } from "./mcp-client.js";
export type ToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
export const fixtures = [
  {
    id: "first",
    text: "Two cheeseburgers, one without onions, and a medium lemonade.",
  },
  {
    id: "correct",
    text: "Make the lemonade large, and no cheese on the burger without onions.",
  },
  { id: "meal", text: "Make one a meal." },
  { id: "remove", text: "Remove that." },
  { id: "side", text: "Do you have chicken?" },
  { id: "unsupported", text: "Add a pizza." },
  { id: "allergy", text: "I have an allergy. Can I speak to staff?" },
  { id: "review", text: "Review my order." },
  { id: "savings", text: "Can you make this cheaper?" },
];
// Deliberately finite, transparent fixtures. This is NOT an NLP/voice model.
export async function runFixture(input: string, call: ToolCaller) {
  const fixture = fixtures.find(
    (f) =>
      f.id === input || f.text.toLowerCase() === input.trim().toLowerCase(),
  );
  if (!fixture)
    throw new McpCallError(
      "No-key mode understands only the displayed predefined phrases. Use the menu or enable live voice.",
    );
  const { timing: _timing, ...cart } = await call("get_cart", {});
  const v = cartResultSchema.parse(cart);
  if (fixture.id === "savings") return call("find_meal_savings", {});
  if (fixture.id === "side") {
    const m = await call("get_item_details", { product_id: "chicken" });
    return {
      ...v,
      summary: "Yes. Crispy Chicken is on the menu. Your cart is unchanged.",
      detail: m,
    };
  }
  if (fixture.id === "allergy")
    return call("request_staff_help", {
      reason: "allergy",
      concern:
        "Customer reports an allergy and requests staff. No specific allergen was supplied.",
    });
  if (fixture.id === "review")
    return call("prepare_order_review", {
      expected_version: v.cart_version,
      request_id: randomUUID(),
    });
  let commands: Command[] = [];
  if (fixture.id === "first")
    commands = [
      { type: "add", product_id: "cheeseburger", quantity: 1, choices: {} },
      {
        type: "add",
        product_id: "cheeseburger",
        quantity: 1,
        choices: { remove: ["onions"] },
      },
      {
        type: "add",
        product_id: "lemonade",
        variant: "medium",
        quantity: 1,
        choices: {},
      },
    ];
  if (fixture.id === "correct") {
    const drinks = v.lines.filter((l) => l.product_id === "lemonade");
    const burgers = v.lines.filter(
      (l) =>
        l.product_id === "cheeseburger" && l.choices.remove?.includes("onions"),
    );
    if (drinks.length === 1 && burgers.length === 1)
      commands = [
        { type: "update", line_id: drinks[0].id, variant: "large" },
        {
          type: "update",
          line_id: burgers[0].id,
          choices: {
            ...burgers[0].choices,
            remove: [
              ...new Set([...(burgers[0].choices.remove ?? []), "cheese"]),
            ],
          },
        },
      ];
  }
  const clarification = commands.length
    ? undefined
    : fixture.id === "unsupported"
      ? "unsupported_request"
      : "ambiguous_line";
  return call("apply_cart_changes", {
    expected_version: v.cart_version,
    request_id: randomUUID(),
    commands,
    ...(clarification ? { clarification } : {}),
  });
}
