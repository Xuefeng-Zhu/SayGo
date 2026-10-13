import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  DYNAMODB_TABLE: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{3,255}$/)
    .default("saygo-local"),
  DYNAMODB_NAMESPACE: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/)
    .default("saygo_demo"),
  DYNAMODB_ENDPOINT: z.string().default("http://127.0.0.1:8000"),
  SAYGO_DEMO: z.enum(["true", "false"]).default("true"),
  SAYGO_WEB_ORIGIN: z.string().url().default("http://localhost:3100"),
  SAYGO_RUNTIME_PORT: z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .default(3101),
  SAYGO_TOKEN_SECRET: z
    .string()
    .min(32)
    .default("local-demo-secret-change-before-any-shared-host"),
  SAYGO_STAFF_PASSWORD: z.string().min(12).default("harbor-demo-only"),
  SAYGO_VOICE_ENABLED: z.enum(["true", "false"]).default("false"),
  AWS_REGION: z.string().default("us-west-2"),
  SAYGO_VOICE_MODEL: z.string().default("amazon.nova-2-sonic-v1:0"),
});
export const config = schema.parse(process.env);
if (config.DYNAMODB_ENDPOINT) {
  const endpoint = new URL(config.DYNAMODB_ENDPOINT);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    endpoint.protocol !== "http:" ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error(
      "DYNAMODB_ENDPOINT must be an uncredentialed loopback HTTP URL; leave empty for AWS.",
    );
}
const local = ["localhost", "127.0.0.1"].includes(
  new URL(config.SAYGO_WEB_ORIGIN).hostname,
);
if (
  (!local || process.env.NODE_ENV === "production") &&
  (config.SAYGO_TOKEN_SECRET.startsWith("local-demo") ||
    config.SAYGO_STAFF_PASSWORD === "harbor-demo-only")
)
  throw new Error(
    "Set private SayGo credentials before shared/production use.",
  );
export const RESTAURANT = "harbor-demo";
