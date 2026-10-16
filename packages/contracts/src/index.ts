import { z } from "zod";
export const id = z
  .string()
  .min(1)
  .max(100)
  .describe(
    "Exact stable ID returned by a preceding menu/cart tool; never invent an ID.",
  );
const expectedVersion = z
  .number()
  .int()
  .nonnegative()
  .describe(
    "Latest cart_version from get_cart; refresh after a version conflict.",
  );
const requestId = z
  .string()
  .uuid()
  .describe(
    "Caller-generated fresh UUID v4 (8-4-4-4-12 hex digits; third group starts 4, fourth starts 8/9/a/b). Never use zero-filled sequential placeholders. Reuse with identical arguments after a lost response; never reuse for a changed request.",
  );
export const choiceSchema = z
  .record(z.string().max(50), z.array(z.string().max(50)).max(8))
  .describe(
    'Map exact group IDs to option IDs from get_item_details; e.g. {"remove":["onions"]}. An update replaces the ENTIRE choices map: preserve all wanted groups from get_cart; {} clears all. Never send free-text notes.',
  );
const variant = z
  .string()
  .max(40)
  .describe(
    "Exact variant key from the product, e.g. 'large'. Omit only when unspecified; required choices still block review.",
  );
const quantity = z
  .number()
  .int()
  .min(1)
  .max(10)
  .describe(
    "Item count from 1 to 10; added items receive individual stable line IDs.",
  );
const selection = {
  product_id: id,
  variant: variant.optional(),
  choices: choiceSchema.default({}),
  quantity: quantity.default(1),
};
export const menuPriceSelectionSchema = z
  .object({
    ...selection,
    meal_drink_variant: variant
      .optional()
      .describe(
        "Required for a listed meal product: explicitly declare the customer's requested drink size. Listed meals include medium only. For a large drink, select the standalone base product with meal.drink_variant='large', not a listed meal.",
      ),
    meal: z
      .object({ drink: id, drink_variant: variant })
      .strict()
      .optional()
      .describe(
        "Optional conversion of an eligible standalone sandwich to a meal. For a listed meal product, choose its drink through choices instead.",
      ),
  })
  .strict();
