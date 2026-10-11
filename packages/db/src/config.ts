import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://saygo:saygo_local_only@localhost:55432/saygo_demo"),
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
  AWS_REGION: z.string().default("us-east-1"),
  SAYGO_VOICE_MODEL: z.string().default("amazon.nova-2-sonic-v1:0"),
});
export const config = schema.parse(process.env);
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
