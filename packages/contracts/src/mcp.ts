import { z } from "zod";

const stableId = z.string().min(1).max(100);
const version = z.number().int().nonnegative();
const cents = z
  .number()
  .int()
  .nonnegative()
  .describe("Integer USD cents, not dollars.");
const choices = z.record(z.string(), z.array(z.string()));
const pricedLine = z
  .object({
    id: z.string().uuid(),
    product_id: stableId,
    variant: z.string().optional(),
    choices,
    quantity: z.number().int().min(1).max(10),
    meal: z
      .object({ drink: stableId, drink_variant: z.string() })
      .strict()
      .optional(),
    name: z.string(),
    unit_price: cents,
    line_total: cents,
    modifiers: z.array(z.string()),
  })
  .strict();
const totals = z
  .object({
    subtotal: cents,
    tax: cents,
    total: cents,
    currency: z.literal("USD"),
  })
  .strict();
const issue = z
  .object({
    code: z.string(),
    message: z.string(),
    line_id: stableId.optional(),
  })
  .strict();
const snapshot = z
  .object({
    cart_version: version,
    menu_version: version,
    price_version: version,
    lines: z.array(pricedLine),
    totals,
    fulfillment: z.literal("drive_through"),
    payment: z.literal("due_at_window"),
  })
  .strict();
const quote = z
  .object({
    id: z.string().uuid(),
    expires_at: z.iso.datetime(),
    snapshot,
    approved: z.boolean(),
  })
  .strict();
const orderStatus = z.enum([
  "submitted",
  "unknown",
  "accepted",
  "rejected",
  "preparing",
  "ready",
  "handed_off",
]);
export const orderSummarySchema = z
  .object({
    id: z.string().uuid(),
    number: z.number().int().positive(),
    status: orderStatus,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    payment: z.literal("due_at_window"),
  })
  .strict();
export const productSchema = z
  .object({
    id: stableId,
    name: z.string(),
    category: z.enum(["Burgers", "Chicken", "Sides", "Drinks", "Meals"]),
    description: z.string(),
    aliases: z.array(z.string()),
    ingredients: z.array(z.string()),
    available: z.boolean(),
    variants: z.record(z.string(), cents),
    groups: z.record(
      z.string(),
      z
        .object({
          label: z.string(),
          min: version,
          max: version,
          options: z.record(
            z.string(),
            z.object({ label: z.string(), price: cents }).strict(),
          ),
        })
        .strict(),
    ),
    meal: z
      .object({
        base: stableId,
        side: stableId,
        drinks: z.array(stableId),
        discount: cents,
      })
      .strict()
      .optional(),
  })
  .strict();
const menu = z
  .object({
    version,
    price_version: version,
    currency: z.literal("USD"),
    products: z.array(productSchema),
    instructions: z.string(),
    upsell_enabled: z.boolean(),
  })
  .strict();
const summary = z.string();
export const mealSavingsProposalSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    cart_version: version,
    menu_version: version,
    price_version: version,
    before: totals,
    after: totals,
    savings_cents: cents,
    subtotal_savings_cents: cents,
    groups: z.array(
      z
        .object({
          sandwich_line_id: stableId,
          side_line_id: stableId,
          drink_line_id: stableId,
          product_id: stableId,
          drink: stableId,
          drink_variant: z.string(),
          quantity: z.number().int().min(1).max(10),
          summary: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
const comparisonDetails = {
  label: stableId,
  absolute_subtotal_difference_cents: cents,
  more_expensive_label: stableId.nullable(),
};
const comparisonSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...comparisonDetails,
      kind: z.literal("price_gap"),
      amount_cents: cents.describe(
        "Nonnegative premium or savings magnitude; never negate it.",
      ),
    })
    .strict(),
  z
    .object({
      ...comparisonDetails,
      kind: z.literal("signed_change"),
      amount_cents: z.number().int(),
      subtotal_delta_cents: z.number().int(),
    })
    .strict(),
]);
export const cartResultSchema = z
  .object({
    cart_version: version,
    menu_version: version,
    price_version: version,
    lines: z.array(pricedLine),
    totals,
    unresolved_choices: z.array(issue),
    control: z
      .object({
        owner: z.enum(["ai", "staff"]),
        needs_staff_review: z.boolean(),
      })
      .strict(),
    quote: quote.nullable(),
    order: orderSummarySchema.nullable(),
    summary,
  })
  .strict();
export type CartResult = z.infer<typeof cartResultSchema>;

