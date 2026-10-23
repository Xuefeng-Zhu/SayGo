# DynamoDB storage and operating limits

SayGo uses the AWS SDK v3 DynamoDB document client for all runtime persistence.

## Local and AWS setup

Local development uses AWS DynamoDB by default: an empty `DYNAMODB_ENDPOINT`, table `SayGo`, namespace `saygo_demo` and region `us-west-2`. The web app, runtime and worker run on your computer. Select an authorized AWS profile or role before running database commands. Storage uses AWS credentials and capacity even when voice is disabled.

See [local development](local-development.md) for copyable setup, configuration and isolated test commands. For offline development or isolated tests, explicitly set `DYNAMODB_ENDPOINT=http://127.0.0.1:8000` and `DYNAMODB_TABLE=saygo-local` before running database or app commands. Start DynamoDB Local with `pnpm infra:up` (Docker) or `pnpm infra:local` (Java). Both use port 8000; run one at a time. Their data is separate: Compose uses its named volume, while the Java launcher stores files under ignored `.local/dynamodb`. Fake credentials are configured only for a validated loopback endpoint.

Exported shell values override the root `.env`. `db:migrate` validates the existing table's `pk`/`sk` schema. Creating a missing AWS table requires `SAYGO_CREATE_AWS_TABLE=true`; new tables use Standard provisioned 25 RCU / 25 WCU with deletion protection. `db:seed` inserts missing fictional records and preserves existing data. Check the selected account, table and namespace before either command.

The [October 13, 2026 AWS capacity snapshot](evidence/dynamodb-capacity.json) records table `SayGo` in `us-west-2`: Standard storage, PROVISIONED capacity, fixed 25 RCU and 25 WCU, deletion protection and no secondary indexes. The setup at that checkpoint had no autoscaling, streams, global tables or configured backup features. These cloud settings were not rechecked for this edit.

The October 13 pricing review recorded an allowance of 25 GB storage and 25 provisioned read/write units per Region and payer account. It is shared with other usage; it is not a per-table entitlement or a guarantee of a zero invoice. At that inspection, the account's other two regional tables were on-demand and used no provisioned units, and AWS Organizations reported a standalone account. Account sharing, configuration and pricing may change; check [AWS pricing](https://aws.amazon.com/dynamodb/pricing/) and account usage before relying on the historical allowance. On-demand requests, extra storage/capacity, backup features and Bedrock inference can incur separate charges.

There is no automatic capacity increase; sustained excess workload will throttle. Throughput has only been exercised for the one-restaurant demo.

## Transaction design

One table stores records under `ENV#namespace#RESTAURANT#restaurant`, with `entity#identity` sort keys. Orders are keyed by session, enforcing one logical order per interaction. Durable review identities bind session, actor, request ID, argument hash and quote ID. An active-quote pointer avoids unbounded quote invalidation; menu/cart/fence versions invalidate stale reviews on read and submit.

Every write bundle includes a conditional update to the restaurant revision, preserving the previous serial ordering. Reads use strong consistency and recheck that revision. Failed conditions rerun bounded database-only work; an uncertain transport outcome is surfaced for application idempotency/reconciliation. Customer approval consumption, the order, order number and outbox job commit atomically. Worker completion checks the lease token and state in its guarded transaction.

Queries use partition/sort-key conditions and pagination. Entity collections are bounded by the demo workload; there are no table-wide scans or GSIs. The worker polls less frequently against AWS. Reads and writes cost capacity even during contention; transactions use additional units.

Each transaction supports at most 99 entity changes plus the revision. Bulk reset uses a maintenance fence and smaller batches. A failure leaves that fence in place. Ordinary operations fail closed until the interrupted maintenance is safely resumed. Do not clear a maintenance fence while a maintenance process is still running.

## Verification

Local integration tests force a local `saygo_test` namespace regardless of the normal `.env`. Follow the [local verification guide](local-development.md) to start DynamoDB Local and run the software checks. Cloud QA and the live-model runner create fresh isolated namespaces, close their temporary HTTP servers, and clear their own entity records. They retain only small revision metadata.

For an authorized cloud persistence check against the existing `SayGo` table, use the intended AWS credential chain and explicitly select the table and region:

```sh
SAYGO_AWS_QA=true \
DYNAMODB_ENDPOINT='' \
DYNAMODB_TABLE=SayGo \
AWS_REGION=us-west-2 \
SAYGO_DEMO=true \
pnpm test:aws
```

This writes temporary fictional ordering data to AWS and uses local MCP port 3114; it makes no Bedrock calls. It writes its result to `docs/evidence/aws-dynamodb-smoke.json`, so preserve the previous receipt before an authorized rerun. The check covers persistence; hosting and commercial POS integration require separate tests.

Live-model trials have independent conversations, a fixed verified menu, a code-enforced read-only tool allowlist, no provider retries, and bounded context/output/turn counts. [Authorized text-evaluation setup](model-improvements.md#run-an-authorized-text-evaluation) uses an initialized approval ledger to account for observed usage and outstanding reservations against that approval's limit. Historical approvals and passing reports do not authorize new calls. Saved costs are estimates from provider token usage, not an AWS invoice or a billing-enforced cap.
