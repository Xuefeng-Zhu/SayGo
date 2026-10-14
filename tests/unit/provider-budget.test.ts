import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderBudget } from "../provider-budget.js";

describe("shared durable additional provider budget", () => {
  it("preserves unknown outcomes across processes and never resets approval", async () => {
    const directory = await mkdtemp(join(tmpdir(), "saygo-budget-test-"));
    try {
      const first = new ProviderBudget("test", directory);
      await first.approve(1, 0.78631971);
      await expect(first.approve(1, 0)).rejects.toThrow();
      await first.reserve(0.5, "unknown stream");
      const restarted = new ProviderBudget("test", directory);
      await expect(restarted.reserve(0.3, "too much")).rejects.toThrow(
        "cutoff",
      );
      const id = await restarted.reserve(0.2, "known call");
      await restarted.settle(id, 0.01);
      const state = await first.state();
      expect(state.observedUsd).toBe(0.01);
      expect(Object.values(state.pending)).toEqual([
        { usd: 0.5, label: "unknown stream" },
      ]);
      await expect(first.settle(id, 0.01)).rejects.toThrow("unsettled");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  it("rejects invalid IDs and unapproved budgets before any provider request", async () => {
    expect(() => new ProviderBudget("../elsewhere")).toThrow();
    const directory = await mkdtemp(join(tmpdir(), "saygo-budget-test-"));
    try {
      const budget = new ProviderBudget("test", directory);
      await expect(budget.reserve(0.01, "unapproved")).rejects.toThrow();
      await expect(budget.approve(1.01, 0)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
