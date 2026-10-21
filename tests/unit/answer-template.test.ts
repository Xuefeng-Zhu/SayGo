import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  answerTemplateGuidance,
  extractAnswerTemplate,
} from "../../packages/integrations/src/answer-template.js";

describe("user-provided answer templates", () => {
  it("distinguishes literal prefixes from bare fields without supplying answers", () => {
    const question =
      "Inspect the items. Return cedar:yes_or_no|maple:yes_or_no|fee_cents.";
    expect(extractAnswerTemplate(question)).toEqual({
      template: "cedar:yes_or_no|maple:yes_or_no|fee_cents",
      fields: [
        {
          placeholder: "cedar:yes_or_no",
          valuePlaceholder: "yes_or_no",
          literalPrefix: "cedar:",
        },
        {
          placeholder: "maple:yes_or_no",
          valuePlaceholder: "yes_or_no",
          literalPrefix: "maple:",
        },
        { placeholder: "fee_cents", valuePlaceholder: "fee_cents" },
      ],
    });
    const guidance = answerTemplateGuidance(question);
    expect(guidance).toContain(
      'Field 1: Start with the exact literal prefix "cedar:"',
    );
    expect(guidance).toContain(
      'Field 2: Start with the exact literal prefix "maple:"',
    );
    expect(guidance).toContain(
      'Field 3: Output only the requested value for "fee_cents"',
    );
    expect(guidance).toContain('Do not print "fee_cents", "fee_cents:"');
    expect(guidance).toContain("exactly 3 fields on ONE line");
    expect(guidance).toContain("no header row, template row");
    expect(guidance).not.toContain("cedar:yes");
    expect(guidance).not.toContain("maple:no");
  });

  it("finds a template after prose and keeps a comma list in one field", () => {
    const question =
      "Compare the options. Return the selected object, its group, permitted IDs and cost: object|group|choice1,choice2|cents. Ignore other information.";
    const parsed = extractAnswerTemplate(question);
    expect(parsed?.template).toBe("object|group|choice1,choice2|cents");
    expect(parsed?.fields).toHaveLength(4);
    expect(answerTemplateGuidance(question)).toContain(
      "Keep the requested list in this single field, using commas between values.",
    );
  });

  it("accepts a single backtick-wrapped template and preserves signed field names", () => {
    const question = "RETURN `west_cents|east_cents|west_minus_east_cents`.";
    expect(extractAnswerTemplate(question)?.template).toBe(
      "west_cents|east_cents|west_minus_east_cents",
    );
    expect(answerTemplateGuidance(question)).toContain(
      'Field 3: Output only the requested value for "west_minus_east_cents"',
    );
  });

  it.each([
    "What is the price?",
    "Return one_value.",
    "Return a||b.",
    "Return a|b|.",
    "Return a:b:c|value.",
    "Return a|[optional].",
    "Return a|b or c|d.",
    "Return a|b. Return c|d instead.",
    "Return a|b: c|d.",
    "Return a|b\n|c.",
    'Return {"a": 1, "b": 2}.',
    "Return `a|b.",
    `Return ${Array.from({ length: 33 }, (_, i) => `field${i}`).join("|")}.`,
    `Return a|b. ${"x".repeat(16000)}`,
  ])("leaves unsupported or ambiguous syntax untouched: %s", (question) => {
    expect(extractAnswerTemplate(question)).toBeNull();
    expect(answerTemplateGuidance(question)).toBe("");
  });

  it("parses every current benchmark question without using expected answers", () => {
    const xml = readFileSync("tests/mcp-evaluation.xml", "utf8");
    const original = [...xml.matchAll(/<question>([^<]+)<\/question>/g)].map(
      ([, question]) => question,
    );
    const source = ts.createSourceFile(
      "questions.ts",
      readFileSync("tests/menu-generalization-evaluations.ts", "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const additional: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "question" &&
        ts.isStringLiteral(node.initializer)
      )
        additional.push(node.initializer.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(original).toHaveLength(10);
    expect(additional).toHaveLength(10);
    for (const question of [...original, ...additional]) {
      expect(extractAnswerTemplate(question), question).not.toBeNull();
      expect(answerTemplateGuidance(question), question).not.toBe("");
    }
  });
});
