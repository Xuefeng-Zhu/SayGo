import type { Totals } from "./index";
import { z } from "zod";

const connection = z.string().min(1).max(128);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const prepareVoiceConfirmationSchema = z
  .object({
    connection_id: connection,
    quote_id: z.string().uuid(),
    request_id: z.string().uuid(),
  })
  .strict();
export const armVoiceConfirmationSchema = z
  .object({
    connection_id: connection,
    readback_id: z.string().uuid(),
    readback_hash: z.string().regex(/^[a-f0-9]{64}$/),
    turn_sequence: sequence,
  })
  .strict();
export const voiceOrderEvidenceSchema = z
  .object({
    connection_id: connection,
    readback_id: z.string().uuid(),
    utterance_id: z.string().min(1).max(160),
    turn_sequence: sequence,
    started_at: sequence,
    finalized_at: sequence,
    transcript: z.string().min(1).max(1000),
    source: z.literal("nova_audio"),
    final: z.literal(true),
  })
  .strict();
export type PrepareVoiceConfirmationInput = z.infer<
  typeof prepareVoiceConfirmationSchema
>;
export type ArmVoiceConfirmationInput = z.infer<
  typeof armVoiceConfirmationSchema
>;
export type VoiceOrderEvidence = z.infer<typeof voiceOrderEvidenceSchema>;

export type VoiceConfirmation = {
  readback_id: string;
  quote_id: string;
  session_id: string;
  epoch: number;
  fence: number;
  cart_version: number;
  readback_hash: string;
  readback_text: string;
  totals: Totals;
  status: "reading" | "awaiting_confirmation";
  ready_at: string | null;
  expires_at: string;
};

// This is lexical normalization, never model-based interpretation of consent.
export function normalizeVoiceText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const affirmativeOrders = new Set([
  "yes place the order",
  "yes place my order",
  "yes please place the order",
  "yes please place my order",
]);

export function isExplicitVoiceConfirmation(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return (
    text.length <= 200 &&
    // Preserve interrogative uncertainty before lexical punctuation stripping.
    // NFKC folds full-width/small question marks; other scripts retain theirs.
    !/[?\u00bf\u037e\u055e\u061f\u1367\u1945\u203d\u2047-\u2049\u2e2e\u2e54\ua60f\ua6f7]/u.test(
      normalized,
    ) &&
    affirmativeOrders.has(normalizeVoiceText(normalized))
  );
}
