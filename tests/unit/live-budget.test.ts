import { describe, it, expect } from "vitest";
import {
  EvaluationBudget,
  requireReadOnly,
  remainingBudget,
  isLiveEvaluationReportName,
} from "../live-budget.js";
describe("live evaluation spending and capability limits", () => {
  it("includes every supported reasoning configuration in the cumulative ledger", () => {
    for (const name of [
      "live-model-evaluation.json",
      "live-model-evaluation-reasoning-low.json",
      "live-model-evaluation-reasoning-low-8192-run-original.json",
      "live-model-evaluation-reasoning-medium-8192-run-fresh.json",
    ])
      expect(isLiveEvaluationReportName(name)).toBe(true);
    for (const name of [
      "other.json",
      "live-model-evaluation-reasoning-high.json",
      "live-model-evaluation.json.bak",
    ])
      expect(isLiveEvaluationReportName(name)).toBe(false);
  });
  it("refuses absent, unbounded or larger-than-approved budgets", () => {
    for (const value of [NaN, 0, -1, 1.01, Infinity])
      expect(() => new EvaluationBudget(value)).toThrow();
  });
  it("retains reservations after an uncertain request and stops before the limit", () => {
    const budget = new EvaluationBudget(0.02);
    budget.reserve({ prompt: "small" });
    expect(() => budget.reserve({ prompt: "small" })).toThrow("cutoff");
    expect(budget.reportedUsd).toBe(0);
    expect(budget.reservedUsd).toBeGreaterThan(0);
  });
  it("fails closed for missing usage or oversized contexts", () => {
    const budget = new EvaluationBudget(1);
    expect(() => budget.reserve({ prompt: "x".repeat(50000) })).toThrow(
      "input size",
    );
    expect(() => budget.record(NaN, 1, 100)).toThrow("usage");
    expect(() => budget.record(101, 1, 100)).toThrow("bound");
  });
  it("settles only verified usage while retaining unknown-call reservations", () => {
    const budget = new EvaluationBudget(0.04, 8192);
    const unknown = budget.reserve({ prompt: "unknown" });
    expect(() => budget.reserve({ prompt: "another" })).toThrow("cutoff");
    budget.record(100, 100, unknown.inputBound);
    expect(budget.reservedUsd).toBeCloseTo(budget.reportedUsd);
    const pending = budget.reserve({ prompt: "new" });
    expect(budget.reservedUsd).toBeCloseTo(budget.reportedUsd + pending.usd);
    expect(() => budget.record(1, 1, 999)).toThrow("unsettled reservation");
    expect(budget.reservedUsd).toBeGreaterThan(budget.reportedUsd);
  });
  it("prevents mutation tools regardless of server annotations", () => {
    requireReadOnly("get_menu");
    requireReadOnly("get_item_details");
    requireReadOnly("compare_menu_prices");
    for (const name of [
      "submit_order",
      "prepare_order_review",
      "apply_cart_changes",
      "request_staff_help",
      "unknown",
    ])
      expect(() => requireReadOnly(name)).toThrow("allowlist");
  });
  it("enforces the original approval across multiple separately recorded runs", () => {
    expect(remainingBudget(1, 0.076, 8192).maximumUsd).toBeCloseTo(0.924);
    expect(() => remainingBudget(1.05, 0.1)).toThrow();
    expect(() => remainingBudget(1, -0.1)).toThrow();
    expect(() => remainingBudget(1, 1)).toThrow();
    expect(() => new EvaluationBudget(1, 8193)).toThrow();
    const small = new EvaluationBudget(1, 2048).reserve({ prompt: "same" }).usd;
    const large = new EvaluationBudget(1, 8192).reserve({ prompt: "same" }).usd;
    expect(large).toBeGreaterThan(small);
  });
});
