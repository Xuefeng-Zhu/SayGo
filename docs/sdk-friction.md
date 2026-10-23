# SDK and setup notes

## Related results

SayGo uses DynamoDB and MCP contract **0.5**, with eleven tools. See [storage setup](dynamodb.md) and [MCP contracts](mcp-contracts.md).

- The saved [Inspector receipt](evidence/mcp-inspector.json) checked the earlier ten-tool catalog with zero strict schema findings. It predates `find_meal_savings`.
- The [October 14 synthetic Sonic trial](evidence/live-voice-sonic-v4-i-20261014.json) passed 16 checks using software TTS and muted Chromium. It recovered from invalid UUID and missing meal-size errors. Physical audio, acoustic barge-in and later pricing guidance were outside that run. See [voice results](voice.md) and the [source manifest](evidence/live-voice-i-source-manifest.json).
- The [original text benchmark](evidence/live-model-evaluation-reasoning-low-8192-run-identity-original-20261014.json) and [additional-question suite](evidence/live-model-evaluation-reasoning-low-8192-run-identity-generalization-20261014.json) each passed 10/10 on the same [October 14 source](evidence/model-fix-source-manifest-20261014.json). The [local verification receipt](evidence/model-fix-verification-20261014.json) records 101 unit and 49 integration passes, lint and typecheck, with Inspector skipped. Earlier failures and exact scoring remain in [evaluation](evaluation.md).
- Production compilation passed with webpack plus runtime/worker compilation. Default Turbopack failed when its CSS worker could not bind a port (`EPERM`), including on an escalated retry. Build and browser checks were not rerun for the text-model follow-up.

## Historical setup observations — October 10, 2026

These observations describe the initial setup, before the provider and storage results above.

| Observed issue                                                                                                     | Resolution / boundary                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The MCP-builder skill's referenced local `reference/` files were missing.                                          | Read the installed official SDK's stateless server example/types and public SDK documentation instead.                                                                               |
| Current MCP TypeScript upstream has v2 split packages; v1 supports the requested 2025-11-25 protocol.              | Pin 1.32.1 and assert protocol negotiation over actual HTTP.                                                                                                                         |
| Generic tool unions and `structuredContent` needed explicit TypeScript boundaries.                                 | Contract 0.2 validates strict per-tool success/error schemas on both server and client; generated JSON schemas pass the SDK's `ToolSchema` parser.                                   |
| AWS generated SDK request comments still mention the original Sonic model while current Nova docs describe Nova 2. | Use the official model card and configurable model ID. Model availability still required a live request at this checkpoint.                                                          |
| Public AWS examples show both a stringified JSON schema and an object in different tool-configuration pages.       | Use the input-events/getting-started string representation in `inputSchema.json`. Its acceptance required an account-backed stream at this checkpoint.                               |
| pnpm 11 blocked native build scripts and inserted a placeholder `allowBuilds` entry.                               | Explicitly allow only esbuild/sharp; corrected the duplicate generated YAML entry and installed successfully.                                                                        |
| Docker client was installed but its daemon was stopped.                                                            | Started installed OrbStack and created only the dedicated SayGo Compose project/database.                                                                                            |
| The Playwright release required a newer Chromium build than the cached browsers.                                   | Installed the pinned release's Chromium using the official Playwright downloader, then reran tests. Initial launch failures are not counted as application failures or passing runs. |
| Next dev generated an AGENTS.md pointing to version-specific bundled docs.                                         | Read relevant routing/config guides and preserve the generated guidance file.                                                                                                        |

## Historical MCP contract 0.2 follow-up — October 10, 2026

The later [guide review](mcp-best-practices-review.md) found that the installed v1 SDK still accepts JSON-RPC batches. The local 2025-11-25 endpoint now rejects these before domain work. Zod input-mode schema generation also corrected optional default fields in discovery. A raw Node HTTP request was required for the wrong-Host regression because fetch replaced the supplied Host header. Inspector 2.10.1 passed using its legacy protocol mode with SDK v1.

The installed high-level MCP server validates tool arguments before the custom handler and returns its own text-only validation error. To provide uniform structured recovery for invalid arguments, the server now uses the official SDK's low-level `Server` with `ListToolsRequestSchema` and `CallToolRequestSchema`, explicit Zod input validation, and per-tool output validation. Both result variants sit inside a root object so each advertised output schema remains object-shaped. Real HTTP SDK tests cover discovery and all nine tools; protocol failures remain protocol errors.

Turbopack could not resolve a `.js` re-export for the new source-only TypeScript contract file. The development route returned 500, causing Playwright's server-readiness check to try starting another server and fail. Changing that re-export to the repository's bundler-compatible extensionless path fixed the production build; the subsequent browser run passed all three tests against the existing development processes.
