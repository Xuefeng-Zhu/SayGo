// Shared between the customer voice agent and text evaluation; no fixture prices,
// question IDs, expected answers, or verifier feedback belong in this guidance.
export const menuPriceGuidance =
  "Use compare_menu_prices for hypothetical menu totals, modifier costs, upgrades, and savings. Read menu IDs and required choices first, then submit complete hypothetical selections. Put the reference option FIRST and the changed option after it. subtotal_delta_cents is changed minus reference: positive costs more, negative saves. For a premium, upgrade cost, or savings magnitude, use absolute_subtotal_difference_cents and more_expensive_label to identify the costlier option; do not copy a negative signed delta as an unsigned premium. Keep the sign when a question explicitly requests a signed delta. Use subtotal for before-tax questions and total only when tax is requested. A listed meal includes components and a discount; its zero placeholder variant is not the full price. Comparisons do not change a cart or create a held quote, approval, or order.";

export const menuAnswerFormatGuidance =
  "Return only the requested field VALUES, separated by |, with no Markdown or explanation. A list of IDs belongs in ONE field: sort alphabetically and join with commas, never with |. Numeric fields must be bare integer cents without field-name prefixes, currency symbols, decimals, thousands separators or units. Include a literal label such as name:yes only when the requested format explicitly requires it; never prefix a cents value with its column name. Check field count and the direction of comparisons before answering. Upgrade/premium means upgraded minus reference; savings means reference minus cheaper option. Expected answers and verifier feedback are unavailable.";

// Validation only. Never normalize, reorder, change signs, or repair a model
// answer using the oracle. The benchmark still compares the raw trimmed text.
export function validMenuAnswerFormat(answer: string) {
  return /^[A-Za-z0-9_:-]+(?:,[A-Za-z0-9_:-]+)*(?:\|[A-Za-z0-9_:-]+(?:,[A-Za-z0-9_:-]+)*)*$/.test(
    answer,
  );
}
