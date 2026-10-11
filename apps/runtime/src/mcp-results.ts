import {
  recoveryFor,
  toolDataSchemas,
  type ToolName,
  type View,
  type Order,
  type Recovery,
} from "@saygo/contracts";
import { DomainError } from "@saygo/domain";

const orderSummary = (order: Order | null) =>
  order
    ? {
        id: order.id,
        number: order.number,
        status: order.status,
        created_at: order.created_at,
        updated_at: order.updated_at,
        payment: "due_at_window" as const,
      }
    : null;

export function toolData(name: ToolName, raw: Record<string, unknown>) {
  const view = raw as unknown as View;
  let data: unknown;
  switch (name) {
    case "get_menu":
    case "get_item_details":
      data = raw;
      break;
    case "get_order_status":
    case "submit_order":
      data = { order: orderSummary(view.order), summary: view.summary };
      break;
    case "prepare_order_review":
      data = { quote: view.quote, summary: view.summary };
      break;
    case "request_staff_help":
      data = {
        control: {
          owner: view.session.owner,
          needs_staff_review: view.session.needs_staff_review,
        },
        summary: view.summary,
      };
      break;
    case "cancel_draft_order":
      data = {
        cart_version: view.cart_version,
        reset_token: view.reset_token,
        summary: view.summary,
      };
      break;
    default:
      data = {
        cart_version: view.cart_version,
        menu_version: view.menu.version,
        price_version: view.menu.price_version,
        lines: view.lines,
        totals: view.totals,
        unresolved_choices: view.unresolved_choices,
        control: {
          owner: view.session.owner,
          needs_staff_review: view.session.needs_staff_review,
        },
        quote: view.quote,
        order: orderSummary(view.order),
        summary: view.summary,
      };
  }
  return toolDataSchemas[name].parse(data);
}

export function executionRecovery(error: unknown, name: ToolName): Recovery {
  if (error instanceof DomainError)
    return recoveryFor(error.code, error.message);
  return {
    code: "INTERNAL_ERROR",
    message:
      "The operation could not be verified. Check canonical state before taking another action.",
    retryable: false,
    next_action: name === "submit_order" ? "reconcile_order" : "refresh_cart",
  };
}
