import { it, expect } from "vitest";
import { changesSchema } from "@saygo/contracts";
import { inputRecovery } from "../../apps/runtime/src/mcp-results.js";
it("explains an invalid generated UUID without reflecting the supplied value", () => {
  const bad = "00000000-0000-0000-0000-000000000001";
  const result = changesSchema.safeParse({
    request_id: bad,
    expected_version: 0,
    commands: [{ type: "add", product_id: "classic" }],
  });
  if (result.success) throw new Error("Invalid sequential UUID accepted");
  const recovery = inputRecovery(result.error);
  expect(recovery).toMatchObject({
    code: "INVALID_ARGUMENTS",
    next_action: "correct_arguments",
  });
  expect(recovery.message).toContain("UUID v4");
  expect(recovery.message).not.toContain(bad);
});
