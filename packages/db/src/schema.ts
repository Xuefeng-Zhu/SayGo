import type {
  Product,
  Line,
  Issue,
  QuoteSnapshot,
  Cart,
  CartReceipt,
} from "@saygo/contracts";

export type SessionRow = {
  id: string;
  restaurant_id: string;
  lane_id: string;
  epoch: number;
  fence: number;
  owner: "ai" | "staff";
  status: string;
  token_hash: string;
  voice_until: string | null;
  needs_staff_review: boolean;
  staff_message: string | null;
  created_at: string;
  expires_at: string;
  active_quote_id?: string | null;
};
export type QuoteRow = {
  id: string;
  session_id: string;
  snapshot: QuoteSnapshot;
  payload_hash: string;
  fence: number;
  valid: boolean;
  expires_at: string;
  request_id: string | null;
  request_actor: string | null;
  request_hash: string | null;
};
export type OrderRow = {
  id: string;
  number: number;
  session_id: string;
  restaurant_id: string;
  quote_id: string;
  external_key: string;
  payload_hash: string;
  snapshot: QuoteSnapshot;
  status: string;
  created_at: string;
  updated_at: string;
};
export type CartUndo = {
  receipt_id: string;
  before: Cart;
  menu_version: number;
  price_version: number;
  fence: number;
  cart_hash: string;
};
export type Rows = {
  restaurants: {
    id: string;
    name: string;
    timezone: string;
    menu_version: number;
    price_version: number;
    instructions: string;
    upsell_enabled: boolean;
    pos_mode: string;
    order_number: number;
  };
  products: { id: string; restaurant_id: string; data: Product };
  lanes: {
    id: string;
    restaurant_id: string;
    epoch: number;
    current_session: string | null;
  };
  staff_users: {
    id: string;
    restaurant_id: string;
    role: string;
    password_hash: string;
    enabled: boolean;
  };
  interactions: SessionRow;
  carts: {
    session_id: string;
    version: number;
    lines: Line[];
    issues: Issue[];
    last_change?: CartReceipt | null;
    undo?: CartUndo | null;
  };
  quotes: QuoteRow;
  approvals: {
    quote_id: string;
    session_id: string;
    created_at: string;
    consumed_at: string | null;
  };
  orders: OrderRow;
  jobs: {
    id: string;
    order_id: string;
    state: string;
    attempts: number;
    available_at: string;
    lease_until: string | null;
    lease_token: string | null;
  };
  pos_receipts: {
    external_key: string;
    payload_hash: string;
    status: "accepted" | "rejected";
    visible_at: string;
    created_at: string;
  };
  pos_attempts: {
    id: string;
    order_id: string;
    operation: string;
    outcome: string;
    created_at: string;
  };
  handoffs: {
    id: string;
    session_id: string;
    reason: string;
    concern: string | null;
    resolved: boolean;
    created_at: string;
  };
  idempotency: {
    key: string;
    payload_hash: string;
    created_at: string;
    quote_id?: string;
  };
  audit: {
    id: string;
    session_id: string | null;
    kind: string;
    details: object;
    created_at: string;
  };
};
export type Entity = keyof Rows;
export const entities: Entity[] = [
  "restaurants",
  "products",
  "lanes",
  "staff_users",
  "interactions",
  "carts",
  "quotes",
  "approvals",
  "orders",
  "jobs",
  "pos_receipts",
  "pos_attempts",
  "handoffs",
  "idempotency",
  "audit",
];
export function rowId<E extends Entity>(entity: E, row: Rows[E]): string {
  const value = row as unknown as Record<string, unknown>;
  const key =
    entity === "carts" || entity === "orders"
      ? "session_id"
      : entity === "approvals"
        ? "quote_id"
        : entity === "pos_receipts"
          ? "external_key"
          : entity === "idempotency"
            ? "key"
            : "id";
  if (typeof value[key] !== "string" || !value[key])
    throw new Error("Invalid entity key");
  return value[key];
}
