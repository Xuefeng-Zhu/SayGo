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

MCP contract 0.3 has ten tools, including read-only `compare_menu_prices`. Complete hypothetical selections are priced by the same integer-cent engine used for orders; signed comparison deltas are always later option minus the first baseline. This tool does not change a cart or create a review, approval or order. The strict per-tool output schemas, compact payloads, durable review request IDs and structured recovery errors remain in place. Direct clients must send a UUID `request_id` to `prepare_order_review` and decode the result envelope. Run `pnpm db:migrate` for DynamoDB table setup; PostgreSQL imports are documented in [DynamoDB migration](docs/dynamodb.md). See [the contract and migration guide](docs/mcp-contracts.md).

## AWS database and live-model evaluation

Set `DYNAMODB_ENDPOINT=` (empty), `DYNAMODB_TABLE=SayGo`, `DYNAMODB_NAMESPACE=saygo_demo`, `AWS_REGION=us-west-2`, and an authorized `AWS_PROFILE` to use AWS. This checkout is configured for the existing local AWS login profile. The Standard table has fixed 25 RCU / 25 WCU, no secondary indexes, and no autoscaling. See [DynamoDB setup, free-tier limits and import](docs/dynamodb.md).

`SAYGO_AWS_QA=true DYNAMODB_ENDPOINT='' pnpm test:aws` verifies a temporary cloud ordering namespace. After explicit provider budget approval, `SAYGO_LIVE_EVAL=true SAYGO_EVAL_MAX_USD=1 SAYGO_EVAL_REASONING=medium SAYGO_EVAL_MAX_TOKENS=8192 SAYGO_EVAL_RUN_ID=unique-id pnpm test:live` runs ten independent Nova 2 Lite questions against read-only MCP tools. Medium reasoning scored 9/10 on the unchanged original benchmark; the upgrade-sign failure is still open, so this command still exits nonzero. It is not a passed release gate. Low reasoning remains available as a lower-cost comparison. Use a new run ID to preserve earlier results. Sanitized reports are saved under `docs/evidence/live-model-evaluation*.json` and share the approved dollar ledger. See [model changes and evaluation boundaries](docs/model-improvements.md).

The default suite is the unchanged original ten-question benchmark. Set `SAYGO_EVAL_SUITE=generalization` with a different run ID to evaluate ten additional pre-verified questions covering quantities, tax, negative deltas, tied ID lists, modifiers and meal conversions. Answers are scored exactly as returned (trimmed only), without oracle feedback or repairing signs/delimiters. Both suites share the same cumulative approved spending ledger. A response with validated usage settles its reservation; calls with unknown outcomes retain the full conservative reservation.

## Live voice (implemented, not live-verified)

Set `SAYGO_VOICE_ENABLED=true`, `AWS_REGION`, and optionally `SAYGO_VOICE_MODEL` in an ignored root `.env`, then restart `pnpm dev`. Supply authorized Bedrock access via the normal AWS credential chain (`AWS_PROFILE`, environment, or a role). The default model is `amazon.nova-2-sonic-v1:0` and uses the configured `AWS_REGION` (currently defaulting to `us-west-2`). Confirm your account's current model availability/permissions before use. Live sessions incur provider charges; no live speech request was made during this work.

Click **Start live voice** to request a microphone. Speech is AI-generated using a Nova voice, not Alexa's proprietary voice. Continuous 16 kHz PCM capture, 24 kHz playback, provider barge-in signals, bounded queues, captions, and text fallback are implemented. Stop live voice before final confirmation. Stream failures stay failures: SayGo never pretends a fixture response came from Nova. No raw audio or transcript is stored locally.

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

Not production-ready. Native Alexa+, official Category SDK tooling, real restaurant/POS hardware, payment processing, outdoor/noisy microphone behavior, and live Sonic speech accuracy are **not verified**. The bounded live Nova 2 Lite text evaluation is documented separately in [evaluation evidence](docs/evaluation.md). Allergy requests always pause automated finalization and go to staff; fictional ingredient lists are not safety assurances. The 8% tax is a deterministic fixture, not jurisdiction-specific tax advice. The AWS DynamoDB table was provisioned; application hosting, payment, and hackathon submission remain outside this verification.
