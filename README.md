# SayGo

**Say it. See it. Go.**

A conversational drive-through assistant that keeps modifications straight and sends explicitly confirmed orders to a kitchen display. Harbor Burger is a fictional restaurant. SayGo is the software.

This is an **independent Alexa+ concept simulator**, not an Amazon simulator or native Food Ordering add-on. The working path is browser → server-side MCP client → real Streamable HTTP MCP → DynamoDB → local POS sandbox → kitchen. Payment is due at the window and outside this application.

## Run locally

Requires Node 22.12+ (verified on 24), pnpm 11.25.0, and Docker/OrbStack or Java 17+ for DynamoDB Local.

```sh
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open [the order board](http://localhost:3100/lane/lane-1). Sign in as **admin** with **harbor-demo-only**, then choose **Begin customer session**. Separate demo usernames `crew` and `kitchen` use the same local-only password and narrower permissions. No API key or `.env` file is required for fixture mode. Optional configuration is documented in `.env.example`.

`pnpm dev` runs Next.js on 3100, the Node runtime on 3101, and the durable worker. DynamoDB Local uses port 8000, with a dedicated `saygo_demo` namespace and persistent Compose volume. `pnpm infra:down` stops it without deleting its data. For the Java alternative, run `pnpm infra:local` in a separate terminal before table setup; it downloads AWS's checksum-verified runtime and stores data under ignored `.local/dynamodb`. Ctrl-C stops the three app processes. `GET http://localhost:3101/health` checks the database.

