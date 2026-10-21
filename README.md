# SayGo

**Say it. See it. Go.**

A conversational drive-through assistant that keeps modifications straight and sends explicitly confirmed orders to a kitchen display. Harbor Burger is a fictional restaurant. SayGo is the software.

This is an **independent Alexa+ concept simulator**. Its working path is browser → server-side MCP client → Streamable HTTP MCP → DynamoDB → local POS sandbox → kitchen. Payment is due at the window and outside this application.

## Run locally

Requires Node 22.12+ (verified on 24), pnpm 11.25.0, and Docker/OrbStack. Start OrbStack or your Docker engine first. A [Java 17+ alternative](docs/local-development.md#use-java-instead-of-docker) is also available.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

A fresh checkout needs no API key or `.env` for fixture mode. If you already have a root `.env`, its settings apply; use the [local configuration overrides](docs/local-development.md#configuration) when switching back from AWS or live voice.

Open [the order board](http://localhost:3100/lane/lane-1), sign in as **admin** with **harbor-demo-only**, and choose **Begin customer session**. The local `crew` and `kitchen` accounts use the same password with narrower permissions. See [local development](docs/local-development.md) for ports, configuration, shutdown and troubleshooting.

## Try the ordering flow

1. **Start example order**: two cheeseburgers, one without onions, and medium lemonade.
2. **Apply correction**: large lemonade and no cheese on the no-onion burger. With the seeded menu, three stable lines total $16.75 + $1.34 fixture tax = **$18.09**.
3. **Review order**, inspect the server quote, then **Confirm order**.
4. Wait for **Your order is in**, then open [Kitchen](http://localhost:3100/kitchen).
5. Operator controls → **Vehicle departed**, then start the next customer. The accepted kitchen order remains.

Draft changes show a persistent before/after receipt with **Undo last change**. Eligible sandwich + medium fries + drink selections show exact meal savings, applied when the customer selects **Apply meal savings**. Try **Can you make this cheaper?** under More example phrases. [Behavior and API details](docs/draft-improvements.md).

| Page                                        | Purpose                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Crew](http://localhost:3100/crew)          | Take over a session, edit a draft and send customer-facing staff messages.                                                                             |
| [Menu & staff](http://localhost:3100/admin) | Manage stock, prices, choice limits and staff access.                                                                                                  |
| [Demo controls](http://localhost:3100/demo) | Exercise POS acceptance, rejection, delay and timeout-after-acceptance. Reset clears fictional interactions/tickets and preserves menu/staff settings. |

Fixture phrases are a finite scripted list over real MCP and persistent domain logic. Free-form speech requires the [opt-in live voice path](docs/voice.md#enable-live-voice).

## Development checks

```sh
pnpm test
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm build
```

Unit tests need no running database. Integration tests require DynamoDB Local on port 8000 and use a dedicated `saygo_test` namespace. For browser tests, use the [isolated browser QA instructions](docs/local-development.md#browser-tests) to keep sample orders separate from your normal demo. That guide also covers the webpack build fallback and optional MCP Inspector check.

## Verification status

These are saved checkpoints, not a fresh test run of the current working tree. Full receipts and earlier failures are retained in [evaluation and evidence](docs/evaluation.md).

| Layer                                   | Recorded result and scope                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combined local checks, October 20, 2026 | **124 unit + 61 integration tests**, lint/typecheck passed; optional Inspector skipped. Browser, build and provider checks were not rerun. [Receipt](docs/evidence/model-fix-prepush-20261020.json).                 |
| Draft features, October 15              | Seven Chromium journeys and production webpack/runtime/worker compilation passed on the isolated feature source. [Details](docs/draft-improvements.md#local-verification).                                           |
| Text model, October 14                  | Original and additional-question suites each passed **10/10** on the same preserved source snapshot, before contract 0.5. [Results and source identity](docs/model-improvements.md).                                 |
| Live voice, October 14                  | Synthetic input through real Sonic/MCP passed 16 checks. The trial predates later shared guidance and voice changes; physical microphones, speakers and acoustic barge-in remain unverified. [Scope](docs/voice.md). |
| Recorded demo, October 14               | A local **2:36** captioned fixture demo covers ordering, correction, confirmation, kitchen and staff takeover. Zero provider calls; unpublished. [Recording and submission copy](docs/demo-and-submission.md).       |

Current MCP contract **0.5** exposes eleven tools, including read-only `compare_menu_prices` and `find_meal_savings`. Prices use the same integer-cent engine as orders. Customer confirmation stays outside MCP. [Contract and recovery guide](docs/mcp-contracts.md).

## Documentation

| To…                                                      | Read…                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Configure, run, test or troubleshoot locally             | [Local development](docs/local-development.md)                                                                                             |
| Understand services, source layout and state transitions | [Architecture](docs/architecture.md)                                                                                                       |
| Build a scoped MCP client or handle retries              | [MCP contracts](docs/mcp-contracts.md) and [best-practice review](docs/mcp-best-practices-review.md)                                       |
| Use AWS DynamoDB                                         | [DynamoDB setup and operating limits](docs/dynamodb.md)                                                                                    |
| Enable voice or run an approved provider evaluation      | [Voice lifecycle](docs/voice.md) and [text evaluation](docs/model-improvements.md#run-an-authorized-text-evaluation)                       |
| Review integration, privacy or submission boundaries     | [Integrations](docs/integrations.md), [security and privacy](docs/security-privacy.md), [demo and submission](docs/demo-and-submission.md) |
| Pick up remaining acceptance work                        | [Implementation handoff](docs/implementation-plan.md)                                                                                      |
| Understand UI decisions or SDK issues                    | [Design reference](docs/design.md) and [SDK friction log](docs/sdk-friction.md)                                                            |

SayGo is a local demo. Production hosting, native Alexa+, commercial POS/intercom hardware, real payments and broad speech reliability remain open work. Allergy requests pause automated finalization and go to staff; fictional ingredient lists are not safety assurances. The 8% tax is a fixture. Further paid trials require an approved scope and spending limit.
