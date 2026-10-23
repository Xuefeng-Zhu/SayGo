# SayGo

SayGo is a browser-based drive-through ordering demo for the fictional Harbor Burger restaurant. Customers build and correct an order, review the exact price, and approve it before a local POS sandbox sends it to the kitchen display.

Built as an independent Alexa+ concept simulator, SayGo connects the browser to a Streamable HTTP MCP server and DynamoDB. Its eleven tools handle menu lookup, cart changes, price comparisons and order submission. Customer approval is recorded separately from model tool calls. Optional voice ordering uses Amazon Nova 2 Sonic.

## Run locally

Requires Node.js 22.12+ and pnpm 11.25.0. By default, the app uses the existing AWS DynamoDB table `SayGo` in `us-west-2`, with namespace `saygo_demo`. Select an AWS profile or role with access to that table before running:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open [the order board](http://localhost:3100/lane/lane-1), sign in as **admin** with **harbor-demo-only**, and choose **Begin customer session**. The `crew` and `kitchen` accounts use the same local password with narrower permissions.

Use [.env.example](.env.example) for configuration. Keep `DYNAMODB_ENDPOINT` empty for AWS. Migration validates the existing table; creating a missing AWS table requires an explicit opt-in. Seeding adds missing fictional data and preserves existing records.

For a setup without AWS credentials, follow the [reviewer instructions](docs/submission/reviewer-instructions.md). That route uses DynamoDB Local with Docker or Java. The [local development guide](docs/local-development.md) covers both storage options, ports and troubleshooting.

## Try an order

1. Choose **Start example order**: two cheeseburgers, one without onions, and a medium lemonade.
2. Choose **Apply correction**: make the lemonade large and remove cheese from the no-onion burger. The seeded menu totals **$18.09**, including 8% fixture tax.
3. Choose **Review order**, check the items and price, then **Confirm order**.
4. Wait for **Your order is in**, then open [Kitchen](http://localhost:3100/kitchen) to see the accepted ticket.
5. Under Operator controls, choose **Vehicle departed**, then **Begin customer session** for the next customer. The accepted kitchen ticket remains.

Each draft change shows a before/after receipt with **Undo last change**. Eligible sandwich, medium fries and drink selections also show meal savings; **Apply meal savings** applies the displayed proposal. Try **Can you make this cheaper?** under More example phrases. See [draft changes and meal savings](docs/draft-improvements.md).

**Ask staff** pauses automated ordering and voice so a crew member can edit the draft. Returning control requires the customer to restart voice or review the order. Accepted tickets cannot be undone. See [Undo and staff takeover](docs/undo-and-takeover.md).

The example phrases are scripted and use the MCP server and persistent cart logic. Free-form speech requires [live voice](docs/voice.md#enable-live-voice). Stop voice before reviewing and confirming on screen. Spoken or typed affirmations and model replies cannot record customer approval on the current Nova connection.

| Page                                        | Use it to                                                            |
| ------------------------------------------- | -------------------------------------------------------------------- |
| [Crew](http://localhost:3100/crew)          | Take over a session, edit a draft and send staff messages.           |
| [Menu & staff](http://localhost:3100/admin) | Change stock, prices, choice limits and staff access.                |
| [Demo controls](http://localhost:3100/demo) | Test POS acceptance, rejection, delays and timeout after acceptance. |

Demo reset clears fictional interactions and tickets while preserving menu and staff settings. Payment is due at the window and is outside the app. Allergy requests go to staff; the fictional menu cannot establish food safety.

## Development checks

```sh
pnpm test
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm build
```

Unit tests need no database. Integration tests require DynamoDB Local on port 8000 and use the `saygo_test` namespace. Follow the [browser test instructions](docs/local-development.md#browser-tests) to run browser checks separately from your demo data. The same guide covers the webpack build fallback and optional MCP Inspector check.

## Verification and limits

Saved results apply to the source snapshots named in their receipts:

- [Evaluation history](docs/evaluation.md): local checks, text-model results, failed runs and provider usage.
- [Submission verification](docs/submission/verification.md): the selected source and its automated checks.
- [Recorded demo](docs/submission/demo.md): a 1:46.672 recording with prerecorded Polly customer speech, fresh Nova 2 Sonic replies, screen confirmation and a local POS receipt. It predates the concise-response prompt.

Physical microphone and speaker testing, noisy speech, intercom hardware and broad speech reliability remain unverified. Shared hosting, native Alexa+ integration, commercial POS systems and real payments require further work. Live voice and model evaluations incur AWS charges; additional paid trials require an approved scope and spending limit.

## Documentation

| Topic                          | Guide                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup and troubleshooting      | [Local development](docs/local-development.md), [DynamoDB](docs/dynamodb.md)                                                               |
| Services and state transitions | [Architecture](docs/architecture.md)                                                                                                       |
| MCP clients and retries        | [Contract 0.5](docs/mcp-contracts.md), [MCP review](docs/mcp-best-practices-review.md)                                                     |
| Voice and model evaluation     | [Voice lifecycle](docs/voice.md), [text evaluation](docs/model-improvements.md#run-an-authorized-text-evaluation)                          |
| Integration and privacy        | [Integrations](docs/integrations.md), [security and privacy](docs/security-privacy.md)                                                     |
| Remaining work                 | [Implementation status](docs/implementation-plan.md)                                                                                       |
| Design and SDK feedback        | [Design](docs/design.md), [SDK friction log](docs/sdk-friction.md)                                                                         |
| Submission materials           | [Project draft](devpost-submission.md), [reviewer instructions](docs/submission/reviewer-instructions.md), [demo](docs/submission/demo.md) |

## License

[MIT](LICENSE), copyright (c) 2026 Xuefeng Zhu. See [third-party notices](THIRD_PARTY_NOTICES.md) for dependencies, media and external service terms.
