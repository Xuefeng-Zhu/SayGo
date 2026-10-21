import { randomUUID } from "node:crypto";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { config, RESTAURANT } from "./config.js";
import { entities, rowId, type Entity, type Rows } from "./schema.js";
export { config, RESTAURANT } from "./config.js";
export { entities, rowId, type Entity, type Rows } from "./schema.js";

export const rawClient = new DynamoDBClient({
  region: config.AWS_REGION,
  ...(config.DYNAMODB_ENDPOINT
    ? {
        endpoint: config.DYNAMODB_ENDPOINT,
        credentials: {
          accessKeyId: "saygolocal",
          secretAccessKey: "local-only-placeholder",
        },
      }
    : {}),
  maxAttempts: 8,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 15000,
  }),
});
const client = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const TableName = config.DYNAMODB_TABLE;
const pk = `ENV#${config.DYNAMODB_NAMESPACE}#RESTAURANT#${RESTAURANT}`;
const guardKey = { pk, sk: "!revision" };
type Guard = { revision: number; maintenance?: string };
async function guard(): Promise<Guard> {
  const result = await client.send(
    new GetCommand({ TableName, Key: guardKey, ConsistentRead: true }),
  );
  return (result.Item as Guard | undefined) ?? { revision: 0 };
}
const copy = <T>(value: T): T => structuredClone(value);
type Staged = { entity: Entity; id: string; data: Rows[Entity] | null };

// Every writer conditions on the restaurant revision in the same atomic bundle.
// This protects absent keys and query phantoms as well as cart, quote, approval
// and worker lease changes.
export class Tx {
  private cache = new Map<string, Rows[Entity] | null>();
  private lists = new Map<Entity, Rows[Entity][]>();
  readonly writes = new Map<string, Staged>();
  private key(entity: Entity, id: string) {
    return `${entity}#${id}`;
  }
  async get<E extends Entity>(entity: E, id: string): Promise<Rows[E] | null> {
    const sk = this.key(entity, id);
    if (this.writes.has(sk))
      return copy(this.writes.get(sk)!.data as Rows[E] | null);
    if (!this.cache.has(sk)) {
      const result = await client.send(
        new GetCommand({ TableName, Key: { pk, sk }, ConsistentRead: true }),
      );
      this.cache.set(sk, (result.Item?.data as Rows[E] | undefined) ?? null);
    }
    return copy(this.cache.get(sk) as Rows[E] | null);
  }
  async list<E extends Entity>(
    entity: E,
    predicate: (row: Rows[E]) => boolean = () => true,
  ): Promise<Rows[E][]> {
    if (!this.lists.has(entity)) {
      const rows: Rows[E][] = [];
      let cursor: Record<string, unknown> | undefined;
      do {
        const result = await client.send(
          new QueryCommand({
            TableName,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
            ExpressionAttributeValues: { ":pk": pk, ":prefix": `${entity}#` },
            ConsistentRead: true,
            ExclusiveStartKey: cursor,
          }),
        );
        for (const item of result.Items ?? []) rows.push(item.data as Rows[E]);
        cursor = result.LastEvaluatedKey;
      } while (cursor);
      this.lists.set(entity, rows);
      for (const row of rows)
        this.cache.set(this.key(entity, rowId(entity, row)), row);
    }
    const rows = new Map(
      (this.lists.get(entity)! as Rows[E][]).map((row) => [
        rowId(entity, row),
        row,
      ]),
    );
    for (const write of this.writes.values())
      if (write.entity === entity) {
        if (write.data === null) rows.delete(write.id);
        else rows.set(write.id, write.data as Rows[E]);
      }
    return copy([...rows.values()].filter(predicate));
  }
  put<E extends Entity>(entity: E, data: Rows[E]) {
    const id = rowId(entity, data);
    this.writes.set(this.key(entity, id), { entity, id, data: copy(data) });
  }
  delete(entity: Entity, id: string) {
    this.writes.set(this.key(entity, id), { entity, id, data: null });
  }
  async update<E extends Entity>(
    entity: E,
    id: string,
    patch: Partial<Rows[E]>,
  ): Promise<Rows[E]> {
    const row = await this.get(entity, id);
    if (!row) throw new Error(`Missing ${entity} record`);
    const next = { ...row, ...patch };
    this.put(entity, next);
    return next;
  }
  async commit(expected: Guard) {
    if (!this.writes.size) return;
    if (this.writes.size > 99)
      throw new Error(
        "Transaction exceeds 99 entity changes; use maintenance batches.",
      );
    const items: TransactWriteCommandInput["TransactItems"] = [
      {
        Put: {
          TableName,
          Item: { ...guardKey, ...expected, revision: expected.revision + 1 },
          ConditionExpression:
            expected.revision === 0
              ? "attribute_not_exists(pk)"
              : "revision = :revision",
          ...(expected.revision === 0
            ? {}
            : {
                ExpressionAttributeValues: { ":revision": expected.revision },
              }),
        },
      },
    ];
    for (const [sk, write] of this.writes) {
      if (write.data === null)
        items.push({ Delete: { TableName, Key: { pk, sk } } });
      else {
        const Item = { pk, sk, data: write.data };
        if (Buffer.byteLength(JSON.stringify(Item)) > 350000)
          throw new Error("Entity exceeds the storage size limit.");
        items.push({ Put: { TableName, Item } });
      }
    }
    if (Buffer.byteLength(JSON.stringify(items)) > 3500000)
      throw new Error("Transaction exceeds the storage size limit.");
    await client.send(
      new TransactWriteCommand({
        TransactItems: items,
        ClientRequestToken: randomUUID(),
      }),
    );
  }
}
function conflict(error: unknown) {
  return (
    error instanceof Error &&
    ["TransactionCanceledException", "TransactionConflictException"].includes(
      error.name,
    )
  );
}
async function transact<T>(
  fn: (tx: Tx) => Promise<T>,
  maintenance?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const before = await guard();
    if (before.maintenance && before.maintenance !== maintenance)
      throw new Error(
        "Database maintenance is in progress. Retry after it completes.",
      );
    const tx = new Tx();
    try {
      const result = await fn(tx);
      if (tx.writes.size) await tx.commit(before);
      else {
        const after = await guard();
        if (
          after.revision !== before.revision ||
          after.maintenance !== before.maintenance
        )
          continue;
      }
      return result;
    } catch (error) {
      // Retry stale domain decisions and explicit transaction conflicts only.
      // Unknown network outcomes are never replayed here.
      if (!conflict(error)) {
        if (
          !(error instanceof Error && "code" in error && "status" in error) ||
          (await guard()).revision === before.revision
        )
          throw error;
      }
      if (attempt === 9) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 15 + Math.random() * (attempt + 1) * 25),
      );
    }
  }
  throw new Error("Database contention; refresh and retry.");
}
export const transaction = <T>(fn: (tx: Tx) => Promise<T>) => transact(fn);
export const store = {
  get: <E extends Entity>(entity: E, id: string) =>
    transaction((tx) => tx.get(entity, id)),
  list: <E extends Entity>(entity: E, predicate?: (row: Rows[E]) => boolean) =>
    transaction((tx) => tx.list(entity, predicate)),
  update: <E extends Entity>(entity: E, id: string, patch: Partial<Rows[E]>) =>
    transaction((tx) => tx.update(entity, id, patch)),
  put: <E extends Entity>(entity: E, row: Rows[E]) =>
    transaction(async (tx) => {
      tx.put(entity, row);
    }),
  health: () => rawClient.send(new DescribeTableCommand({ TableName })),
  close: async () => {
    rawClient.destroy();
  },
};

