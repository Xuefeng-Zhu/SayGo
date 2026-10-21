# SayGo — integration friction log

These entries summarize observed implementation/setup issues. They distinguish SDK behavior from application mistakes and local-environment limits. Impact labels describe this prototype's development; they are not vendor severity ratings. The older receipts below identify their own source checkpoint and do not verify the later concise-prompt change.

## MCP structured validation recovery

- **Tool/version:** MCP TypeScript SDK 1.32.1, with Zod 4.6.5; observed during the October 10 contract follow-up.
- **Task and reproduction:** Advertise a tool, call it with invalid arguments and inspect the result before the application's handler runs.
- **Expected by the application:** A strict per-tool error envelope that the model/client could inspect for corrective action.
- **Observed:** The installed high-level server validated arguments first and emitted its own text-only validation error, bypassing the application's custom recovery envelope. This is an abstraction mismatch, not a claim that the SDK violated its contract.
- **Impact:** Important; inconsistent recovery shape complicated deterministic handling.
- **Workaround:** Use the SDK's official low-level `Server`, request schemas and explicit Zod input/output validation. Keep protocol failures distinct from tool errors.
- **Actionable suggestion:** Document a supported way to customize structured validation errors at the high-level server, or show the low-level recovery pattern alongside it.
- **Evidence:** [SDK friction record](../sdk-friction.md#historical-mcp-contract-02-follow-up--october-10-2026), [current contracts](../mcp-contracts.md), [HTTP ordering regressions](../../tests/integration/ordering.test.ts).

## Nova tool-schema example consistency

- **Tool/version:** Amazon Bedrock Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`), AWS SDK for JavaScript integration.
- **Task and reproduction:** Configure a streamed tool with `inputSchema.json` while comparing the input-events/getting-started documentation and other tool-configuration examples.
- **Expected by the application:** One unambiguous serialization format for that field.
- **Observed:** Public examples showed both stringified JSON and an object on different configuration pages. SDK comments also referred to the original Sonic model. These differences required checking the actual current streaming contract.
- **Impact:** Important; source-level type checks alone could not establish runtime schema acceptance.
- **Workaround:** Use the string representation in `inputSchema.json`, then verify with an account-backed stream. The preserved October 14 synthetic stream passed 16 assertions through browser capture, authenticated WebSocket, HTTP MCP and DynamoDB Local.
- **Actionable suggestion:** Maintain one current-model end-to-end example covering schema serialization, interruption, usage and stream cleanup, with links from related reference pages.
- **Evidence:** [SDK friction record](../sdk-friction.md), [preserved live receipt](../evidence/live-voice-sonic-v4-i-20261014.json), [voice evidence](../voice.md). That historical stream does not prove general speech reliability or validate later prompt changes.

## Build and browser setup reproducibility

- **Tools:** Pinned Playwright/Chromium and Next.js; observations span the initial setup and later isolated build checks.
- **Task and reproduction:** Launch the project's Playwright release with an older cached Chromium, or run the default Next.js build inside the restricted execution environment.
- **Expected by the application:** A runnable browser and a successful production compilation.
- **Observed:** The cached Chromium did not match the pinned Playwright release. Separately, a Turbopack CSS worker could not bind a port (`EPERM`). These were browser-installation/environment constraints; no vendor product defect is established.
- **Impact:** Blocking for those particular launch/build attempts, with working alternatives.
- **Workaround:** Install the matching Chromium through the official Playwright downloader; use dedicated local ports/data. The documented webpack web build and runtime/worker build passed, including the fresh selected-source compilation.
- **Actionable suggestion:** Make required browser-build versions and fallback build diagnostics prominent in setup output. Preserve explicit environment failures separately from application test failures.
- **Evidence:** [Historical setup observations](../sdk-friction.md#historical-setup-observations--october-10-2026), [current setup](../local-development.md), [selected-source check scope](verification.md).

No tool preference or future-use opinion is supplied by this log. The entrant still needs to answer required feedback field **28307** personally. Verify this file's public GitHub URL after pushing before using it for optional form field 28301; no judging bonus is guaranteed.
