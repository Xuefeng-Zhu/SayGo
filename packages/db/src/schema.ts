import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  serial,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Product, Line, Issue, QuoteSnapshot } from "@saygo/contracts";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });
export const restaurants = pgTable("restaurants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  menuVersion: integer("menu_version").notNull().default(1),
  priceVersion: integer("price_version").notNull().default(1),
  instructions: text("instructions").notNull(),
  upsellEnabled: boolean("upsell_enabled").notNull().default(false),
  posMode: text("pos_mode").notNull().default("accept"),
});
export const products = pgTable("products", {
  id: text("id").primaryKey(),
  restaurantId: text("restaurant_id")
    .notNull()
    .references(() => restaurants.id),
  data: jsonb("data").$type<Product>().notNull(),
});
export const lanes = pgTable("lanes", {
  id: text("id").primaryKey(),
  restaurantId: text("restaurant_id")
    .notNull()
    .references(() => restaurants.id),
  epoch: integer("epoch").notNull().default(0),
  currentSession: uuid("current_session"),
});
export const staffUsers = pgTable("staff_users", {
  id: text("id").primaryKey(),
  restaurantId: text("restaurant_id")
    .notNull()
    .references(() => restaurants.id),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});
export const interactions = pgTable("interactions", {
  id: uuid("id").primaryKey(),
  laneId: text("lane_id")
    .notNull()
    .references(() => lanes.id),
  restaurantId: text("restaurant_id")
    .notNull()
    .references(() => restaurants.id),
  epoch: integer("epoch").notNull(),
  fence: integer("fence").notNull().default(0),
  owner: text("owner").notNull().default("ai"),
  status: text("status").notNull().default("active"),
  tokenHash: text("token_hash").notNull(),
  voiceUntil: time("voice_until"),
  needsStaffReview: boolean("needs_staff_review").notNull().default(false),
  staffMessage: text("staff_message"),
  createdAt: time("created_at").notNull().defaultNow(),
  expiresAt: time("expires_at").notNull(),
});
export const carts = pgTable("carts", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => interactions.id),
  version: integer("version").notNull().default(0),
  lines: jsonb("lines").$type<Line[]>().notNull().default([]),
  issues: jsonb("issues").$type<Issue[]>().notNull().default([]),
});
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => interactions.id),
    snapshot: jsonb("snapshot").$type<QuoteSnapshot>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    fence: integer("fence").notNull(),
    valid: boolean("valid").notNull().default(true),
    expiresAt: time("expires_at").notNull(),
    requestId: uuid("request_id"),
    requestActor: text("request_actor"),
    requestHash: text("request_hash"),
  },
  (table) => [
    uniqueIndex("quotes_request_identity").on(
      table.sessionId,
      table.requestActor,
      table.requestId,
    ),
  ],
);
export const approvals = pgTable("approvals", {
  quoteId: uuid("quote_id")
    .primaryKey()
    .references(() => quotes.id),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => interactions.id),
  createdAt: time("created_at").notNull().defaultNow(),
  consumedAt: time("consumed_at"),
});
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey(),
  number: serial("number").notNull(),
  sessionId: uuid("session_id")
    .notNull()
    .unique()
    .references(() => interactions.id),
  restaurantId: text("restaurant_id")
    .notNull()
    .references(() => restaurants.id),
  quoteId: uuid("quote_id")
    .notNull()
    .unique()
    .references(() => quotes.id),
  externalKey: text("external_key").notNull().unique(),
  payloadHash: text("payload_hash").notNull(),
  snapshot: jsonb("snapshot").$type<QuoteSnapshot>().notNull(),
  status: text("status").notNull().default("submitted"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: time("available_at").notNull().defaultNow(),
  leaseUntil: time("lease_until"),
  leaseToken: uuid("lease_token"),
});
export const posReceipts = pgTable("pos_receipts", {
  externalKey: text("external_key").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull(),
  visibleAt: time("visible_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const posAttempts = pgTable("pos_attempts", {
  id: serial("id").primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  operation: text("operation").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const handoffs = pgTable("handoffs", {
  id: uuid("id").primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => interactions.id),
  reason: text("reason").notNull(),
  concern: text("concern"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const idempotency = pgTable("idempotency", {
  key: text("key").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});
export const audit = pgTable("audit", {
  id: serial("id").primaryKey(),
  sessionId: uuid("session_id"),
  kind: text("kind").notNull(),
  details: jsonb("details").notNull().default({}),
  createdAt: time("created_at").notNull().defaultNow(),
});