// Bulk maintenance is fenced from ordinary writers. Each batch is atomic; a
// crash leaves the fence in place rather than exposing partially reset state.
export async function maintenance<T>(
  fn: (run: typeof transaction) => Promise<T>,
  resume = false,
  validate?: (tx: Tx) => Promise<void>,
): Promise<T> {
  const before = await guard();
  if (before.maintenance && !resume)
    throw new Error("Database is already in maintenance.");
  const token = before.maintenance ?? randomUUID();
  if (validate && !before.maintenance) {
    const tx = new Tx();
    await validate(tx);
    if (tx.writes.size)
      throw new Error("Maintenance validation must be read-only.");
    // The fence condition below binds these reads to the same revision. If a
    // worker claims after validation, no reset fence or deletion is committed.
  }
  if (!before.maintenance)
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName,
              Item: {
                ...guardKey,
                revision: before.revision + 1,
                maintenance: token,
              },
              ConditionExpression:
                before.revision === 0
                  ? "attribute_not_exists(pk)"
                  : "revision = :revision",
              ...(before.revision === 0
                ? {}
                : {
                    ExpressionAttributeValues: { ":revision": before.revision },
                  }),
            },
          },
        ],
        ClientRequestToken: token,
      }),
    );
  const result = await fn((callback) => transact(callback, token));
  const last = await guard();
  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName,
            Item: { ...guardKey, revision: last.revision + 1 },
            ConditionExpression:
              "revision = :revision AND maintenance = :token",
            ExpressionAttributeValues: {
              ":revision": last.revision,
              ":token": token,
            },
          },
        },
      ],
      ClientRequestToken: randomUUID(),
    }),
  );
  return result;
}
export async function clearEntities(
  selected: Entity[],
  run: typeof transaction = transaction,
) {
  for (const entity of selected) {
    const rows = await run((tx) => tx.list(entity));
    for (let i = 0; i < rows.length; i += 90)
      await run(async (tx) => {
        for (const row of rows.slice(i, i + 90))
          tx.delete(entity, rowId(entity, row));
      });
  }
}
export async function resetTestData() {
  if (
    !config.DYNAMODB_ENDPOINT ||
    !/^(saygo_test|saygo_eval_[A-Za-z0-9_-]+)$/.test(config.DYNAMODB_NAMESPACE)
  )
    throw new Error(
      "Test reset requires a dedicated local test/evaluation namespace.",
    );
  await maintenance((run) => clearEntities(entities, run));
}
