import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const ledgerSchema = z
  .object({
    approvalId: z.string(),
    maximumAdditionalUsd: z.number().positive().max(1),
    startedAt: z.string(),
    priorHistoricalEstimateUsd: z.number().nonnegative(),
    observedUsd: z.number().nonnegative(),
    pending: z.record(
      z.string(),
      z.object({ usd: z.number().positive(), label: z.string() }).strict(),
    ),
  })
  .strict();
export class ProviderBudget {
  private path: string;
  constructor(
    readonly approvalId: string,
    private directory = ".local/provider-budgets",
  ) {
    if (!/^[a-z0-9_-]{1,48}$/.test(approvalId))
      throw new Error("Invalid provider approval ID.");
    this.path = join(directory, approvalId + ".json");
  }
  async approve(
    maximumAdditionalUsd: number,
    priorHistoricalEstimateUsd: number,
  ) {
    const state = ledgerSchema.parse({
      approvalId: this.approvalId,
      maximumAdditionalUsd,
      priorHistoricalEstimateUsd,
      startedAt: new Date().toISOString(),
      observedUsd: 0,
      pending: {},
    });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // An existing approval cannot be silently reset or increased.
    await writeFile(this.path, JSON.stringify(state, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
  async state() {
    const state = ledgerSchema.parse(
      JSON.parse(await readFile(this.path, "utf8")),
    );
    if (state.approvalId !== this.approvalId)
      throw new Error("Provider approval identity mismatch.");
    return state;
  }
  private async edit<T>(fn: (state: z.infer<typeof ledgerSchema>) => T) {
    const lockPath = this.path + ".lock";
    const lock = await open(lockPath, "wx", 0o600);
    const temp = this.path + ".tmp-" + randomUUID();
    try {
      const state = await this.state();
      const result = fn(state);
      await writeFile(
        temp,
        JSON.stringify(ledgerSchema.parse(state), null, 2),
        { flag: "wx", mode: 0o600 },
      );
      await rename(temp, this.path);
      return result;
    } finally {
      await lock.close();
      await unlink(lockPath);
      await unlink(temp).catch(() => {});
    }
  }
  async reserve(usd: number, label: string) {
    if (!Number.isFinite(usd) || usd <= 0)
      throw new Error("Invalid provider reservation.");
    return this.edit((state) => {
      const outstanding = Object.values(state.pending).reduce(
        (sum, p) => sum + p.usd,
        0,
      );
      if (
        state.observedUsd + outstanding + usd >
        state.maximumAdditionalUsd * 0.75
      )
        throw new Error(
          "Shared provider budget cutoff reached before another paid call.",
        );
      const id = randomUUID();
      state.pending[id] = { usd, label };
      return id;
    });
  }
  async settle(id: string, observedUsd: number) {
    if (!Number.isFinite(observedUsd) || observedUsd < 0)
      throw new Error("Provider usage is unknown; keep reservation.");
    const exceeded = await this.edit((state) => {
      const pending = state.pending[id];
      if (!pending) throw new Error("No unsettled provider reservation.");
      state.observedUsd += observedUsd;
      delete state.pending[id];
      return observedUsd > pending.usd + 1e-9;
    });
    if (exceeded)
      throw new Error(
        "Provider usage exceeded its reserved bound; stop paid tests.",
      );
  }
}
