import { describe, expect, it } from "vitest";
import {
  isExplicitVoiceConfirmation,
  normalizeVoiceText,
  voiceOrderEvidenceSchema,
  type QuoteSnapshot,
} from "@saygo/contracts";
import {
  moneyWords,
  numberWords,
  voiceReadback,
} from "../../packages/domain/src/voice-readback";

describe("explicit voice consent contract", () => {
  it.each([
    "Yes, place the order.",
    "YES please place my order!",
    "Yes—place my order",
    "yes please place the order",
  ])("accepts the complete affirmative %s", (text) => {
    expect(isExplicitVoiceConfirmation(text)).toBe(true);
  });
  it.each([
    "yes",
    "okay",
    "yes please",
    "place the order",
    "do not place the order",
    "don't place my order",
    "no, yes place the order",
    "yes place the order but no onions",
    "maybe yes place the order",
    "yes place the order?",
    "yes place the order？",
    "yes place the order﹖",
    "yes place the order؟",
    "yes place the order‽",
    "yes place the order⁇",
    "I said yes place the order",
    "yes place",
    "yes place the order cancel that",
    "",
    "yes place the order".repeat(20),
  ])("rejects incomplete, negated or qualified consent %s", (text) => {
    expect(isExplicitVoiceConfirmation(text)).toBe(false);
  });
  it("normalizes punctuation without interpreting or deleting meaning", () => {
    expect(normalizeVoiceText("No—do NOT place the order!")).toBe(
      "no do not place the order",
    );
    expect(normalizeVoiceText("Seventy-two cents.")).toBe("seventy two cents");
  });
  it("does not treat partial, typed or model-declared source as audio proof", () => {
    const proof = {
      connection_id: "connection",
      readback_id: "6bdabf01-65e7-4eb7-b547-e221069051be",
      utterance_id: "turn-2",
      turn_sequence: 2,
      started_at: 1000,
      finalized_at: 2000,
      transcript: "Yes, place the order.",
      source: "nova_audio",
      final: true,
    };
    expect(voiceOrderEvidenceSchema.safeParse(proof).success).toBe(true);
    for (const change of [
      { final: false },
      { source: "text" },
      { source: "model_tool" },
      { started_at: -1 },
      { turn_sequence: 1.5 },
      { approved: true },
    ])
      expect(
        voiceOrderEvidenceSchema.safeParse({ ...proof, ...change }).success,
      ).toBe(false);
  });
});

describe("canonical order readback", () => {
  const quote: QuoteSnapshot = {
    cart_version: 3,
    menu_version: 1,
    price_version: 1,
    fulfillment: "drive_through",
    payment: "due_at_window",
    lines: [
      {
        id: "burger",
        product_id: "classic",
        variant: "regular",
        quantity: 1,
        choices: { remove: ["onions"] },
        name: "Classic Burger",
        modifiers: ["No onions"],
        unit_price: 575,
        line_total: 575,
      },
      {
        id: "drink",
        product_id: "lemonade",
        variant: "medium",
        quantity: 1,
        choices: { ice: ["none"] },
        name: "Lemonade",
        modifiers: ["Medium", "No ice"],
        unit_price: 325,
        line_total: 325,
      },
    ],
    totals: { subtotal: 900, tax: 72, total: 972, currency: "USD" },
  };
  it("reads every priced selection and canonical total rather than a model total", () => {
    expect(voiceReadback(quote)).toBe(
      "One Classic Burger, no onions. One Lemonade, medium, no ice. Total nine dollars and seventy-two cents including tax. Say yes, place the order to confirm, or tell me what to change.",
    );
    const changed = structuredClone(quote);
    changed.lines[0].quantity = 2;
    changed.lines[0].modifiers.push("No cheese");
    changed.totals.total = 1501;
    const text = voiceReadback(changed);
    expect(text).toContain("Two Classic Burger, no onions, no cheese.");
    expect(text).toContain("Total fifteen dollars and one cent including tax.");
  });
  it("handles singular, zero and larger exact-cent amounts", () => {
    expect(moneyWords(100)).toBe("one dollar");
    expect(moneyWords(1)).toBe("zero dollars and one cent");
    expect(moneyWords(0)).toBe("zero dollars");
    expect(numberWords(1001)).toBe("one thousand one");
    expect(() => moneyWords(-1)).toThrow();
    expect(() => numberWords(2.5)).toThrow();
  });
});
