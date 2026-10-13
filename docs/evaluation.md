# Evaluation and evidence

## DynamoDB migration and live-model evaluation — October 13, 2026

The current application uses DynamoDB. **79 local tests passed**: 28 unit tests, 48 integration tests including the official Inspector, and 3 browser journeys. Lint, typecheck and production build passed. Database/MCP regressions cover atomic rollback, eight concurrent updates, more than 100 reset records, worker-busy reset rejection, duplicate submissions, stale/replayed reviews, consent, staff fencing, and durable POS reconciliation. The browser journeys verified the migrated local database. The separate [AWS acceptance check](evidence/aws-dynamodb-smoke.json) verified the real cloud table through HTTP MCP, customer-only approval, four concurrent submissions, competing workers, a fresh MCP connection, kitchen transitions, customer isolation and staff fencing.

The [PostgreSQL import](evidence/dynamodb-migration.json) copied 271 existing entity records, including 9 orders/receipts, 14 products and 3 staff accounts. Four durable review identity records were added. Every copied record's content and counts were checked; the source database/volume was preserved. This checkout's ignored `.env` now selects the AWS `SayGo` table in `us-west-2`, with fixed Standard provisioned capacity of 25 RCU / 25 WCU, no indexes or autoscaling. [Storage design and free-tier limits](dynamodb.md).

Real Amazon Nova 2 Lite (`us.amazon.nova-2-lite-v1:0`) called the actual MCP endpoint against fresh, isolated AWS DynamoDB namespaces. Each question started with a new conversation and interaction, and the expected answers remained outside model input. Code allowed only `get_menu` and `get_item_details`; output schemas were validated and complete runs compared database fingerprints before/after every trial. No microphone or Sonic speech session was tested.

| Configuration                                                                                | Outcome                                                                                             | Model calls | Estimated model cost |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------: | -------------------: |
| [Reasoning disabled, 2,048 output tokens](evidence/live-model-evaluation.json)               | 0/10 exact matches; menu/modifier/math/format errors                                                |          33 |            $0.035554 |
| [Low reasoning, 2,048 output tokens](evidence/live-model-evaluation-reasoning-low.json)      | Incomplete: 6 exact matches across 8 started trials; trial 8 truncated, two questions not attempted |          16 |            $0.040883 |
| [Low reasoning, 8,192 output tokens](evidence/live-model-evaluation-reasoning-low-8192.json) | 8/10 exact matches; all ten trials completed                                                        |          20 |            $0.046195 |

Both complete runs preserved database state in every trial. The incomplete pilot did not collect its final state fingerprint for the truncated trial; its temporary entity data was cleaned. All runs preserved separate reports, and no failed final answer was retried or coached within a trial. The larger-limit run used the same questions, scoring, tools and system instructions. This is a small fixed-menu evaluation, not a broad model-quality or production reliability estimate.

The two remaining failures in the complete low-reasoning run were `1225|-50` instead of `1225|50` for the lemonade upgrade, and `cola|tea|325|50` instead of `cola,tea|325|50` for the tied drink list. The latter contains the correct facts but fails the exact format requirement; it is still scored as a failure. Reasoning-disabled Nova 2 Lite should not be considered adequate for these questions based on this run. The deterministic pricing/approval engine remains authoritative.

Total observed usage across all three runs was **190,828 input tokens and 21,694 output tokens**, costing an estimated **$0.12263174** using the verified regional standard catalog rates ($0.33/M input, $2.75/M output). This stayed under the owner's approved $1 maximum. [AWS price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-west-2/index.json), publication October 10, 2026. This is a token-based estimate; the AWS invoice was not checked.

The runner reserves conservative input/output costs before each call, keeps a 25% margin, deducts prior reported spend across preserved runs, retains reservations for unknown outcomes, disables provider retries, and bounds tools, context, turns and output. Current Nova 2 Lite does not provide CountTokens, so its input reservation uses two tokens per serialized UTF-8 byte plus 8,192 framing tokens. The input bound was checked against reported usage after each call. This is an application-side spending guard, not an AWS billing cap.

To repeat a fresh approved comparison without overwriting these results, use `SAYGO_EVAL_RUN_ID` with a unique identifier, `SAYGO_EVAL_REASONING=low` and `SAYGO_EVAL_MAX_TOKENS=8192`. Existing reports remain part of the same $1 ledger. Every run requires the explicit live-call gate and dollar maximum; use a newly approved budget before extending that scope.

## Earlier PostgreSQL build evidence

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

- **Live speech:** no Nova 2 Sonic speech invocation, real microphone, speaker echo, noise fixtures, acoustic interruptions or spoken-price correctness verified. See [voice lifecycle](voice.md). Enabling provider calls requires the owner's AWS setup and authorization for associated charges.
- **Native Alexa+:** no partner tooling, native registration, certification, commercial shared-device isolation or Alexa conversation-history control. See [integration boundaries and future SPI mapping](integrations.md).
- **Production:** the DynamoDB table is provisioned, but there is no application hosting, real restaurant orders, payment capture, commercial POS/intercom integration or hardware testing. Loopback-only demo credentials are intentionally unsuitable for shared hosting.
- **Reliability/security:** concurrency, durable leases and timeout reconciliation are locally tested; sustained load, process/crash soak, network partitions, backup/restore, browser matrix and independent security review remain future work.
- **Submission:** demo script and draft copy are provided, not a recorded video or submitted entry. User-controlled eligibility, publishing, terms and final submission gates remain open.

The usable handoff is the tested local no-key ordering slice plus implemented-but-unverified live speech adapter, not a claim that every external integration is complete.
