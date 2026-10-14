// Shared between the customer voice agent and text evaluation; no fixture prices,
// question IDs, expected answers, or verifier feedback belong in this guidance.
export const menuPriceGuidance =
  "Use compare_menu_prices for hypothetical totals, upgrades and savings. Read menu IDs and choices, then supply complete selections. For an upgrade/premium or savings magnitude, comparison_kind MUST be price_gap and the answer is the returned nonnegative amount_cents; never reverse or negate it based on input order. Use signed_change ONLY if the customer explicitly asks for a signed change/difference; put the reference first, changed option second, and keep the returned amount_cents sign. Unsigned premiums cannot be negative. Listed meal products require explicit meal_drink_variant='medium'; they CANNOT represent large drinks. To convert a standalone sandwich into a meal with a larger drink, select that standalone base product and meal:{drink:<returned ID>,drink_variant:<requested size>}. Never replace that request with a listed medium meal. Verify the returned line meal.drink_variant matches what was asked. Use subtotal before tax and total only when requested. A zero meal placeholder is not its full price. Comparisons never change a cart or create consent, a held quote, or an order.";

export const menuAnswerFormatGuidance =
  "For an explicitly signed X_minus_Y field, use signed_change with Y as the first/baseline option and X as the later option, then copy its signed amount_cents. Output-field order does not force comparison-option order. " +
  "Follow the user's Return template exactly, preserving its field count and order. A colon in a template field marks a LITERAL prefix: copy the text before that colon verbatim and replace only the value after it. Never strip those required prefixes. Template fields without a colon contain only the requested value, not a column heading. Return only the completed template, separated by |, with no Markdown or explanation. A list of IDs belongs in ONE field: sort alphabetically and join with commas, never with |. Numeric placeholders become bare integer cents without added field-name prefixes, currency symbols, decimals, thousands separators or units. Before answering, compare every final field against the template, including every literal prefix. Check the direction of comparisons: upgrade/premium means upgraded minus reference; savings means reference minus cheaper option. Expected answers and verifier feedback are unavailable.";

// Validation only. Never normalize, reorder, change signs, or repair a model
// answer using the oracle. The benchmark still compares the raw trimmed text.
export function validMenuAnswerFormat(answer: string) {
  return /^[A-Za-z0-9_:-]+(?:,[A-Za-z0-9_:-]+)*(?:\|[A-Za-z0-9_:-]+(?:,[A-Za-z0-9_:-]+)*)*$/.test(
    answer,
  );
}
