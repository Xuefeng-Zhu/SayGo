import {
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { config, rawClient, store } from "./index.js";
try {
  try {
    const { Table } = await rawClient.send(
      new DescribeTableCommand({ TableName: config.DYNAMODB_TABLE }),
    );
    if (
      Table?.KeySchema?.find((k) => k.KeyType === "HASH")?.AttributeName !==
        "pk" ||
      Table?.KeySchema?.find((k) => k.KeyType === "RANGE")?.AttributeName !==
        "sk"
    )
      throw new Error("Existing table does not have SayGo's pk/sk schema.");
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "ResourceNotFoundException")
      throw error;
    if (
      !config.DYNAMODB_ENDPOINT &&
      process.env.SAYGO_CREATE_AWS_TABLE !== "true"
    )
      throw new Error(
        "AWS table creation requires SAYGO_CREATE_AWS_TABLE=true.",
      );
    await rawClient.send(
      new CreateTableCommand({
        TableName: config.DYNAMODB_TABLE,
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        BillingMode: "PROVISIONED",
        ProvisionedThroughput: {
          ReadCapacityUnits: 25,
          WriteCapacityUnits: 25,
        },
        TableClass: "STANDARD",
        ...(config.DYNAMODB_ENDPOINT
          ? {}
          : {
              DeletionProtectionEnabled: true,
              Tags: [{ Key: "Project", Value: "SayGo" }],
            }),
      }),
    );
    await waitUntilTableExists(
      { client: rawClient, maxWaitTime: 120 },
      { TableName: config.DYNAMODB_TABLE },
    );
  }
  console.log(
    "SayGo DynamoDB table ready (Standard, 25 RCU / 25 WCU when newly created).",
  );
} finally {
  await store.close();
}
