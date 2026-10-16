import { createHash } from "node:crypto";
import type { Cart, Line, Menu, Totals } from "@saygo/contracts";
import { applyCommands, DomainError, priceCart } from "./engine.js";

export type MealSavingsGroup = {
  sandwich_line_id: string;
  side_line_id: string;
  drink_line_id: string;
  product_id: string;
  drink: string;
  drink_variant: string;
  quantity: number;
  summary: string;
};

export type MealSavingsPlan = {
  // The caller owns acceptance and the cart version increment.
  cart: Cart;
  before: Totals;
  after: Totals;
  savings_cents: number;
  subtotal_savings_cents: number;
  groups: MealSavingsGroup[];
};

type Edge = { to: number; reverse: number; capacity: number };
const unmodified = (line: Line) =>
  !line.meal && Object.values(line.choices).every((choices) => !choices.length);

/**
 * Find the most equivalent conversions supported by the ordering engine.
 * Every supported conversion has the same discount, so maximum cardinality
 * matching also minimizes the subtotal (and its monotonic rounded tax).
 * No food is added, replaced, resized, or stripped of its customization.
 */
export function findMealSavings(
  cart: Cart,
  menu: Menu,
): MealSavingsPlan | null {
  if (
    cart.lines.length > 30 ||
    new Set(cart.lines.map((line) => line.id)).size !== cart.lines.length
  )
    return null;

  try {
    return findValidMealSavings(cart, menu);
  } catch (error) {
    // A removed product, obsolete size, or invalid current price cannot make
    // a usable proposal. The ordinary cart UI retains its own issue handling.
    if (error instanceof DomainError) return null;
    throw error;
  }
}