1. **Start example order**: two cheeseburgers, one without onions, and medium lemonade.
2. **Apply correction**: large lemonade and no cheese on the no-onion burger. Three stable lines, $16.75 subtotal + $1.34 fixture tax = **$18.09**.
3. **Review order**, inspect the server quote, then **Confirm order**.
4. Wait for **Your order is in**, then open [Kitchen](http://localhost:3100/kitchen).
5. Operator controls → **Vehicle departed**, then start the next customer. The accepted kitchen order remains.

Use [Crew](http://localhost:3100/crew) for takeover, validated edits and staff messages; [Menu & staff](http://localhost:3100/admin) for stock, prices and choice limits; [Demo controls](http://localhost:3100/demo) for accept/reject/delay/timeout-after-acceptance. Reset is explicit and scoped to the dedicated fictional dataset. It preserves menu and staff settings.

## Verify

Current verification: 68 unit tests, 50 DynamoDB/MCP integration tests and four Chromium browser journeys pass. Lint/typecheck pass. Production web/runtime/worker compilation passed using `pnpm --filter @saygo/web exec next build --webpack` followed by the root `tsup` command. The default Turbopack build failed to bind its CSS-worker port with `EPERM` in this environment; that path is not claimed as passing and the default script is unchanged.

```sh
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm build
```

Integration tests use the dedicated local **saygo_test** namespace and bind their MCP server to 3111. Test reset refuses cloud endpoints or a demo namespace. Browser tests run against the fictional demo, create new lane interactions, and leave their accepted sample tickets intact. Do not run these browser tests during someone else's demo. Screenshots are in `docs/evidence`; traces/reports are ignored by Git. The root build compiles both Node entry points and Next.js.

For isolated software-only browser QA, first migrate/seed DynamoDB Local using `DYNAMODB_ENDPOINT=http://127.0.0.1:8000 DYNAMODB_TABLE=saygo-local DYNAMODB_NAMESPACE=saygo_eval_browser_fix`, then use those same variables plus `SAYGO_QA_WEB_PORT=3122 SAYGO_RUNTIME_PORT=3116 SAYGO_VOICE_ENABLED=false pnpm test:e2e`. This starts its own servers/build directory and refuses reuse of existing servers. Four journeys pass, including synthetic audio capture with an intercepted WebSocket; this is **not** a Sonic test. Lint, strict typecheck and production build also pass.

MCP contract 0.4 has ten tools, including read-only `compare_menu_prices`. Complete hypothetical selections are priced by the same integer-cent engine used for orders. Comparisons default to a nonnegative `amount_cents`; signed later-minus-first changes require `comparison_kind: "signed_change"`. Listed meals must explicitly declare `meal_drink_variant: "medium"`; large drinks require standalone meal conversion. Returned selections echo the drink/size actually priced. This is a breaking change to the 0.3 comparison contract, but the other nine tools remain unchanged. Comparisons never change a cart or create a review, approval or order. Direct clients must send a UUID `request_id` to `prepare_order_review` and decode the strict result envelope. Run `pnpm db:migrate` for DynamoDB table setup; PostgreSQL imports are documented in [DynamoDB migration](docs/dynamodb.md). See [the contract and migration guide](docs/mcp-contracts.md).

## AWS database and live-model evaluation

Set `DYNAMODB_ENDPOINT=` (empty), `DYNAMODB_TABLE=SayGo`, `DYNAMODB_NAMESPACE=saygo_demo`, `AWS_REGION=us-west-2`, and an authorized `AWS_PROFILE` to use AWS. This checkout is configured for the existing local AWS login profile. The Standard table has fixed 25 RCU / 25 WCU, no secondary indexes, and no autoscaling. See [DynamoDB setup, free-tier limits and import](docs/dynamodb.md).

`SAYGO_AWS_QA=true DYNAMODB_ENDPOINT='' pnpm test:aws` verifies a temporary cloud ordering namespace. After explicit provider budget approval, `SAYGO_LIVE_EVAL=true SAYGO_EVAL_MAX_USD=1 SAYGO_EVAL_REASONING=medium SAYGO_EVAL_MAX_TOKENS=8192 SAYGO_EVAL_RUN_ID=unique-id pnpm test:live` runs ten independent Nova 2 Lite questions against read-only MCP tools. The unchanged original benchmark scored 9/10 with contract 0.4: the upgrade-sign case now passes, but one literal-label answer failed. It is not a passed full-suite release gate. Low reasoning remains available for comparison. Use a new run ID to preserve earlier results. Sanitized receipts are saved under `docs/evidence/live-model-evaluation*.json`. See [model changes and evaluation boundaries](docs/model-improvements.md).

The default suite is the unchanged original ten-question benchmark. Set `SAYGO_EVAL_SUITE=generalization` with a different run ID to evaluate ten additional pre-verified questions covering quantities, tax, negative deltas, tied ID lists, modifiers and meal conversions. Answers are scored exactly as returned (trimmed only), without oracle feedback or repairing signs/delimiters. Both suites share the same cumulative approved spending ledger. A response with validated usage settles its reservation; calls with unknown outcomes retain the full conservative reservation.

The 0.4 guards pass unit/HTTP MCP tests and are now exercised with real text and Sonic models. The owner approved up to $1 additional, shared through `SAYGO_PROVIDER_APPROVAL_ID=fixes-voice-20261013`. Its ignored owner-only ledger retains unknown reservations across restarts and cannot be reset; the original $0.786320 estimate remains separate. A broader additional-question run stopped at the model output limit after four passes and a truncated fifth question. `SAYGO_EVAL_IDS` allows explicitly labeled focused probes without changing any questions or answers; their reports set `fullSuite:false` and cannot stand in for a complete benchmark. All failed and partial evidence remains preserved.

## Live voice (synthetic live path verified; hardware untested)

Set `SAYGO_VOICE_ENABLED=true`, `AWS_REGION`, and optionally `SAYGO_VOICE_MODEL` in an ignored root `.env`, then restart `pnpm dev`. Supply authorized Bedrock access via the normal AWS credential chain (`AWS_PROFILE`, environment, or a role). The default model is `amazon.nova-2-sonic-v1:0` in the configured region (default `us-west-2`). Account/region authorization and an actual stream were verified for the bounded trial; recheck your own account before use. Live sessions incur provider charges.

Click **Start live voice** to request a microphone. Speech is AI-generated using a Nova voice, not Alexa's proprietary voice. Continuous 16 kHz PCM capture, 24 kHz playback, provider barge-in signals, bounded queues, captions, and text fallback are implemented. Stop live voice before final confirmation. Stream failures stay failures: SayGo never pretends a fixture response came from Nova. No raw audio or transcript is stored locally.

The owner authorized **synthetic audio only**, not physical microphone/speaker testing. `SAYGO_VOICE_QA=true SAYGO_PROVIDER_APPROVAL_ID=fixes-voice-20261013 SAYGO_VOICE_QA_RUN_ID=<fresh-id> pnpm test:voice:live` uses offline TTS, verified software input, muted fake-device Chromium and the real Sonic/MCP path. The [successful run](docs/evidence/live-voice-sonic-v4-i-20261014.json) checked exact prices, stable resize IDs, a final 50-cent comparison caption, review blocking and staff/lease shutdown without voice consent or submission. Diagnostic audio stays ignored and private. Preserve earlier receipts and check remaining approved/reserved funds before any repeat. See [voice verification boundaries](docs/voice.md).

## Boundaries and documentation

- [Architecture and state transitions](docs/architecture.md)
- [MCP contracts, retries and recovery](docs/mcp-contracts.md)
- [MCP best-practice review and Inspector evidence](docs/mcp-best-practices-review.md)
- [Security and privacy](docs/security-privacy.md)
- [Voice lifecycle and remaining tests](docs/voice.md)
- [Actual integrations, competition checks and future SPI mapping](docs/integrations.md)
- [Evaluation and evidence](docs/evaluation.md)
- [Under-three-minute demo and submission copy](docs/demo-and-submission.md)
- [SDK friction log](docs/sdk-friction.md)
- [Design reference and fidelity ledger](docs/design.md)

Not production-ready. Native Alexa+, official Category SDK tooling, real restaurant/POS hardware, payment processing, outdoor/noisy microphone behavior and broad speech reliability are **not verified**. The synthetic live slice does not establish physical acoustics or independent spoken-price accuracy. See [evaluation evidence](docs/evaluation.md). Allergy requests always pause automated finalization and go to staff; fictional ingredient lists are not safety assurances. The 8% tax is a fixture, not tax advice. Application hosting, payment and hackathon submission remain outside this verification.
