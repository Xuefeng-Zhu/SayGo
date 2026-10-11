# SayGo

**Say it. See it. Go.**

A conversational drive-through assistant that keeps modifications straight and sends explicitly confirmed orders to a kitchen display. Harbor Burger is a fictional restaurant. SayGo is the software.

This is an **independent Alexa+ concept simulator**, not an Amazon simulator or native Food Ordering add-on. The working path is browser → server-side MCP client → real Streamable HTTP MCP → PostgreSQL → local POS sandbox → kitchen. Payment is due at the window and outside this application.

## Run locally

Requires Node 22.12+ (verified on 24), pnpm 11.25.0, and Docker/OrbStack.

```sh
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open [the order board](http://localhost:3100/lane/lane-1). Sign in as **admin** with **harbor-demo-only**, then choose **Begin customer session**. Separate demo usernames `crew` and `kitchen` use the same local-only password and narrower permissions. No API key or `.env` file is required for fixture mode. Optional configuration is documented in `.env.example`.

`pnpm dev` runs Next.js on 3100, the Node runtime on 3101, and the durable worker. PostgreSQL listens only on loopback at 55432 with a dedicated `saygo_demo` database and Compose volume. `pnpm infra:down` stops this database without deleting its data. Ctrl-C stops the three app processes. `GET http://localhost:3101/health` checks the database.

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

Integration tests create/use **saygo_test**, never truncate saygo_demo, and bind their MCP server to 3111. Browser tests run against the fictional demo, create new lane interactions, and leave their accepted sample tickets intact. Do not run these browser tests during someone else's demo. Screenshots are in `docs/evidence`; traces/reports are ignored by Git. The root build compiles both Node entry points and Next.js.

MCP contract 0.2 adds strict per-tool output schemas, compact agent payloads, durable review request IDs and structured recovery errors. Direct clients must send a UUID `request_id` to `prepare_order_review` and decode the new result envelope. Run migrations before upgrading; see [the contract and migration guide](docs/mcp-contracts.md).

## Live voice (implemented, not live-verified)

Set `SAYGO_VOICE_ENABLED=true`, `AWS_REGION`, and optionally `SAYGO_VOICE_MODEL` in an ignored root `.env`, then restart `pnpm dev`. Supply authorized Bedrock access via the normal AWS credential chain (`AWS_PROFILE`, environment, or a role). The default model is `amazon.nova-2-sonic-v1:0` in `us-east-1`. Confirm your account's current model availability/permissions before use. Live sessions incur provider charges; no live request was made during the initial build.

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

Not production-ready. Native Alexa+, official Category SDK tooling, real restaurant/POS hardware, payment processing, outdoor/noisy microphone behavior, and live Bedrock response accuracy are **not verified**. Allergy requests always pause automated finalization and go to staff; fictional ingredient lists are not safety assurances. The 8% tax is a deterministic fixture, not jurisdiction-specific tax advice. No deployment, payment, or hackathon submission was performed.
