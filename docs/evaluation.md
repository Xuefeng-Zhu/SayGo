# Evaluation and evidence

Verified locally on October 10, 2026 (Pacific; October 11 UTC). The working, tested path is the **independent web simulator → real HTTP MCP → PostgreSQL → persistent POS sandbox → kitchen**. The finite no-key utterances are not a language model or speech recognizer. Live Nova speech and native Alexa+ remain unverified.

Updated after the [MCP guide review](mcp-best-practices-review.md): **70 tests pass** (23 unit, 44 database/MCP including Inspector, 3 browser). The new cases cover malformed requests, transport/authentication boundaries, discovery metadata and ten read-only evaluation questions. Lint, typecheck, production build and browser workflows were rerun. Dependency installation, initial infrastructure setup and the dependency audit below are evidence from the initial build; the compiled-runtime health row is from the preceding contract 0.2 pass.

## Executed checks

| Check                                              | Result and boundary                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                   | Passed with pinned lockfile. Node 24 and pnpm 11.25.0 on this Mac.                                                                                                                                     |
| `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:seed` | Dedicated local PostgreSQL 17.6; seeded fictional Harbor Burger menu and demo roles.                                                                                                                   |
| `pnpm test`                                        | **23 passed**: 8 deterministic menu/cart cases, 4 audio queue/generation cases, 4 synthetic Nova event cases, 7 MCP contract cases.                                                                    |
| `SAYGO_INSPECTOR_TEST=1 pnpm test:integration`     | **44 passed** against isolated `saygo_test` and a real HTTP MCP endpoint on 3111, including Inspector and ten read-only evaluation verifications. Without the opt-in, 43 run and Inspector is skipped. |
| `pnpm test:e2e`                                    | **3 passed**, latest browser run 15.0 seconds: correction/reload/consent/kitchen/next vehicle; crew takeover/edit/release; stock invalidation/recovery.                                                |
| `pnpm lint`, `pnpm typecheck`                      | Passed. Strict TypeScript checks include web, runtime, worker and shared packages.                                                                                                                     |
| `pnpm build`                                       | Passed: Next.js optimized build and compiled Node runtime/worker entry points. No deployment.                                                                                                          |
| Compiled runtime smoke test                        | Started the built runtime on temporary loopback port 3112; `/health` returned `{"ok":true,"pos":"sandbox","voice":false}`; stopped that temporary child process.                                       |
| Running development health                         | Runtime 3101 returned healthy; order-board route 3100 returned HTTP 200. Web/runtime/worker and dedicated database left running for local use.                                                         |
| `pnpm audit --prod --audit-level high`             | No known vulnerabilities reported at execution time. This is dependency advisory coverage, not an independent security audit.                                                                          |
| `git diff --check`                                 | Passed. New implementation files remain uncommitted; no repository publication or remote was created.                                                                                                  |

Integration tests explicitly assert the test database name before truncating fixture tables. Browser tests operate on the fictional demo, create new lane sessions and leave accepted sample tickets intact. They should not run during someone else's active demonstration. Existing demo staff/menu settings are preserved by seeding and the explicit scoped demo reset.

## Acceptance coverage

The following maps the brief's 18 cases to executable checks. Passing an adapter-level or fault-injection test does not establish field reliability.

| #   | Requirement                          | Evidence                                                                                                                                                                                                                                  |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Multiple products; required choices  | Engine tests and real-MCP multi-item fixture; incomplete choices block review until completed.                                                                                                                                            |
| 2   | Two burgers, only one customized     | Separate stable lines asserted in engine, structured golden dataset and browser.                                                                                                                                                          |
| 3   | Resize drink; target intended burger | Existing lemonade line becomes large, customized burger alone loses cheese; exact $18.09 total and kitchen modifiers checked.                                                                                                             |
| 4   | Ambiguous one/that/meal              | Structured clarification issues, no guessed line or silent mutation.                                                                                                                                                                      |
| 5   | Side question preserves state        | Golden fixture and integration preserve cart and unresolved ambiguity.                                                                                                                                                                    |
| 6   | Unsupported requests                 | Engine rejects unknown products, unsupported modifiers/notes and contradictory choices; fixture unsupported request remains unresolved.                                                                                                   |
| 7   | Availability changes                 | Database and browser tests invalidate quote/confirmation; unavailable item remains visible and requires explicit correction. Restocking still requires a fresh review.                                                                    |
| 8   | Deterministic money                  | Integer-cent modifier/combo/tax assertions. Demo 8% tax is a fixture only.                                                                                                                                                                |
| 9   | Changed cart invalidates consent     | Versioned cart, menu/price changes, quote expiry, pending voice lease and model self-approval rejection tests.                                                                                                                            |
| 10  | Duplicate submissions                | Concurrent duplicate submission consumes one approval, creates one logical order/outbox and one persistent POS receipt; mismatched reuse rejected.                                                                                        |
| 11  | Timeout after acceptance             | Sandbox acknowledges internally but initially hides the receipt; same-key lookup reconciles accepted state without a second logical receipt.                                                                                              |
| 12  | Worker recovery                      | Database fault injection marks a pending job's lease expired; a fresh worker invocation reclaims and completes it. Superseded lease result cannot overwrite the winner. This is **not** an OS kill/restart or production crash soak test. |
| 13  | Staff takeover                       | Ownership fence rejects late agent writes; browser verifies preserved cart, staff-authored message, valid correction, resolve and release.                                                                                                |
| 14  | Allergy handoff                      | Automated finalization blocked; concern withheld from model/customer view; explicit staff resolution required. No allergy safety claim.                                                                                                   |
| 15  | Barge-in and stale results           | Synthetic provider events and playback queue tests stop active/scheduled sources, bound backlog and reject obsolete completion generations; stale cart versions rejected separately. **No live acoustic barge-in test.**                  |
| 16  | New customer isolation               | Revoked prior session denied; browser clears the new board while the preceding accepted ticket remains. Raw audio/transcripts are not retained locally.                                                                                   |
| 17  | Authentication and scope             | Unauthenticated, expired/forged bearer, wrong origin, cross-restaurant/session and crew-to-admin attempts rejected. Not a penetration test.                                                                                               |
| 18  | MCP compatibility                    | Actual HTTP initialize negotiates **2025-11-25**, official SDK discovers nine tools and makes structured tool calls; conversational paths do not import handlers directly.                                                                |