function findValidMealSavings(cart: Cart, menu: Menu): MealSavingsPlan | null {
  const before = priceCart(cart, menu);
  if (before.issues.length) return null;

  const sandwiches = cart.lines.filter(
    (line) =>
      ["cheeseburger", "classic", "chicken"].includes(line.product_id) &&
      !line.meal &&
      !menu.products.find((p) => p.id === line.product_id)?.meal,
  );
  const sides = cart.lines.filter(
    (line) =>
      line.product_id === "fries" &&
      line.variant === "medium" &&
      unmodified(line),
  );
  const drinks = cart.lines.filter(
    (line) =>
      ["cola", "lemonade", "tea"].includes(line.product_id) &&
      !menu.products.find((p) => p.id === line.product_id)?.meal &&
      unmodified(line),
  );
  const sideCount = sides.reduce((sum, line) => sum + line.quantity, 0);
  if (!sandwiches.length || !drinks.length || !sideCount) return null;

  const source = 0;
  const drinkOffset = sandwiches.length + 1;
  const sink = drinkOffset + drinks.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from: number, to: number, capacity: number) => {
    const edge = { to, reverse: graph[to].length, capacity };
    graph[from].push(edge);
    graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0 });
    return edge;
  };
  const pairings: {
    sandwich: Line;
    drink: Line;
    edge: Edge;
    capacity: number;
  }[] = [];
  sandwiches.forEach((sandwich, i) => {
    addEdge(source, i + 1, sandwich.quantity);
    drinks.forEach((drink, j) => {
      // Ask the engine, including its price validation, whether this exact
      // sandwich and drink can be represented. Never copy its price formula.
      try {
        const converted = applyCommands(
          { version: 0, lines: [{ ...sandwich, quantity: 1 }], issues: [] },
          menu,
          [
            {
              type: "meal",
              line_id: sandwich.id,
              drink: drink.product_id,
              drink_variant: drink.variant!,
            },
          ],
        );
        if (priceCart(converted, menu).issues.length) return;
        const capacity = Math.min(sandwich.quantity, drink.quantity);
        pairings.push({
          sandwich,
          drink,
          capacity,
          edge: addEdge(i + 1, drinkOffset + j, capacity),
        });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
      }
    });
  });
  drinks.forEach((drink, j) => addEdge(drinkOffset + j, sink, drink.quantity));

  // Edmonds-Karp on at most 62 vertices; integral capacities preserve counts.
  // Traversal follows cart order, making previews and their split IDs stable.
  let matched = 0;
  while (matched < sideCount) {
    const parent: ({ from: number; edge: Edge } | undefined)[] = new Array(
      graph.length,
    );
    const visited = new Set([source]);
    const queue = [source];
    for (let head = 0; head < queue.length && !visited.has(sink); head++) {
      const from = queue[head];
      for (const edge of graph[from]) {
        if (edge.capacity <= 0 || visited.has(edge.to)) continue;
        visited.add(edge.to);
        parent[edge.to] = { from, edge };
        queue.push(edge.to);
      }
    }
    if (!visited.has(sink)) break;
    let amount = sideCount - matched;
    for (let node = sink; node !== source; node = parent[node]!.from)
      amount = Math.min(amount, parent[node]!.edge.capacity);
    for (let node = sink; node !== source; node = parent[node]!.from) {
      const { edge } = parent[node]!;
      edge.capacity -= amount;
      graph[node][edge.reverse].capacity += amount;
    }
    matched += amount;
  }
  if (!matched) return null;

  const consumed = new Map<string, number>();
  const allocations = new Map<
    string,
    { drink: string; drink_variant: string; quantity: number }[]
  >();
  const groups: MealSavingsGroup[] = [];
  let sideIndex = 0;
  for (const { sandwich, drink, capacity, edge } of pairings) {
    const quantity = capacity - edge.capacity;
    if (!quantity) continue;
    consumed.set(drink.id, (consumed.get(drink.id) ?? 0) + quantity);
    const entries = allocations.get(sandwich.id) ?? [];
    const existing = entries.find(
      (entry) =>
        entry.drink === drink.product_id &&
        entry.drink_variant === drink.variant,
    );
    if (existing) existing.quantity += quantity;
    else
      entries.push({
        drink: drink.product_id,
        drink_variant: drink.variant!,
        quantity,
      });
    allocations.set(sandwich.id, entries);

    let remaining = quantity;
    while (remaining > 0) {
      const side = sides[sideIndex];
      const available = side.quantity - (consumed.get(side.id) ?? 0);
      const count = Math.min(available, remaining);
      consumed.set(side.id, (consumed.get(side.id) ?? 0) + count);
      remaining -= count;
      if (count === available) sideIndex++;
      groups.push({
        sandwich_line_id: sandwich.id,
        side_line_id: side.id,
        drink_line_id: drink.id,
        product_id: sandwich.product_id,
        drink: drink.product_id,
        drink_variant: drink.variant!,
        quantity: count,
        summary: `${count} × ${menu.products.find((p) => p.id === sandwich.product_id)!.name} meal with medium fries and ${drink.variant} ${menu.products.find((p) => p.id === drink.product_id)!.name}`,
      });
    }
  }

  const ids = new Set(cart.lines.map((line) => line.id));
  const splitId = (line: Line, key: string) => {
    let attempt = 0;
    let id: string;
    do {
      const hash = createHash("sha256")
        .update(JSON.stringify([line.id, cart.version, key, attempt++]))
        .digest();
      // Stable UUID-shaped IDs remain valid in cart, quote and MCP contracts.
      hash[6] = (hash[6] & 0x0f) | 0x40;
      hash[8] = (hash[8] & 0x3f) | 0x80;
      const hex = hash.subarray(0, 16).toString("hex");
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } while (ids.has(id));
    ids.add(id);
    return id;
  };
  const next = structuredClone(cart);
  next.lines = cart.lines.flatMap((line) => {
    const entries = allocations.get(line.id);
    if (entries) {
      const result: Line[] = entries.map(({ quantity, ...meal }, index) => ({
        ...structuredClone(line),
        id: index === 0 ? line.id : splitId(line, JSON.stringify(meal)),
        quantity,
        meal,
      }));
      const remaining =
        line.quantity - entries.reduce((sum, entry) => sum + entry.quantity, 0);
      if (remaining)
        result.push({
          ...structuredClone(line),
          id: splitId(line, "standalone"),
          quantity: remaining,
        });
      return result;
    }
    const remaining = line.quantity - (consumed.get(line.id) ?? 0);
    return remaining ? [{ ...structuredClone(line), quantity: remaining }] : [];
  });
  if (next.lines.length > 30) return null;
  const after = priceCart(next, menu);
  const savings = before.totals.total - after.totals.total;
  const subtotalSavings = before.totals.subtotal - after.totals.subtotal;
  if (after.issues.length || savings <= 0 || subtotalSavings <= 0) return null;
  return {
    cart: next,
    before: before.totals,
    after: after.totals,
    savings_cents: savings,
    subtotal_savings_cents: subtotalSavings,
    groups,
  };
}