// Success payloads contain only the data needed for the named operation. The UI
// uses its separate, authenticated full-state endpoint instead of this contract.
export const toolDataSchemas = {
  find_meal_savings: z
    .object({
      proposal: mealSavingsProposalSchema.nullable(),
      summary,
    })
    .strict(),
  get_menu: z.object({ menu, summary }).strict(),
  get_item_details: z.object({ product: productSchema, summary }).strict(),
  compare_menu_prices: z
    .object({
      menu_version: version,
      price_version: version,
      currency: z.literal("USD"),
      baseline_label: stableId,
      options: z.array(
        z
          .object({
            label: stableId,
            totals,
            lines: z.array(
              z
                .object({
                  product_id: stableId,
                  variant: z.string().optional(),
                  quantity: z.number().int().min(1).max(10),
                  choices,
                  meal: z
                    .object({
                      drink: stableId,
                      drink_variant: z.string(),
                      kind: z.enum(["listed", "conversion"]),
                    })
                    .strict()
                    .optional(),
                  unit_price: cents,
                  line_total: cents,
                  modifiers: z.array(z.string()),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
      comparisons: z.array(comparisonSchema),
      summary,
    })
    .strict(),
  get_cart: cartResultSchema,
  apply_cart_changes: cartResultSchema,
  prepare_order_review: z.object({ quote, summary }).strict(),
  submit_order: z.object({ order: orderSummarySchema, summary }).strict(),
  get_order_status: z
    .object({ order: orderSummarySchema.nullable(), summary })
    .strict(),
  request_staff_help: z
    .object({
      control: z
        .object({
          owner: z.enum(["ai", "staff"]),
          needs_staff_review: z.literal(true),
        })
        .strict(),
      summary,
    })
    .strict(),
  cancel_draft_order: z
    .object({ cart_version: version, reset_token: z.string().min(20), summary })
    .strict(),
};
export const recoverySchema = z
  .object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(1000),
    retryable: z
      .boolean()
      .describe(
        "Whether this identical request may be retried now. False means follow next_action first; never blindly replay a write.",
      ),
    next_action: z.enum([
      "refresh_cart",
      "review_order",
      "confirm_order",
      "confirm_reset",
      "wait_for_staff",
      "start_session",
      "correct_arguments",
      "browse_menu",
      "reconcile_order",
      "retry_read",
      "contact_staff",
      "wait_for_voice",
      "new_request_id",
      "refresh_credentials",
      "wait_then_retry",
    ]),
    retry_after_ms: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Minimum wait before considering a retry; preserve the original write identity and reconcile first.",
      ),
  })
  .strict();
export type Recovery = z.infer<typeof recoverySchema>;

function outputSchema<T extends z.ZodType>(data: T) {
  // The outer object is required by MCP's root-object output schema convention.
  // Both success and execution-error payloads conform to the advertised schema.
  return z
    .object({
      result: z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), data }).strict(),
        z.object({ ok: z.literal(false), error: recoverySchema }).strict(),
      ]),
    })
    .strict();
}
export const toolOutputSchemas = {
  find_meal_savings: outputSchema(toolDataSchemas.find_meal_savings),
  get_menu: outputSchema(toolDataSchemas.get_menu),
  get_item_details: outputSchema(toolDataSchemas.get_item_details),
  compare_menu_prices: outputSchema(toolDataSchemas.compare_menu_prices),
  get_cart: outputSchema(toolDataSchemas.get_cart),
  apply_cart_changes: outputSchema(toolDataSchemas.apply_cart_changes),
  prepare_order_review: outputSchema(toolDataSchemas.prepare_order_review),
  submit_order: outputSchema(toolDataSchemas.submit_order),
  get_order_status: outputSchema(toolDataSchemas.get_order_status),
  request_staff_help: outputSchema(toolDataSchemas.request_staff_help),
  cancel_draft_order: outputSchema(toolDataSchemas.cancel_draft_order),
};

const recoveryActions: Record<string, Recovery["next_action"]> = {
  STALE_SAVINGS: "refresh_cart",
  STALE_RECEIPT: "refresh_cart",
  UNDO_UNAVAILABLE: "refresh_cart",
  MEAL_SIZE_REQUIRED: "correct_arguments",
  LISTED_MEAL_SIZE: "correct_arguments",
  INCOMPLETE_SELECTION: "correct_arguments",
  VERSION_CONFLICT: "refresh_cart",
  STALE_QUOTE: "review_order",
  STALE_REVIEW_REQUEST: "review_order",
  CONSENT_REQUIRED: "confirm_order",
  CONSENT: "confirm_order",
  RESET_CONSENT: "confirm_reset",
  RESET: "confirm_reset",
  FENCED: "wait_for_staff",
  STAFF_REVIEW: "wait_for_staff",
  TAKEOVER: "wait_for_staff",
  SESSION_EXPIRED: "start_session",
  UNAUTHORIZED: "start_session",
  AUTH: "refresh_credentials",
  SCOPE: "refresh_credentials",
  ORDER_LOCKED: "contact_staff",
  VOICE_PENDING: "wait_for_voice",
  IDEMPOTENCY_MISMATCH: "new_request_id",
  UNKNOWN_PRODUCT: "browse_menu",
  EMPTY: "browse_menu",
  UNRESOLVED: "refresh_cart",
  INVALID_ARGUMENTS: "correct_arguments",
  UNKNOWN_TOOL: "correct_arguments",
  VARIANT: "browse_menu",
  MODIFIER: "browse_menu",
  QUANTITY: "correct_arguments",
  MEAL: "browse_menu",
  LINE: "refresh_cart",
  NOT_SEEDED: "contact_staff",
  UNAVAILABLE: "browse_menu",
  AMBIGUOUS: "refresh_cart",
  CART_LIMIT: "correct_arguments",
};
export function recoveryFor(code: string, message: string): Recovery {
  return recoverySchema.parse({
    code,
    message: message.slice(0, 1000),
    retryable: false,
    next_action: recoveryActions[code] ?? "contact_staff",
  });
}
