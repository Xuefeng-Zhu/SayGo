import { describe, expect, it } from "vitest";
import { mcpEvaluations, evaluationXml } from "../mcp-evaluations.js";
import { menuGeneralizationEvaluations } from "../menu-generalization-evaluations.js";
import { seedProducts } from "../../packages/db/src/menu.js";
import { readFileSync } from "node:fs";

describe("independent fixed-menu evaluation oracles", () => {
  it.each(menuGeneralizationEvaluations)(
    "verifies fresh question $id independently of model answers",
    (question) => {
      const products = Object.fromEntries(
        seedProducts
          .filter((p) => question.products.includes(p.id))
          .map((p) => [p.id, p]),
      );
      expect(question.solve(products)).toBe(question.answer);
    },
  );
  it("preserves all original questions and expected answers byte-for-byte", () => {
    expect(readFileSync("tests/mcp-evaluation.xml", "utf8")).toBe(
      evaluationXml(),
    );
    expect(
      new Set(
        [...mcpEvaluations, ...menuGeneralizationEvaluations].map((q) => q.id),
      ).size,
    ).toBe(20);
  });
});
