export type AnswerTemplateField = {
  placeholder: string;
  valuePlaceholder: string;
  literalPrefix?: string;
};

export type AnswerTemplate = {
  template: string;
  fields: AnswerTemplateField[];
};

const identifier = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Parse only an explicit pipe-separated Return template; never infer values. */
export function extractAnswerTemplate(question: string): AnswerTemplate | null {
  if (question.length > 16000) return null;
  const returns = [...question.matchAll(/\breturn\b/gi)];
  if (returns.length !== 1) return null;
  const start = returns[0].index! + returns[0][0].length;
  const sentence = question.slice(start).split(/[.!?]/, 1)[0];
  if (/[\r\n]/.test(sentence)) return null;
  const clause = sentence.trim();
  // A prose introduction may precede the template, separated by a colon and
  // whitespace. Literal field prefixes instead use an adjacent colon/value.
  const introducer = /:\s+/g;
  const separators = [...clause.matchAll(introducer)];
  const last = separators.at(-1);
  const prefix = last ? clause.slice(0, last.index) : "";
  if (prefix.includes("|") || prefix.includes("`")) return null;
  let template = last ? clause.slice(last.index! + last[0].length) : clause;
  if (template.startsWith("`") && template.endsWith("`"))
    template = template.slice(1, -1);
  const placeholders = template.split("|");
  if (placeholders.length < 2 || placeholders.length > 32) return null;
  const fields: AnswerTemplateField[] = [];
  for (const placeholder of placeholders) {
    const parts = placeholder.split(":");
    if (parts.length > 2) return null;
    const valuePlaceholder = parts.at(-1)!;
    if (!valuePlaceholder.split(",").every((value) => identifier.test(value)))
      return null;
    if (parts.length === 2 && !identifier.test(parts[0])) return null;
    fields.push({
      placeholder,
      valuePlaceholder,
      ...(parts.length === 2 ? { literalPrefix: parts[0] + ":" } : {}),
    });
  }
  return { template, fields };
}

/** Reusable formatting guidance derived exclusively from the user's template. */
export function answerTemplateGuidance(question: string): string {
  const parsed = extractAnswerTemplate(question);
  if (!parsed) return "";
  const instructions = parsed.fields.map((field, index) => {
    const format = field.literalPrefix
      ? `Start with the exact literal prefix "${field.literalPrefix}", then the requested value for "${field.valuePlaceholder}".`
      : `Output only the requested value for "${field.valuePlaceholder}". Do not print "${field.valuePlaceholder}", "${field.valuePlaceholder}:", or any other field-name prefix.`;
    const list = field.valuePlaceholder.includes(",")
      ? " Keep the requested list in this single field, using commas between values."
      : "";
    return `Field ${index + 1}: ${format}${list}`;
  });
  return [
    `Response format: exactly ${parsed.fields.length} fields on ONE line, separated by |, in the order below. Emit the completed values only: no header row, template row, Markdown, code fences, or explanation. Field names identify what to answer; only explicitly required literal prefixes appear in the response.`,
    ...instructions,
  ].join("\n");
}
