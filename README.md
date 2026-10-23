# SayGo

**Say it. See it. Go.**

A conversational drive-through assistant that keeps modifications straight and sends explicitly confirmed orders to a kitchen display. Harbor Burger is a fictional restaurant. SayGo is the software.

This is an **independent Alexa+ concept simulator**. Its working path is browser → server-side MCP client → Streamable HTTP MCP → DynamoDB → local POS sandbox → kitchen. Payment is due at the window and outside this application.

## Submission review

The [submission draft](devpost-submission.md) and [reviewer instructions](docs/submission/reviewer-instructions.md) describe the Alexa+ simulated-experience route and a credential-free local ordering flow. The repository is public. Original SayGo code and documentation use the [MIT License](LICENSE); [third-party and media terms](THIRD_PARTY_NOTICES.md) remain separate. The public YouTube/Vimeo video URL is pending.

The selected 106.672-second demo uses prerecorded Polly Generative Matthew customer speech/narration, fresh Nova 2 Sonic Tiffany replies and a local mock POS. Its extra spoken size clarification is visible. It predates the concise-response prompt; it does not demonstrate that new behavior.

For judging, explicitly select local storage before migration, seed and startup: `DYNAMODB_ENDPOINT=http://127.0.0.1:8000`, `DYNAMODB_TABLE=saygo-local`, `DYNAMODB_NAMESPACE=saygo_reviewer`, `SAYGO_DEMO=true` and `SAYGO_VOICE_ENABLED=false`. Start DynamoDB Local with Docker or the documented Java helper. No owner AWS credentials are needed for this fixture route.

## Run locally

Requires Node 22.12+ (verified on 24), pnpm 11.25.0, network access and AWS credentials authorized for the existing DynamoDB development table. The app runs on your computer and uses AWS DynamoDB by default: table `SayGo` in `us-west-2`, namespace `saygo_demo`. Docker and Java are optional for [offline storage and isolated tests](docs/local-development.md#offline-storage).

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Select your existing AWS profile or role through the normal AWS credential chain before running database commands. A root `.env` can hold `AWS_PROFILE` and configuration overrides; see [.env.example](.env.example) and [local configuration](docs/local-development.md#configuration). Keep `DYNAMODB_ENDPOINT` empty for AWS. `db:migrate` validates the existing table and requires a separate explicit opt-in to create a missing AWS table. `db:seed` inserts missing fictional development data while preserving existing records. Fixture voice makes no Bedrock calls; AWS storage still requires authentication and network access.

Open [the order board](http://localhost:3100/lane/lane-1), sign in as **admin** with **harbor-demo-only**, and choose **Begin customer session**. The local `crew` and `kitchen` accounts use the same password with narrower permissions. See [local development](docs/local-development.md) for ports, configuration, shutdown and troubleshooting.

## Try the ordering flow

1. **Start example order**: two cheeseburgers, one without onions, and medium lemonade.
2. **Apply correction**: large lemonade and no cheese on the no-onion burger. With the seeded menu, three stable lines total $16.75 + $1.34 fixture tax = **$18.09**.
3. **Review order**, inspect the server quote, then **Confirm order**.
4. Wait for **Your order is in**, then open [Kitchen](http://localhost:3100/kitchen).
5. Operator controls → **Vehicle departed**, then start the next customer. The accepted kitchen order remains.

Draft changes show a persistent before/after receipt with **Undo last change**. Eligible sandwich + medium fries + drink selections show exact meal savings, applied when the customer selects **Apply meal savings**. Try **Can you make this cheaper?** under More example phrases. [Behavior and API details](docs/draft-improvements.md).

**Ask staff** pauses automated ordering and voice so an operator can handle the draft. Returning control never submits an order or restarts voice automatically; an accepted ticket cannot be undone. See the [Undo and takeover walkthrough](docs/undo-and-takeover.md).

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

The scoped concise-prompt source was checked again for this submission update: **145 unit tests**, lint, root/web TypeScript, production webpack frontend build and runtime/worker compilation passed. These checks do not establish live model brevity. The attempted live follow-up was blocked before any provider request by the existing expired AWS login. See [current verification boundaries](docs/submission/verification.md).

Earlier checkpoints below identify their own source and scope; they are not fresh passes for every subsequent change. Full receipts and earlier failures are retained in [evaluation and evidence](docs/evaluation.md).

| Layer                                   | Recorded result and scope                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combined local checks, October 20, 2026 | **124 unit + 61 integration tests**, lint/typecheck passed; optional Inspector skipped. Browser, build and provider checks were not rerun. [Receipt](docs/evidence/model-fix-prepush-20261020.json).                 |
| Draft features, October 15              | Seven Chromium journeys and production webpack/runtime/worker compilation passed on the isolated feature source. [Details](docs/draft-improvements.md#local-verification).                                           |
| Text model, October 14                  | Original and additional-question suites each passed **10/10** on the same preserved source snapshot, before contract 0.5. [Results and source identity](docs/model-improvements.md).                                 |
| Live voice, October 14                  | Synthetic input through real Sonic/MCP passed 16 checks. The trial predates later shared guidance and voice changes; physical microphones, speakers and acoustic barge-in remain unverified. [Scope](docs/voice.md). |
| Latest live demo, October 21 | **1:46.672**, English captions; prerecorded Polly Matthew customer/narration, fresh Nova Tiffany replies, explicit screen confirmation and one local POS receipt. The size mismatch was corrected by another spoken clarification. Predates the concise prompt; public link pending. [Scope](docs/submission/demo.md). |
| Historical fixture demo, October 14 | A local **2:36** captioned fixture recording covers ordering, correction, confirmation, kitchen and staff takeover. Zero provider calls; distinct from the latest live demo. [Historical recording](docs/demo-and-submission.md). |

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

## License

Original SayGo source code and associated documentation are MIT-licensed, copyright (c) 2026 Xuefeng Zhu. This grant does not relicense third-party packages, generated/recorded media, external services or model assets. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
