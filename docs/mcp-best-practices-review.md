# MCP guide review

## Contract and evidence

The runtime advertises contract **0.5** with eleven tools. It adds read-only `find_meal_savings` and retains 0.4's explicit listed-meal drink size and separate unsigned price gaps/signed changes. See [MCP contracts](mcp-contracts.md).

The saved [Inspector report](evidence/mcp-inspector.json) covers the earlier ten-tool catalog and `get_cart` over protocol 2025-11-25, with zero strict schema findings. It predates the savings tool. Later text-model and synthetic Sonic results are recorded in [evaluation](evaluation.md) and [voice](voice.md); they apply to their preserved source snapshots.

Storage setup is documented in [DynamoDB](dynamodb.md).

## Historical scoped review — October 10, 2026

The October 10, 2026 Pacific review passed its local regression checks. It covered the pinned protocol and client versions.

The review checked schemas, transport, Inspector discovery and customer/staff workflows. Three supplemental MCP-builder reference files were absent, so it used the official protocol pages and installed SDK source.

### Gaps found and corrected

1. **Malformed request handling.** Express previously converted malformed JSON into a generic 500. The MCP-specific parser now returns JSON-RPC parse errors with 400, valid-but-invalid envelopes with 400, oversized bodies with 413 and unsupported encodings with 415. Error messages do not echo the input.
2. **Legacy batching.** The installed v1 SDK accepts batches, but this endpoint accepts one message per POST. Arrays are rejected before any domain operation, preventing one HTTP request from executing many independently rate-limited operations. See [transport rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
3. **Bearer credential parsing.** A bare signed token was previously accepted without its authorization scheme. The server now requires Bearer, accepts case-insensitive scheme spelling, rejects malformed claims as 401, checks audience and scope, and returns a local Bearer challenge. This is still custom local authentication, not OAuth discovery.
4. **Discovery and schema clarity.** Zod input schemas are emitted in input mode so optional defaults do not become required fields. Tool titles and parameter explanations now describe modifiers, whole-map replacement on update, variants, quantities, sensitive concerns and customer-only reset consent. Initialization describes which actions require customer or staff authority. The explicit draft-07 dialect is retained and independently validated; it is a supported example in the [tools guide](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
5. **Invalid pagination cursors.** The fixed nine-tool catalog has one page. Requests containing an invented cursor now receive `-32602`, rather than silently repeating the catalog. See [pagination guidance](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination).

### Checklist and decisions

| Guide area                | Evidence / decision                                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow coverage         | Nine tools cover menu, cart, review, submission, status, help and reset proposals. Staff administration and customer approval require separate authenticated actions.                                                                                      |
| Names and discoverability | Stable, action-oriented names; titles and constrained field descriptions. Kept existing names to avoid an unnecessary breaking prefix rename.                                                                                                              |
| Bounded context           | Per-tool strict DTOs, compact order status, no full menu in cart results. The fixed 14-product menu and nine-tool catalog fit on one page. Revisit before catalog growth.                                                                                  |
| Input/output validation   | Server Zod validation, published JSON schemas, client validation and matching structured/text JSON. Runtime refinement still rejects empty changes without clarification; descriptions explain this cross-field rule.                                      |
| Errors                    | Tool/domain failures use structured recovery with `isError`; malformed envelopes and unknown methods/tools use protocol errors. Lost writes require reconciliation.                                                                                        |
| Annotations               | All four hints are set. Read tools are marked read-only; writes are conservatively marked destructive; retry-safe operations are marked idempotent. These hints never grant permission.                                                                    |
| Transport/lifecycle       | Stateless JSON Streamable HTTP, real initialization and 202 acknowledgement of notifications. GET/DELETE return 405 with `Allow: POST`; server-to-client streaming is unavailable. Version/header negative paths are tested.                               |
| Access controls           | Loopback binding, Origin/Host checks, short-lived scoped credentials, lane epoch and staff ownership fence, customer-only approval. Wrong-host test uses raw HTTP because fetch can replace Host.                                                          |
| Limits and recovery       | 64 KiB bodies, request/login rate limits and SDK's finite 60-second request timeout. No automatic client write retries. Cancellation/disconnection is not assumed to roll back a committed write.                                                          |
| Optional features         | Only `tools` is advertised; list-change notifications, resources, prompts, tasks and server-initiated sampling are not offered. Unsupported methods are tested. See [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle). |
| Inspector                 | Official Inspector 2.10.1 passed initialize, strict discovery and `get_cart`: nine tools, **zero strict schema findings** at this checkpoint. The [saved report](evidence/mcp-inspector.json) now reflects the later ten-tool run.                         |
| Evaluation                | Ten independent, read-only fixture questions have exact answers verified through menu/detail calls. [XML](../tests/mcp-evaluation.xml), [verification logic](../tests/mcp-evaluations.ts). No evaluated model was invoked.                                 |

### Verification commands at this checkpoint

```sh
pnpm lint
pnpm typecheck
pnpm test
SAYGO_INSPECTOR_TEST=1 pnpm test:integration
pnpm build
pnpm test:e2e
```

Historical result: **70 passed** — 23 unit, 44 integration (including ten evaluation verifications and one Inspector test), three Chromium browser tests — plus lint, typecheck and production build. Without `SAYGO_INSPECTOR_TEST=1`, the network-dependent Inspector check was intentionally skipped: 43 integration tests ran. Current recorded test counts and the later default-Turbopack build limitation are in [evaluation evidence](evaluation.md).

The [Inspector harness](../tests/inspector-check.ts) uses a pinned package, a temporary owner-only config and an in-memory secret store. It keeps tokens off the command line and out of output, calls only read tools on the isolated test server, and removes temporary credentials afterward. The package remains in pnpm's cache. See the official [Inspector smoke-testing guide](https://github.com/modelcontextprotocol/inspector/blob/main/docs/cli-smoke-testing.md).

The evaluation fixture is reset only in `saygo_test`. Questions are stable for Harbor Burger v1, not arbitrary future menu edits. These tests verify reference data and calculations. They do not invoke a model.

### Limitations recorded at this checkpoint

- **Authorization interoperability:** no OAuth 2.1 authorization server, protected-resource metadata, discovery or third-party-client onboarding. HTTP authorization integrations should follow the [authorization guide](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization); the local simulator uses its own scoped bearer tokens.
- **Protocol generation:** this review targeted the 2025-11-25 contract and pinned SDK 1.32.1. The October 10 review recorded an upstream v2 line for the 2026-07-28 protocol. The [SDK migration guidance](https://github.com/modelcontextprotocol/typescript-sdk) was consulted then; the review retained SDK v1.
- **Deployment and adversarial testing:** at this checkpoint there was no public hosting, distributed rate limiter, penetration test, load/crash soak, commercial POS, native Alexa or live Bedrock trial. Later live-provider evidence is summarized above; see [security and privacy](security-privacy.md) and [evaluation](evaluation.md) for the remaining boundaries.

At the October 10 checkpoint, the changes were uncommitted, unpushed, undeployed and unsubmitted.
