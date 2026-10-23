# SayGo — integration friction log

These entries record implementation and setup issues. Impact labels describe their effect on SayGo development. Each linked receipt identifies its tested source; older results remain scoped to their recorded source. The selected October 23 take now covers ten Voice tool types and sealed spoken approval; see [current verification](verification.md).

## MCP structured validation recovery

- **Tool/version:** MCP TypeScript SDK 1.32.1, with Zod 4.6.5; observed during the October 10 contract follow-up.
- **Task and reproduction:** Advertise a tool, call it with invalid arguments and inspect the result before the application's handler runs.
- **Expected:** A strict per-tool error envelope that the model/client could inspect for corrective action.
- **Observed:** The installed high-level server validated arguments first and emitted its own text-only validation error, bypassing the application's custom recovery envelope. The application needed a different error format than the high-level API supplied.
- **Impact:** Important; inconsistent recovery shape complicated deterministic handling.
- **Workaround:** Use the SDK's official low-level `Server`, request schemas and explicit Zod input/output validation. Keep protocol failures distinct from tool errors.
- **Actionable suggestion:** Document a supported way to customize structured validation errors at the high-level server, or show the low-level recovery pattern alongside it.
- **Evidence:** [SDK friction record](../sdk-friction.md#historical-mcp-contract-02-follow-up--october-10-2026), [current contracts](../mcp-contracts.md), [HTTP ordering regressions](../../tests/integration/ordering.test.ts).

## Nova tool-schema example consistency

- **Tool/version:** Amazon Bedrock Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`), AWS SDK for JavaScript integration.
- **Task and reproduction:** Configure a streamed tool with `inputSchema.json` while comparing the input-events/getting-started documentation and other tool-configuration examples.
- **Expected:** One unambiguous serialization format for that field.
- **Observed:** Public examples showed both stringified JSON and an object on different configuration pages. SDK comments also referred to the original Sonic model. These differences required checking the actual current streaming contract.
- **Impact:** Important; source-level type checks alone could not establish runtime schema acceptance.
- **Workaround:** Use the string representation in `inputSchema.json`, then verify with an account-backed stream. The preserved October 14 synthetic stream passed 16 assertions through browser capture, authenticated WebSocket, HTTP MCP and DynamoDB Local.
- **Actionable suggestion:** Maintain one current-model end-to-end example covering schema serialization, interruption, usage and stream cleanup, with links from related reference pages.
- **Evidence:** [SDK friction record](../sdk-friction.md), [preserved live receipt](../evidence/live-voice-sonic-v4-i-20261014.json), [voice evidence](../voice.md). That historical stream does not prove general speech reliability or validate later prompt changes.

## Build and browser setup reproducibility

- **Tools:** Pinned Playwright/Chromium and Next.js; observations span the initial setup and later isolated build checks.
- **Task and reproduction:** Launch the project's Playwright release with an older cached Chromium, or run the default Next.js build inside the restricted execution environment.
- **Expected:** A runnable browser and a successful production compilation.
- **Observed:** The cached Chromium did not match the pinned Playwright release. Separately, a Turbopack CSS worker could not bind a port (`EPERM`). Installing the matching browser and changing the build mode resolved these setup constraints.
- **Impact:** Blocking for those particular launch/build attempts, with working alternatives.
- **Workaround:** Install the matching Chromium through the official Playwright downloader; use dedicated local ports/data. The documented webpack web build and runtime/worker build passed, including the fresh selected-source compilation.
- **Actionable suggestion:** Make required browser-build versions and fallback build diagnostics prominent in setup output. Preserve explicit environment failures separately from application test failures.
- **Evidence:** [Historical setup observations](../sdk-friction.md#historical-setup-observations--october-10-2026), [current setup](../local-development.md), [selected-source check scope](verification.md).

The saved Devpost answer for required future-use field **28307** is **Yes**; preserve the entrant's opinion while updating stale technical boundaries. Before using this log for optional field 28301, verify that its [public GitHub page](https://github.com/Xuefeng-Zhu/SayGo/blob/main/docs/submission/friction-log.md) is accessible. Any judging bonus is discretionary.

## Sealed spoken approval and current streaming behavior

- **Tools:** Nova 2 Sonic, MCP SDK, browser PCM capture and application consent coordinator; current October 23 take 08.
- **Task:** Read the exact quote, record fresh explicit customer approval and submit through MCP only after the recording is sealed.
- **Observed:** Provider transcript fragments, audio playback, model tool requests and stream completion have separate boundaries. Treating a single partial transcript or model submission request as consent was insufficient. This is an application integration issue, not an isolated vendor defect.
- **Workaround:** Bind capture to the quote/cart/connection, acknowledge readback playback, seal customer audio, retain pending submission and verify all fragments through natural provider completion before approval/MCP submission.
- **Result:** The selected take passed 24 assertions with one voice-approved $9.72 order, one receipt and matching kitchen. It preserves partial/repeated model replies; broader naturalness and reliability remain unverified.
- **Suggestion:** Provide a complete reference lifecycle for corrections, interrupted approval, pending tool execution and final consent diagnostics.
- **Evidence:** [Spoken approval](../voice.md#spoken-order-approval), [consent design](../voice-confirmation.md), [current take](demo.md), [portable receipt](verification-summary.json).

## Repeatable customer speech and local media assembly — October 23 review

Polly Generative Matthew produced consistent synthetic male customer and narration clips. Dedicated TTS was preferable to asking a conversational model for verbatim narration. The installed CLI streaming command required explicit flags; a JSON-only attempt failed locally before any service request. Remotion supplied motion visuals; finite PCM assembly avoided local inline-WAV/unbounded-filter failures. Failed evidence is retained, without attributing these local workflow errors to a vendor defect.

## Next.js security gate — October 23, 2026

- **Version / task:** The selected film used Next.js **16.4.0**. A later webpack publication build compiled and generated routes, then stopped with `SecurityFatalError` and an upgrade recommendation.
- **Verified advisories:** [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) and [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw). The documented patched release for the affected range is **16.4.1**.
- **Remedy:** Narrowly update the declared Next.js version and lockfile to 16.4.1, then rerun the build and browser journeys. Do not rewrite the film's original dependency fingerprints or claim the recorded take used the patch.
- **Evidence / boundary:** [Current verification](verification.md) records the original failed attempt separately from post-patch results. No provider retake or native Alexa+ behavior is involved.
