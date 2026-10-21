# DynamoDB storage and operating limits

SayGo uses the AWS SDK v3 DynamoDB document client for all runtime persistence. `pg` is used only by the one-time legacy importer. The old PostgreSQL migrations and named Compose volume are preserved for recovery.

## Local and AWS setup

Without a `.env`, `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:seed` and `pnpm dev` use DynamoDB Local at `http://127.0.0.1:8000`, table `saygo-local`, namespace `saygo_demo`. `pnpm infra:local` provides a Java alternative. Fake local credentials are configured only for a validated loopback endpoint. Leave `DYNAMODB_ENDPOINT` empty for AWS so the ordinary AWS credential chain is used.

The [October 13, 2026 AWS capacity snapshot](evidence/dynamodb-capacity.json) records table `SayGo` in `us-west-2`: Standard storage, PROVISIONED capacity, fixed 25 RCU and 25 WCU, deletion protection and no secondary indexes. The setup at that checkpoint had no autoscaling, streams, global tables or configured backup features. These cloud settings were not rechecked during this documentation update. The existing AWS login is referenced by an ignored `.env`; no credential values are copied into source or configuration.

The October 13 pricing review recorded an allowance of 25 GB storage and 25 provisioned read/write units per Region and payer account. It is shared with other usage; it is not a per-table entitlement or a guarantee of a zero invoice. At that inspection, the account's other two regional tables were on-demand and used no provisioned units, and AWS Organizations reported a standalone account. Account sharing, configuration and pricing may change; check [AWS pricing](https://aws.amazon.com/dynamodb/pricing/) and account usage before relying on the historical allowance. On-demand requests, extra storage/capacity, backup features and Bedrock inference can incur separate charges.

The first 5/5 capacity configuration throttled bulk import. Fixed 25/25 completed it. There is no automatic capacity increase; sustained excess workload will throttle. This is a one-restaurant demo, not a tested production throughput target.

## Transaction design

One table stores records under `ENV#namespace#RESTAURANT#restaurant`, with `entity#identity` sort keys. Orders are keyed by session, enforcing one logical order per interaction. Durable review identities bind session, actor, request ID, argument hash and quote ID. An active-quote pointer avoids unbounded quote invalidation; menu/cart/fence versions invalidate stale reviews on read and submit.

Every write bundle includes a conditional update to the restaurant revision, preserving the previous serial ordering. Reads use strong consistency and recheck that revision. Failed conditions rerun bounded database-only work; an uncertain transport outcome is surfaced for application idempotency/reconciliation. Customer approval consumption, the order, order number and outbox job commit atomically. Worker completion checks the lease token and state in its guarded transaction.

Queries use partition/sort-key conditions and pagination. Entity collections are bounded by the demo workload; there are no table-wide scans or GSIs. The worker polls less frequently against AWS. Reads and writes cost capacity even during contention; transactions use additional units.

Each transaction supports at most 99 entity changes plus the revision. Bulk reset/import uses a maintenance fence and smaller batches. A failure leaves that fence in place. Ordinary operations fail closed until the interrupted maintenance is safely resumed. An interrupted import can be resumed with `SAYGO_RESUME_IMPORT=true`; it compares every existing destination record with the source before continuing and refuses mismatches. Do not clear a maintenance fence while a maintenance process is still running.

## Preserving PostgreSQL data

Before seeding an empty DynamoDB destination, run `pnpm db:import-postgres`. It reads the local `saygo_demo` source in a read-only repeatable-read transaction, copies all entity records, reconstructs review identities/active-quote pointers, and verifies every record's content and counts after import. `SAYGO_IMPORT_DATABASE_URL` can select another authorized source without printing it. The importer refuses an existing populated destination unless explicitly resuming a matching interrupted copy.

The executed migration preserved 9 orders and their sandbox receipts, 14 menu products, 3 staff accounts, and associated interaction/cart/approval/job/audit data. [Sanitized migration evidence](evidence/dynamodb-migration.json). The source database and volume remain recoverable.

## Verification

Local integration tests force a local `saygo_test` namespace regardless of the normal `.env`. Cloud QA and the live-model runner create fresh isolated namespaces, close their temporary HTTP servers, and clear their own entity records. They retain only small revision metadata. Live-model trials have independent conversations, a fixed verified menu, a code-enforced read-only tool allowlist, no provider retries, bounded context/output/turn counts, and a conservative spending ledger under the approved $1 limit. Saved costs are estimates from provider token usage, not an AWS invoice.