export const menuPriceInputSchema = z
  .object({
    comparison_kind: z
      .enum(["price_gap", "signed_change"])
      .default("price_gap")
      .describe(
        "price_gap returns a NONNEGATIVE premium/savings magnitude regardless of option order. Use signed_change ONLY when the customer explicitly requests a signed later-minus-first change; negative signed change is never an unsigned upgrade cost.",
      ),
    options: z
      .array(
        z
          .object({
            label: z
              .string()
              .regex(/^[A-Za-z0-9_-]{1,40}$/)
              .describe(
                "Unique label for this candidate, e.g. baseline or upgraded. The FIRST option is the comparison baseline.",
              ),
            selections: z.array(menuPriceSelectionSchema).min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .describe(
        "Complete hypothetical selections to price without changing the cart. Each later option is compared against the first; comparison_kind chooses a nonnegative gap or an explicitly signed later-minus-first change.",
      ),
  })
  .strict()
  .refine(
    (v) => new Set(v.options.map((x) => x.label)).size === v.options.length,
    "Use unique option labels.",
  );
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), ...selection }).strict(),
  z
    .object({
      type: z.literal("update"),
      line_id: id,
      variant: variant.optional(),
      choices: choiceSchema.optional(),
      quantity: quantity.optional(),
    })
    .strict(),
  z.object({ type: z.literal("remove"), line_id: id }).strict(),
  z
    .object({
      type: z.literal("meal"),
      line_id: id,
      drink: id,
      drink_variant: variant,
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const changesSchema = z
  .object({
    expected_version: expectedVersion,
    request_id: requestId,
    commands: z
      .array(commandSchema)
      .max(20)
      .describe(
        "Atomic typed changes. Example: [{type:'update',line_id:<returned ID>,variant:'large'}]. Use [] only with clarification.",
      ),
    clarification: z
      .enum(["ambiguous_line", "unsupported_request"])
      .optional()
      .describe(
        "Pause for clarification instead of guessing an item or unsupported change. Use commands:[] to leave selections unchanged.",
      ),
  })
  .strict()
  .refine(
    (v) => v.commands.length > 0 || v.clarification !== undefined,
    "Provide changes or a clarification",
  );
export const toolSchemas = {
  get_menu: z.object({}).strict(),
  get_item_details: z.object({ product_id: id }).strict(),
  compare_menu_prices: menuPriceInputSchema,
  find_meal_savings: z.object({}).strict(),
  get_cart: z.object({}).strict(),
  apply_cart_changes: changesSchema,
  prepare_order_review: z
    .object({ expected_version: expectedVersion, request_id: requestId })
    .strict(),
  submit_order: z
    .object({
      quote_id: z
        .string()
        .uuid()
        .describe(
          "Exact quote ID already approved by the customer UI. Retry the same ID, never create a replacement order.",
        ),
    })
    .strict(),
  get_order_status: z.object({}).strict(),
  request_staff_help: z
    .object({
      reason: z
        .enum(["assistance", "allergy", "accepted_change"])
        .describe(
          "Use allergy for any allergen/cross-contact concern, accepted_change for a submitted-order change, otherwise assistance.",
        ),
      concern: z
        .string()
        .max(300)
        .optional()
        .describe(
          "Optional short concern sent only to staff; omit unnecessary personal information. It is not echoed in agent/customer results.",
        ),
    })
    .strict(),
  cancel_draft_order: z
    .object({
      expected_version: expectedVersion,
      reset_token: z
        .string()
        .min(20)
        .max(100)
        .optional()
        .describe(
          "Reserved for the authenticated customer reset action. Agents must omit this field; supplying it cannot grant consent.",
        ),
    })
    .strict(),
};
export type ToolName = keyof typeof toolSchemas;
export * from "./mcp";
export type Product = {
  id: string;
  name: string;
  category: "Burgers" | "Chicken" | "Sides" | "Drinks" | "Meals";
  description: string;
  aliases: string[];
  ingredients: string[];
  available: boolean;
  variants: Record<string, number>;
  groups: Record<
    string,
    {
      label: string;
      min: number;
      max: number;
      options: Record<string, { label: string; price: number }>;
    }
  >;
  meal?: { base: string; side: string; drinks: string[]; discount: number };
};
export type Menu = {
  version: number;
  price_version: number;
  currency: "USD";
  products: Product[];
  instructions: string;
  upsell_enabled: boolean;
};
export type Line = {
  id: string;
  product_id: string;
  variant?: string;
  choices: Record<string, string[]>;
  quantity: number;
  meal?: { drink: string; drink_variant: string };
};
export type PricedLine = Line & {
  name: string;
  unit_price: number;
  line_total: number;
  modifiers: string[];
};
export type Issue = { code: string; message: string; line_id?: string };
export type Totals = {
  subtotal: number;
  tax: number;
  total: number;
  currency: "USD";
};
export type Cart = { version: number; lines: Line[]; issues: Issue[] };
export type Scope = {
  restaurant_id: string;
  lane_id: string;
  session_id: string;
  epoch: number;
  fence: number;
  actor: "agent" | "customer" | "staff";
};
export type OrderStatus =
  | "submitted"
  | "unknown"
  | "accepted"
  | "rejected"
  | "preparing"
  | "ready"
  | "handed_off";
export type Order = {
  id: string;
  number: number;
  status: OrderStatus;
  snapshot: QuoteSnapshot;
  created_at: string;
  updated_at: string;
};
export type QuoteSnapshot = {
  cart_version: number;
  menu_version: number;
  price_version: number;
  lines: PricedLine[];
  totals: Totals;
  fulfillment: "drive_through";
  payment: "due_at_window";
};
export type Quote = {
  id: string;
  expires_at: string;
  snapshot: QuoteSnapshot;
  approved: boolean;
};
export type CartReceipt = {
  id: string;
  kind: "correction" | "meal_savings" | "undo";
  cart_version: number;
  created_at: string;
  changes: {
    line_id: string;
    before: PricedLine | null;
    after: PricedLine | null;
  }[];
  before_totals: Totals;
  after_totals: Totals;
  total_delta_cents: number;
  undo_available: boolean;
  undo_unavailable_reason?: string;
};
export type MealSavingsProposal = {
  id: string;
  cart_version: number;
  menu_version: number;
  price_version: number;
  before: Totals;
  after: Totals;
  savings_cents: number;
  subtotal_savings_cents: number;
  groups: {
    sandwich_line_id: string;
    side_line_id: string;
    drink_line_id: string;
    product_id: string;
    drink: string;
    drink_variant: string;
    quantity: number;
    summary: string;
  }[];
};
export type View = {
  session: {
    id: string;
    epoch: number;
    fence: number;
    owner: "ai" | "staff";
    status: string;
    staff_message: string | null;
    needs_staff_review: boolean;
  };
  cart: Cart;
  lines: PricedLine[];
  totals: Totals;
  unresolved_choices: Issue[];
  quote: Quote | null;
  order: Order | null;
  menu: Menu;
  cart_version: number;
  summary: string;
  last_change: CartReceipt | null;
  meal_savings: MealSavingsProposal | null;
  reset_token?: string;
  timing?: { tool_ms: number };
};
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
