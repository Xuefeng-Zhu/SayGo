# MCP guide review

## Current contract and recorded evidence

The runtime advertises contract **0.5** with eleven tools, adding read-only `find_meal_savings` to the previous catalog. Version 0.4 introduced explicit listed-meal drink size and separate unsigned price gaps/signed changes; 0.5 retains those comparison schemas and the existing tools' authority boundaries. See [current contracts](mcp-contracts.md). The saved [Inspector report](evidence/mcp-inspector.json) verified the earlier ten-tool catalog with zero strict schema findings and validated `get_cart` over protocol 2025-11-25; it predates the added tool.

Current persistence uses DynamoDB. Current storage setup is documented in [DynamoDB](dynamodb.md).

Real text-model evaluations and one successful synthetic browser → Nova 2 Sonic → HTTP MCP trial have since run. The earlier [Sonic receipt](evidence/live-voice-sonic-v4-i-20261014.json) passes all 16 assertions using software TTS, muted Chromium and DynamoDB Local; it does not verify physical microphones/speakers, independent spoken-price accuracy or acoustic barge-in. The latest shared pricing-guidance changes have no new Sonic verification.

The final [original text benchmark](evidence/live-model-evaluation-reasoning-low-8192-run-identity-original-20261014.json) and [additional-question suite](evidence/live-model-evaluation-reasoning-low-8192-run-identity-generalization-20261014.json) each passed 10/10 in complete low-reasoning runs on the same [preserved October 14 implementation](evidence/model-fix-source-manifest-20261014.json), before the contract 0.5 draft improvements. The [follow-up verification](evidence/model-fix-verification-20261014.json) also records 101 unit and 49 integration passes, with the optional Inspector check skipped, plus lint/typecheck. Earlier failed and partial trials remain preserved; these fixed-menu results do not establish general model reliability. See [evaluation evidence](evaluation.md) and [voice boundaries](voice.md).

## Historical scoped review — October 10, 2026

Reviewed October 10, 2026 Pacific. **The checked local implementation passes the scoped review and regression suite; this is not a production certification or a claim of compatibility with every MCP client/version.**

The MCP-builder skill drove the schema, transport, Inspector and evaluation checks. Its three supplemental reference files were absent locally; the official protocol pages and installed SDK source supplied the missing references. The web-testing skill informed regression checks of the existing customer/staff workflows. Existing uncommitted work was preserved; at that checkpoint the repository had no remote to synchronize.

### Gaps found and corrected

1. **Malformed request handling.** Express previously converted malformed JSON into a generic 500. The MCP-specific parser now returns JSON-RPC parse errors with 400, valid-but-invalid envelopes with 400, oversized bodies with 413 and unsupported encodings with 415. Error messages do not echo the input.
2. **Legacy batching.** The installed v1 SDK accepts batches, but this endpoint's selected protocol expects one message per POST. Arrays are rejected before any domain operation, preventing one HTTP request from executing many independently rate-limited operations. See [transport rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
3. **Bearer credential parsing.** A bare signed token was previously accepted without its authorization scheme. The server now requires Bearer, accepts case-insensitive scheme spelling, rejects malformed claims as 401, checks audience and scope, and returns a local Bearer challenge. This is still custom local authentication, not OAuth discovery.
4. **Discovery and schema clarity.** Zod input schemas are emitted in input mode so optional defaults do not become required fields. Tool titles and parameter explanations now describe modifiers, whole-map replacement on update, variants, quantities, sensitive concerns and customer-only reset consent. Initialization also explains the authority boundaries. The explicit draft-07 dialect is retained and independently validated; it is a supported example in the [tools guide](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
5. **Invalid pagination cursors.** The fixed nine-tool catalog has one page. Requests containing an invented cursor now receive `-32602`, rather than silently repeating the catalog. See [pagination guidance](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination).

### Checklist and decisions

| Guide area                | Evidence / decision                                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow coverage         | Nine tools cover menu, cart, review, submission, status, help and reset proposals. Staff administration and customer approval intentionally remain outside agent authority.                                                                                |
| Names and discoverability | Stable, action-oriented names; titles and constrained field descriptions. Kept existing names to avoid an unnecessary breaking prefix rename.                                                                                                              |
| Bounded context           | Per-tool strict DTOs, compact order status, no full menu in cart results. Fixed 14-product menu and nine-tool catalog need no artificial pagination. Revisit before catalog growth.                                                                        |
| Input/output validation   | Server Zod validation, published JSON schemas, client validation and matching structured/text JSON. Runtime refinement still rejects empty changes without clarification; descriptions explain this cross-field rule.                                      |
| Errors                    | Tool/domain failures use structured recovery with `isError`; malformed envelopes and unknown methods/tools use protocol errors. Lost writes require reconciliation.                                                                                        |
| Annotations               | All four hints are set. Read tools are marked read-only; writes are conservatively marked destructive; retry-safe operations are marked idempotent. These hints never grant permission.                                                                    |
| Transport/lifecycle       | Stateless JSON Streamable HTTP, real initialization and 202 acknowledgement of notifications. GET/DELETE return 405 with `Allow: POST`; no unsupported streaming capability is claimed. Version/header negative paths are tested.                          |
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

The [Inspector harness](../tests/inspector-check.ts) uses a pinned package, a temporary owner-only config and a memory-only secret store. Tokens are not placed on the command line or printed. It uses only the isolated test server, makes no mutating tool calls, never starts an OAuth flow, and removes its temporary credential file/directory. The package download remains in pnpm's cache. See the official [Inspector smoke-testing guide](https://github.com/modelcontextprotocol/inspector/blob/main/docs/cli-smoke-testing.md).

The evaluation fixture is reset only in `saygo_test`. Questions are stable for Harbor Burger v1, not arbitrary future menu edits. Answer verification proves the reference data and calculations, **not** model tool-selection accuracy or live voice reliability.

### Limitations recorded at this checkpoint

- **Authorization interoperability:** no OAuth 2.1 authorization server, protected-resource metadata, discovery or third-party-client onboarding. HTTP authorization integrations should follow the [authorization guide](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization); this local simulator is a documented exception, not a completed OAuth implementation.
- **Protocol generation:** this review targeted the 2025-11-25 contract and pinned SDK 1.32.1. The October 10 review recorded an upstream v2 line for the 2026-07-28 protocol. The [SDK migration guidance](https://github.com/modelcontextprotocol/typescript-sdk) was consulted then; no SDK major-version migration was included in this hardening pass.
- **Deployment and adversarial testing:** at this checkpoint there was no public hosting, distributed rate limiter, penetration test, load/crash soak, commercial POS, native Alexa or live Bedrock trial. Later live-provider evidence is summarized above; see [security and privacy](security-privacy.md) and [evaluation](evaluation.md) for the remaining boundaries.

At the October 10 review checkpoint, no changes had been committed, pushed, deployed or submitted. This is a historical publication status, not a statement about the current checkout.
