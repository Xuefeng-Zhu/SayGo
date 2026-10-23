# SayGo — reviewer instructions

Repository: [Xuefeng-Zhu/SayGo](https://github.com/Xuefeng-Zhu/SayGo)

Original SayGo source and documentation use the [MIT License](../../LICENSE), copyright 2026 Xuefeng Zhu. Third-party packages, generated media, audio and model assets retain their own terms; see [third-party notices](../../THIRD_PARTY_NOTICES.md). The fixture setup below needs no AWS credentials.

## Reproduce ordering without AWS credentials

Requires Node 22.12+ and pnpm 11.25.0. Start an installed Docker engine for DynamoDB Local, or use the Java 17+ alternative in [local development](../local-development.md). First-time dependency and database-image downloads need network access.

Run from the checkout root in a dedicated terminal. These explicit settings select isolated local storage and do not depend on other shell or checkout defaults:

```sh
pnpm install --frozen-lockfile

export DYNAMODB_ENDPOINT=http://127.0.0.1:8000
export DYNAMODB_TABLE=saygo-local
export DYNAMODB_NAMESPACE=saygo_reviewer
export SAYGO_DEMO=true
export SAYGO_WEB_ORIGIN=http://localhost:3100
export SAYGO_RUNTIME_PORT=3101
export SAYGO_STAFF_PASSWORD=harbor-demo-only
export SAYGO_VOICE_ENABLED=false

pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

For Java instead of Docker, keep `pnpm infra:local` running in another terminal and omit `pnpm infra:up`. Use only one database process on port 8000.

Open [the order board](http://localhost:3100/lane/lane-1). Sign in with the seeded **admin / harbor-demo-only** account and begin a customer session. These are fictional local-demo credentials, not cloud credentials. The `crew` and `kitchen` accounts use the same initial password with narrower roles.

1. Select **Start example order**, then **Apply correction**.
2. Check the separate burger modifiers and large lemonade. This predefined fixture scenario totals **$18.09**, using the seeded menu and 8% demo tax.
3. Select **Review order**, inspect the quote, then **Confirm order**.
4. Wait for **Your order is in.** Open [Kitchen](http://localhost:3100/kitchen) and check the accepted ticket and modifiers.
5. Optional: use Crew for staff takeover or Demo controls for POS rejection/delay. These actions affect the selected fictional local dataset.

The fixture inputs are a finite list. They exercise real MCP calls, validation, persistence, customer confirmation and sandbox delivery; they do not recognize arbitrary speech. Their $18.09 scenario differs from the $9.72 live-video scenario.

Stop the app with Ctrl-C. `pnpm infra:down` stops Compose storage while preserving its local volume. Ctrl-C stops the Java alternative. Do not reuse a namespace containing an unrelated demo or real restaurant data.

## Live speech is separate

The current 179-second submission film records fresh Nova 2 Sonic Tiffany replies to prerecorded Polly Matthew customer speech, plus Matthew narration and motion graphics. Take 08 uses remote DynamoDB, an isolated namespace, ten selected Voice tool types and server-verified sealed spoken approval. Its source is `2b6dc36` plus fingerprinted local changes. Watch the [public 2:59 video](https://www.youtube.com/watch?v=vc-iBxxVerc).

Free-form live voice requires your own authorized Bedrock access, a valid AWS session and access to the selected model and region. Set `SAYGO_VOICE_ENABLED=true` and `SAYGO_VOICE_MODEL=amazon.nova-2-sonic-v1:0`, then follow [voice setup](../voice.md#enable-live-voice). Provider calls incur charges. Application voice has no QA spending ledger or 90-second harness limit. Watching the video requires no AWS account.

The fixture route exercises backend ordering. The video provides a separate example of provider speech and tool use. Physical microphones, speakers, noisy intercoms and perceptual naturalness remain unverified.

## Verification checkpoints

The current [verification record](verification.md) separates fresh source checks from the recording and older runs. The selected take passed 24 flow assertions: no order before sealed spoken approval, exactly one voice approval/order/receipt, correct $9.72 items/total, matching kitchen and cleanup. The film passed 19 independent media checks and full normal-speed sound-enabled browser playback. Human perceptual acceptance remains unverified.

October 21 results (145 unit, 61 integration and 18 browser checks) are historical snapshots. They do not replace current-source checks. These setup instructions have not been verified on a fresh machine. The current checkout defaults to AWS; the explicit loopback settings above select DynamoDB Local regardless of that default.

## Development checks

```sh
pnpm test
pnpm lint
pnpm typecheck
```

Integration/browser tests mutate dedicated local test data. Follow [isolated testing](../local-development.md#browser-tests). Saved successful production web builds used the documented webpack fallback; the default Turbopack build is not claimed as passing.

## Evidence included in the repository

- [Verification summary](verification-summary.json).
- [Human-readable verification scope](verification.md) and [demo provenance](demo.md). [Recorded](recorded-source-manifest.json) and [current](current-source-manifest.json) source fingerprints identify separate snapshots; raw capture/provider evidence remains with the owner.
- [Historical gallery images](screenshots/): the older October 21 ordering, screen review, accepted order and kitchen, not current take-08 approval evidence.
- [Submission checklist](submission-checklist.md) for current-source publication and final preview/submission steps; the public video link is included.

The repository includes the summaries and screenshots listed above. Full recording and QA artifacts remain with the owner.