Test sources: [unit suites](../tests/unit), [PostgreSQL/MCP suite](../tests/integration/ordering.test.ts), [browser suite](../tests/e2e/saygo.spec.ts), [structured golden utterances](../tests/golden-utterances.json). The six golden utterances form a deterministic fixture sequence; these results do not measure unconstrained intent accuracy.

## Measured local timings

The [saved observation](evidence/local-timings.json) was recorded at **2026-10-11T03:46:00.706Z** in the latest browser run:

| Measurement                                                                | Observed |
| -------------------------------------------------------------------------- | -------: |
| Example button click → authoritative three-line cart visible               |   225 ms |
| Server-side `apply_cart_changes` MCP round trip, including result decoding |    22 ms |
| Confirmation click → sandbox-accepted board visible                        |  1848 ms |

These are **one local sample**, not percentiles, SLAs, model latency or a throughput benchmark. Browser observations include assertion/polling overhead. The MCP duration excludes initial connection/tool discovery and the fixture's preceding `get_cart` call. No audio end-of-utterance → first response measurement is reported because no live microphone/provider session occurred. Implemented transcript/audio timing hooks still require validation against real audio timestamps.

## Browser and visual evidence

The in-app browser was used first for the actual local workflow. Playwright then checked it repeatably in Chromium, with reduced motion for stable captures. The primary path reported no uncaught page errors. Desktop, tablet landscape and mobile crew/kitchen screenshots were opened and inspected; tablet/mobile checks also assert no horizontal overflow.

The MCP follow-up reran all three Playwright workflows and refreshed the screenshots and timing sample. The new review screenshot was opened and inspected; the broader visual inspection above describes the initial build. No visual redesign was part of the MCP revision.

- [Order board](evidence/order-board.png), [exact quote review](evidence/review.png), [staff takeover](evidence/staff-takeover.png), [accepted kitchen tickets](evidence/kitchen.png).
- [Tablet board](evidence/order-tablet.png), [mobile crew](evidence/crew-mobile.png), [mobile kitchen](evidence/kitchen-mobile.png).
- [Generated reference, comparison points and intentional functional differences](design.md).

The final browser pass also checks that an invalidated quote no longer leaves stale confirmation instructions visible and that the confirm control is enabled/opaque before capturing review. Semantic labels, focus styling and reduced motion are implemented; this is not a full screen-reader or accessibility certification.

## Remaining validation and operating limits

- **Live speech:** no Bedrock invocation, authorized model access, real microphone, speaker echo, noise fixtures, acoustic interruptions or spoken-price correctness verified. See [voice lifecycle](voice.md). Enabling provider calls requires the owner's AWS setup and authorization for associated charges.
- **Native Alexa+:** no partner tooling, native registration, certification, commercial shared-device isolation or Alexa conversation-history control. See [integration boundaries and future SPI mapping](integrations.md).
- **Production:** no deployment, paid resources, real restaurant orders, payment capture, commercial POS/intercom integration or hardware testing. Loopback-only demo credentials are intentionally unsuitable for shared hosting.
- **Reliability/security:** concurrency, durable leases and timeout reconciliation are locally tested; sustained load, process/crash soak, network partitions, backup/restore, browser matrix and independent security review remain future work.
- **Submission:** demo script and draft copy are provided, not a recorded video or submitted entry. User-controlled eligibility, publishing, terms and final submission gates remain open.

The usable handoff is the tested local no-key ordering slice plus implemented-but-unverified live speech adapter, not a claim that every external integration is complete.
