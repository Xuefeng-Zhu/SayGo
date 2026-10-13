# MCP guide review

Current follow-up, October 13: contract 0.3 adds read-only `compare_menu_prices` to make the catalog ten tools; [current contracts](mcp-contracts.md) describe its strict schemas and authority boundaries. The refreshed [Inspector report](evidence/mcp-inspector.json) discovers ten tools with zero strict schema findings. The observations below are the historical October 10 review; current DynamoDB, publication and live-model results are in [evaluation evidence](evaluation.md).

Reviewed October 10, 2026 Pacific. **The checked local implementation passes the scoped review and regression suite; this is not a production certification or a claim of compatibility with every MCP client/version.**

The MCP-builder skill drove the schema, transport, Inspector and evaluation checks. Its three supplemental reference files were absent locally; the official protocol pages and installed SDK source supplied the missing references. The web-testing skill informed regression checks of the existing customer/staff workflows. Existing uncommitted work was preserved; this repository has no remote to synchronize.

## Gaps found and corrected

1. **Malformed request handling.** Express previously converted malformed JSON into a generic 500. The MCP-specific parser now returns JSON-RPC parse errors with 400, valid-but-invalid envelopes with 400, oversized bodies with 413 and unsupported encodings with 415. Error messages do not echo the input.
2. **Legacy batching.** The installed v1 SDK accepts batches, but this endpoint's selected protocol expects one message per POST. Arrays are rejected before any domain operation, preventing one HTTP request from executing many independently rate-limited operations. See [transport rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
3. **Bearer credential parsing.** A bare signed token was previously accepted without its authorization scheme. The server now requires Bearer, accepts case-insensitive scheme spelling, rejects malformed claims as 401, checks audience and scope, and returns a local Bearer challenge. This is still custom local authentication, not OAuth discovery.
4. **Discovery and schema clarity.** Zod input schemas are emitted in input mode so optional defaults do not become required fields. Tool titles and parameter explanations now describe modifiers, whole-map replacement on update, variants, quantities, sensitive concerns and customer-only reset consent. Initialization also explains the authority boundaries. The explicit draft-07 dialect is retained and independently validated; it is a supported example in the [tools guide](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
5. **Invalid pagination cursors.** The fixed nine-tool catalog has one page. Requests containing an invented cursor now receive `-32602`, rather than silently repeating the catalog. See [pagination guidance](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination).

## Checklist and decisions

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
| Limits and recovery       | 64 KiB bodies, request/login rate limits, SDK's finite 60-second request timeout, 5-second DB connect and 10-second statement timeout. No automatic client write retries. Cancellation/disconnection is not assumed to roll back a committed write.        |
| Optional features         | Only `tools` is advertised; list-change notifications, resources, prompts, tasks and server-initiated sampling are not offered. Unsupported methods are tested. See [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle). |
| Inspector                 | Official Inspector 2.10.1 passed initialize, strict discovery and `get_cart`: nine tools, **zero strict schema findings**. [Sanitized report](evidence/mcp-inspector.json).                                                                                |
| Evaluation                | Ten independent, read-only fixture questions have exact answers verified through menu/detail calls. [XML](../tests/mcp-evaluation.xml), [verification logic](../tests/mcp-evaluations.ts). No evaluated model was invoked.                                 |

## Repeatable verification

```sh
pnpm lint
pnpm typecheck
pnpm test
SAYGO_INSPECTOR_TEST=1 pnpm test:integration
pnpm build
pnpm test:e2e
```

Result: **70 passed** — 23 unit, 44 integration (including ten evaluation verifications and one Inspector test), three Chromium browser tests — plus lint, typecheck and production build. Without `SAYGO_INSPECTOR_TEST=1`, the network-dependent Inspector check is intentionally skipped: 43 integration tests run.

The [Inspector harness](../tests/inspector-check.ts) uses a pinned package, a temporary owner-only config and a memory-only secret store. Tokens are not placed on the command line or printed. It uses only the isolated test server, makes no mutating tool calls, never starts an OAuth flow, and removes its temporary credential file/directory. The package download remains in pnpm's cache. See the official [Inspector smoke-testing guide](https://github.com/modelcontextprotocol/inspector/blob/main/docs/cli-smoke-testing.md).

The evaluation fixture is reset only in `saygo_test`. Questions are stable for Harbor Burger v1, not arbitrary future menu edits. Answer verification proves the reference data and calculations, **not** model tool-selection accuracy or live voice reliability.

## Explicit limitations before broader use

- **Authorization interoperability:** no OAuth 2.1 authorization server, protected-resource metadata, discovery or third-party-client onboarding. HTTP authorization integrations should follow the [authorization guide](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization); this local simulator is a documented exception, not a completed OAuth implementation.
- **Protocol generation:** this review targets the existing 2025-11-25 contract and pinned SDK 1.32.1. Upstream now has a v2 line for the 2026-07-28 protocol. The [SDK's migration guidance](https://github.com/modelcontextprotocol/typescript-sdk) treats that as a separate migration; it was not silently bundled into this hardening pass.
- **Deployment and adversarial testing:** no public hosting, distributed rate limiter, penetration test, load/crash soak, commercial POS, native Alexa or live Bedrock trial. See [security and privacy](security-privacy.md) and [evaluation](evaluation.md).

No changes were committed, pushed, deployed or submitted.
