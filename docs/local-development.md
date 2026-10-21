# Local development

Run commands from the repository root. This guide describes the fictional, no-provider demo; [AWS storage](dynamodb.md), [live voice](voice.md#enable-live-voice) and [paid text evaluation](model-improvements.md#run-an-authorized-text-evaluation) have separate setup.

## Prerequisites and first run

- Node **22.12+**; saved development checkpoints used Node 24.
- **pnpm 11.25.0**, matching `packageManager` in [package.json](../package.json).
- A running Docker engine, such as OrbStack, or [Java 17+](#use-java-instead-of-docker).

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`db:migrate` creates or validates the DynamoDB table. `db:seed` inserts missing fictional restaurant, menu and staff records; it preserves existing records. Re-running the seed does not reset changed prices, stock or existing staff passwords.

Open [the order board](http://localhost:3100/lane/lane-1), sign in with `admin` / `harbor-demo-only`, and begin a customer session. The `crew` and `kitchen` usernames use the same initial password with their respective permissions. These are defaults for newly seeded local data.

| Process         | Default address         | Purpose                                                      |
| --------------- | ----------------------- | ------------------------------------------------------------ |
| Next.js web app | `http://localhost:3100` | Lane, crew, kitchen, administration and demo controls.       |
| Node runtime    | `http://localhost:3101` | HTTP API, `/mcp`, `/voice` and `/health`; binds to loopback. |
| Worker          | No listening port       | Polls durable POS jobs and performs retention cleanup.       |
| DynamoDB Local  | `http://127.0.0.1:8000` | Persistent local table shared by isolated namespaces.        |

`pnpm dev` starts web, runtime and worker together. Check runtime/database connectivity with:

```sh
curl --fail http://localhost:3101/health
```

A healthy fixture runtime returns `{"ok":true,"pos":"sandbox","voice":false}`. This checks database connectivity; use the [ordering flow](../README.md#try-the-ordering-flow) to verify seeded data and the worker/POS/kitchen path.

## Configuration

Defaults are defined in [packages/db/src/config.ts](../packages/db/src/config.ts); the web app loads the repository-root `.env` through [next.config.mjs](../apps/web/next.config.mjs). Runtime/worker commands load `.env` from the current directory, so run them from the repository root. Exported shell variables take precedence over `.env` values. A root `.env` is optional; [.env.example](../.env.example) contains the local defaults. Keep private credentials in ignored configuration.

| Setting                | Default                            | Use                                                                                                                |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DYNAMODB_ENDPOINT`    | `http://127.0.0.1:8000`            | Only uncredentialed loopback HTTP endpoints are accepted. An explicitly empty value selects AWS.                   |
| `DYNAMODB_TABLE`       | `saygo-local`                      | Table created/validated by `db:migrate`.                                                                           |
| `DYNAMODB_NAMESPACE`   | `saygo_demo`                       | Data partition within the table. Switching namespaces selects a different dataset.                                 |
| `SAYGO_DEMO`           | `true`                             | Required by the fictional seed and demo reset.                                                                     |
| `SAYGO_WEB_ORIGIN`     | `http://localhost:3100`            | Exact allowed browser origin, including port. Use `localhost` consistently in the browser.                         |
| `SAYGO_RUNTIME_PORT`   | `3101`                             | Runtime listener and web API proxy target. Changing this does not change the web port.                             |
| `SAYGO_STAFF_PASSWORD` | `harbor-demo-only`                 | Password used when seeding missing staff accounts. Existing hashes are preserved.                                  |
| `SAYGO_TOKEN_SECRET`   | Local demo value in `.env.example` | Signs server-side credentials. Private values of at least 32 characters are required before shared/production use. |
| `SAYGO_VOICE_ENABLED`  | `false`                            | Explicit opt-in to paid live voice. Fixture mode needs no AWS credentials.                                         |
| `AWS_REGION`           | `us-west-2`                        | AWS region for DynamoDB and Bedrock.                                                                               |
| `SAYGO_VOICE_MODEL`    | `amazon.nova-2-sonic-v1:0`         | Bedrock voice model when enabled.                                                                                  |

If your root `.env` already selects AWS or live voice, run this in a dedicated terminal **before** migrate, seed and dev to select local fixture mode:

```sh
export DYNAMODB_ENDPOINT=http://127.0.0.1:8000
export DYNAMODB_TABLE=saygo-local
export DYNAMODB_NAMESPACE=saygo_demo
export SAYGO_DEMO=true
export SAYGO_WEB_ORIGIN=http://localhost:3100
export SAYGO_RUNTIME_PORT=3101
export SAYGO_VOICE_ENABLED=false
```

Restart app processes after configuration changes. The web API proxy is configured when Next.js starts/builds. Changing `.env` and re-seeding does not rotate existing passwords. To seed different credentials for a separate demo, select a fresh namespace; the current staff administration screen manages access, not passwords.

## Stop and restart

Press Ctrl-C in the `pnpm dev` terminal to stop web, runtime and worker. Then stop Docker-backed storage with:

```sh
pnpm infra:down
```

This stops Compose services and preserves the named DynamoDB volume. Restart storage with `pnpm infra:up`; migrations and seed can be repeated safely. Demo controls provide an explicit reset of fictional interactions/tickets while preserving menu/staff settings.

### Use Java instead of Docker

With Java 17+, `curl` and `tar` installed, run this in a separate terminal:

```sh
pnpm infra:local
```

The helper downloads DynamoDB Local on first use, validates its SHA-256 checksum, and serves port 8000. It keeps files and persistent data in ignored `.local/dynamodb/`. Leave that terminal open while running migrate, seed and dev in another terminal. Ctrl-C stops Java; `pnpm infra:down` controls Docker services only.

Choose either Docker or Java for port 8000. Their storage locations are separate, so switching between them does not carry over your demo data. The legacy PostgreSQL Compose profile is needed only for [import/recovery](dynamodb.md#preserving-postgresql-data).

## Checks without provider calls

| Command                 | Requirements and effects                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`             | Unit tests; no running database or provider required.                                                                                                                                    |
| `pnpm test:integration` | Requires DynamoDB Local on 8000. Migrates/seeds `saygo-local` / `saygo_test`, binds runtime port 3111 and resets the test dataset between cases. Keep this namespace reserved for tests. |
| `pnpm lint`             | ESLint for application and test sources.                                                                                                                                                 |
| `pnpm typecheck`        | Strict TypeScript checks across packages, runtime, worker and web.                                                                                                                       |
| `pnpm build`            | Typecheck, Next.js production build, and compiled runtime/worker entry points in `dist/`. Does not deploy.                                                                               |

Integration authentication tests expect `harbor-demo-only`. If your root `.env` sets a custom staff password, use `SAYGO_STAFF_PASSWORD=harbor-demo-only pnpm test:integration` when first seeding test accounts. Existing `saygo_test` staff hashes are preserved, so that override will not repair accounts previously seeded with another password.

The optional Inspector check uses `SAYGO_INSPECTOR_TEST=1 pnpm test:integration`. It invokes pinned Inspector CLI `2.10.1` via `pnpm dlx` and may need network access to download it. Otherwise that check is skipped. [Inspector implementation](../tests/inspector-check.ts).

### Browser tests

Install Chromium once:

```sh
pnpm exec playwright install chromium
```

For isolated software-only QA, start DynamoDB Local and use a dedicated terminal:

```sh
export DYNAMODB_ENDPOINT=http://127.0.0.1:8000
export DYNAMODB_TABLE=saygo-local
export DYNAMODB_NAMESPACE=saygo_eval_browser_fix
export SAYGO_DEMO=true
export SAYGO_STAFF_PASSWORD=harbor-demo-only
export SAYGO_VOICE_ENABLED=false
export SAYGO_QA_WEB_PORT=3122
export SAYGO_RUNTIME_PORT=3116
export SAYGO_WEB_ORIGIN=http://localhost:3122
export SAYGO_E2E_EVIDENCE_DIR=/private/tmp/saygo-browser-evidence
pnpm db:migrate
pnpm db:seed
pnpm test:e2e
```

The [Playwright configuration](../playwright.config.ts) starts its own web/runtime/worker processes, refuses server reuse when `SAYGO_QA_WEB_PORT` is set, and uses `.next-qa-3122` for web build output. Both ports must be free and distinct. Tests use synthetic capture and intercepted voice WebSockets; they make no Sonic calls. Accepted sample tickets remain in the selected namespace. Reuse it for repeat QA or choose a fresh `saygo_eval_…` namespace for an empty dataset. Tests expect `harbor-demo-only`; choose a fresh namespace if existing accounts were seeded with another password.

Plain `pnpm test:e2e` uses port 3100 and may reuse a running development server outside CI, including that server's database configuration. It changes lane interactions and creates sample orders. Use the isolated setup above when the usual demo dataset needs to stay available.

Without `SAYGO_E2E_EVIDENCE_DIR`, the base ordering spec writes screenshots to `docs/evidence`, and draft-feature screenshots go to `/private/tmp/saygo-draft-features`. The override above preserves historical screenshots. Failure traces/screenshots and HTML reports are ignored under `test-results/` and `playwright-report/`.

### Production build fallback

The default `pnpm build` uses Next.js's default bundler. Earlier local checkpoints encountered a Turbopack CSS-worker port-binding failure. Their successful production builds used webpack for the web app, then compiled both Node entry points:

```sh
pnpm typecheck
pnpm --filter @saygo/web exec next build --webpack
pnpm exec tsup apps/runtime/src/index.ts apps/worker/src/index.ts --format esm --out-dir dist --splitting --sourcemap
```

This is a fallback recipe. Its success would not establish that the default `pnpm build` passed. Keep results tied to the source and command actually tested; see [saved checkpoints](evaluation.md).

## Troubleshooting

| Symptom                                                         | Check or action                                                                                                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker socket unavailable                                       | Start OrbStack/your Docker engine, then retry `pnpm infra:up`; or use Java.                                                                                                      |
| Database connection refused                                     | Start one local storage backend; confirm port 8000 and the effective `DYNAMODB_ENDPOINT`.                                                                                        |
| Missing table/menu/login                                        | Run migrate then seed in the same terminal/configuration as the runtime. A new namespace needs its own seed.                                                                     |
| Seed does not restore menu/password                             | It preserves existing data. Use Menu & staff for menu edits; the configured password affects newly seeded accounts only. Demo reset preserves these settings.                    |
| `Host not allowed`, `Origin not allowed` or same-origin failure | Open the configured `SAYGO_WEB_ORIGIN` exactly and restart after changing ports. `127.0.0.1:3100` differs from `localhost:3100`. Cookie-authenticated POSTs require that Origin. |
| Port already in use                                             | Check the owning process before stopping anything. Browser QA can use alternate web/runtime ports; integration tests require 3111 and local storage uses 8000.                   |
| Unsupported fixture phrase                                      | Choose a displayed example or use menu controls. No-key fixtures do not interpret arbitrary language.                                                                            |
| Confirm is unavailable                                          | Resolve missing choices/staff handling, stop live voice, and prepare a fresh review for the current cart/menu.                                                                   |
| Default credentials rejected in production mode                 | Private staff/token settings are required for production configuration. See [security and privacy](security-privacy.md#before-shared-or-production-use).                         |

Cloud smoke tests and live text/voice evaluation are opt-in checks with separate effects and approval requirements. Follow [DynamoDB verification](dynamodb.md#verification), [text evaluation](model-improvements.md#run-an-authorized-text-evaluation) or [synthetic voice testing](voice.md#synthetic-live-test) when that layer is in scope.
