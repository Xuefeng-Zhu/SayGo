import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import type { Scope } from "@saygo/contracts";
import { ProviderBudget } from "./provider-budget.js";

if (
  process.env.SAYGO_VOICE_QA !== "true" ||
  !process.env.SAYGO_PROVIDER_APPROVAL_ID
)
  throw new Error(
    "Explicit synthetic voice approval and shared provider budget are required.",
  );
const runId = process.env.SAYGO_VOICE_QA_RUN_ID;
if (!runId || !/^[a-z0-9_-]{1,40}$/.test(runId))
  throw new Error("Use a fresh simple voice QA run ID.");
const reportPath = `docs/evidence/live-voice-${runId}.json`;
const implementationHash = createHash("sha256")
  .update(
    JSON.stringify(
      await Promise.all(
        [
          "packages/integrations/src/nova.ts",
          "packages/integrations/src/menu-guidance.ts",
          "apps/web/app/components/playback.ts",
          "apps/runtime/src/voice.ts",
          "packages/contracts/src/index.ts",
        ].map(async (path) => [path, await readFile(path, "utf8")]),
      ),
    ),
  )
  .digest("hex");
try {
  await access(reportPath);
  throw new Error("Preserve existing voice evidence; choose a new run ID.");
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
process.env.DYNAMODB_NAMESPACE =
  "saygo_eval_voice_" + randomUUID().replaceAll("-", "");
process.env.DYNAMODB_ENDPOINT = "http://127.0.0.1:8000";
process.env.DYNAMODB_TABLE = "saygo-local";
process.env.SAYGO_RUNTIME_PORT = "3114";
process.env.SAYGO_QA_WEB_PORT = "3120";
process.env.SAYGO_WEB_ORIGIN = "http://localhost:3120";
process.env.SAYGO_VOICE_ENABLED = "true";
const budget = new ProviderBudget(process.env.SAYGO_PROVIDER_APPROVAL_ID);
await budget.state();
const { config, store, maintenance, clearEntities, entities } = await import(
  "@saygo/db"
);
// Verify authentication before a paid stream or reservation. Never fall back to
// a fake provider after a live failure.
try {
  execFileSync(
    "/Users/frank/.local/bin/aws",
    ["sts", "get-caller-identity", "--profile", process.env.AWS_PROFILE!],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
} catch {
  await store.close();
  throw new Error(
    "AWS_SIGN_IN_REQUIRED: authenticate the existing profile locally.",
  );
}
for (const command of ["db:migrate", "db:seed"]) {
  const result = spawnSync("pnpm", [command], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Voice QA database setup failed.");
}
const directory = resolve(".local/voice-qa", runId);
const visualDirectory = await mkdtemp("/private/tmp/saygo-voice-qa-");
await mkdir(directory, { recursive: true, mode: 0o700 });
const phrases = [
  "Add one classic burger and a medium lemonade.",
  "Change the lemonade to large. Tell me the total before tax.",
  "How much extra is medium lemonade compared with medium cola in a cheeseburger meal?",
];
const files: string[] = [];
for (let i = 0; i < phrases.length; i++) {
  const aiff = join(directory, `input-${i}.aiff`),
    pcm = join(directory, `input-${i}.pcm`);
  execFileSync(
    "/usr/bin/say",
    ["-v", "Samantha", "-r", "165", "-o", aiff, phrases[i]],
    { stdio: "ignore" },
  );
  execFileSync(
    "/opt/homebrew/bin/ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      aiff,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "s16le",
      pcm,
    ],
    { stdio: "ignore" },
  );
  files.push(pcm);
}
const { app } = await import("../apps/runtime/src/app.js");
const { attachVoice, stopVoice } = await import("../apps/runtime/src/voice.js");
const { getView, staffAction, scopeForToken } = await import("@saygo/domain");
const server = createServer(app),
  events: Record<string, unknown>[] = [];
const tools: {
    name: string;
    args: Record<string, unknown>;
    error?: unknown;
  }[] = [],
  audio: Buffer[] = [];
let naturalEnd = false,
  ended = false,
  providerRequests = 0,
  streamFailureCode: string | undefined,
  scope: Scope | undefined;
let usage = { inputSpeech: 0, inputText: 0, outputSpeech: 0, outputText: 0 };
const cost = () =>
  (usage.inputSpeech * 3 +
    usage.outputSpeech * 12 +
    usage.inputText * 0.319 +
    usage.outputText * 2.651) /
  1e6;
const voices = attachVoice(server, {
  onProviderRequest: () => {
    providerRequests++;
  },
  maximumSessionMs: 90000,
  maximumToolCalls: 24,
  onStreamEnd: (natural, failureCode) => {
    naturalEnd = natural;
    streamFailureCode = failureCode;
    ended = true;
  },
  onTool: (name, args, result) => {
    tools.push({ name, args, error: result.error });
  },
  onEvent: (event) => {
    events.push(event);
    if (event.type === "audio")
      audio.push(Buffer.from(event.audio as string, "base64"));
    if (event.type === "usage") usage = event.usage as typeof usage;
    if (cost() > 0.2 && scope) void stopVoice(scope.session_id);
  },
});
await new Promise<void>((r) => server.listen(3114, "127.0.0.1", r));
const web = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3120",
  ],
  { cwd: resolve("apps/web"), env: process.env, stdio: "ignore" },
);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page:
  | Awaited<ReturnType<NonNullable<typeof browser>["newPage"]>>
  | undefined;
let browserStatus: string[] = [];
const pageErrors: string[] = [];
let consoleErrorCount = 0;
let reservation: string | undefined,
  settled = false,
  passed = false,
  fatal: string | undefined;
const assertions: Record<string, boolean> = {};
let phase = "web_start";
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch("http://localhost:3120")).ok) break;
    } catch {
      /* starting */
    }
    if (i === 119) throw new Error("QA_WEB_START_TIMEOUT");
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({
    headless: true,
    args: ["--mute-audio", "--use-fake-device-for-media-stream"],
  });
  const context = await browser.newContext({
    viewport: { width: 1536, height: 1024 },
  });
  // Software loopback ONLY: the original getUserMedia is never invoked.
  // Literal browser JS avoids tsx's __name helper leaking into serialized
  // callbacks. Verify the override before ANY getUserMedia or voice action.
  await context.addInitScript({
    content: `
    window.saygoSoftwareGetUserMedia = async function () {
      const ac = new AudioContext();
      const destination = ac.createMediaStreamDestination();
      window.saygoSyntheticInput = { ac, destination };
      return destination.stream;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: window.saygoSoftwareGetUserMedia
    });
    window.saygoSoftwarePreflight = async function () {
      if (navigator.mediaDevices.getUserMedia !== window.saygoSoftwareGetUserMedia)
        throw new Error("SOFTWARE_CAPTURE_OVERRIDE_MISSING");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const capture = new AudioContext();
      try { capture.createMediaStreamSource(stream); }
      finally {
        stream.getTracks().forEach(function (track) { track.stop(); });
        await capture.close();
        await window.saygoSyntheticInput.ac.close();
      }
    };
    window.saygoPlayEncoded = async function (text) {
      const ac = window.saygoSyntheticInput.ac;
      const destination = window.saygoSyntheticInput.destination;
      await ac.resume();
      const bytes = Uint8Array.from(atob(text), function(c) { return c.charCodeAt(0); });
      const pcm = new DataView(bytes.buffer);
      const buffer = ac.createBuffer(1, bytes.length / 2, 16000);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768;
      const source = ac.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      await new Promise(function (resolve) { source.onended = resolve; source.start(); });
    };
  `,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.name));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !["web_start", "operator_sign_in", "begin_customer_session"].includes(
        phase,
      )
    )
      consoleErrorCount++;
  });
  phase = "operator_sign_in";
  await page.goto("http://localhost:3120/lane/lane-1");
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: join(visualDirectory, "before.png"),
    fullPage: true,
  });
  await page.getByLabel("Password", { exact: true }).fill("harbor-demo-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  phase = "begin_customer_session";
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your order", exact: true }),
  ).toBeVisible();
  const cookies = await context.cookies();
  const laneCookie = cookies.find((c) => c.name === "saygo_lane");
  if (!laneCookie) throw new Error("QA_LANE_COOKIE_MISSING");
  scope = await scopeForToken(laneCookie.value);
  assertions.pageIdentity =
    page.url() === "http://localhost:3120/lane/lane-1" &&
    (await page.title()).includes("SayGo");
  assertions.meaningfulPage = await page
    .getByRole("heading", { name: "Your order", exact: true })
    .isVisible();
  phase = "software_capture_preflight";
  await page.evaluate("window.saygoSoftwarePreflight()");
  assertions.softwareCaptureVerified = true;
  phase = "voice_start";
  reservation = await budget.reserve(
    0.25,
    "synthetic browser/Sonic stream; 90-second cap",
  );
  await page
    .getByRole("button", { name: "Start live voice", exact: true })
    .click();
  await expect(
    page.getByText("Listening · AI-generated speech", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const play = async (path: string) => {
    const encoded = (await readFile(path)).toString("base64");
    await page!.evaluate(
      "window.saygoPlayEncoded(" + JSON.stringify(encoded) + ")",
    );
  };
  phase = "initial_spoken_order";
  await play(files[0]);
  await expect(page.locator(".order-line")).toHaveCount(2, { timeout: 20000 });
  assertions.initialOrder =
    (await getView({ ...scope, actor: "agent" })).totals.subtotal === 900;
  const firstIds = (await getView({ ...scope, actor: "agent" })).lines
    .map((l) => l.id)
    .sort();
  phase = "spoken_correction";
  await play(files[1]);
  await expect
    .poll(
      async () =>
        (await getView({ ...scope!, actor: "agent" })).lines.some(
          (l) => l.product_id === "lemonade" && l.variant === "large",
        ),
      { timeout: 20000 },
    )
    .toBe(true);
  const corrected = await getView({ ...scope, actor: "agent" });
  assertions.correctedExactPrice =
    corrected.totals.subtotal === 950 && corrected.totals.total === 1026;
  assertions.stableLineIdentity =
    JSON.stringify(firstIds) ===
    JSON.stringify(corrected.lines.map((l) => l.id).sort());
  assertions.reviewBlockedWhileVoice = await page
    .getByRole("button", { name: "Review order", exact: true })
    .isDisabled();
  const comparisonEventsStart = events.length,
    comparisonToolsStart = tools.length;
  phase = "spoken_price_comparison";
  await play(files[2]);
  await expect
    .poll(
      () =>
        tools
          .slice(comparisonToolsStart)
          .some((t) => t.name === "compare_menu_prices" && !t.error),
      {
        timeout: 20000,
      },
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        events
          .slice(comparisonEventsStart)
          .some(
            (e) =>
              e.type === "caption" &&
              e.role === "ASSISTANT" &&
              e.final === true &&
              /(?:fifty|50)\s*cents|\$?0\.50\b/i.test(String(e.text)),
          ),
      { timeout: 20000 },
    )
    .toBe(true);
  assertions.comparisonCaption = true;
  assertions.realSpeechInput = events.some(
    (e) => e.type === "caption" && e.role === "USER" && e.final === true,
  );
  assertions.realSpeechOutput = audio.reduce((n, b) => n + b.length, 0) > 4800;
  assertions.authoritativeMcpCalls =
    tools.some((t) => t.name === "get_menu" && !t.error) &&
    tools.some((t) => t.name === "apply_cart_changes" && !t.error);
  phase = "staff_takeover";
  await staffAction({ ...scope, actor: "staff" }, "takeover");
  await expect.poll(() => ended, { timeout: 6000 }).toBe(true);
  assertions.staffStoppedStream = ended;
  const final = await getView({ ...scope, actor: "staff" });
  assertions.noVoiceConsentOrSubmission =
    !final.order && !final.quote?.approved;
  assertions.voiceLeaseCleared = !(
    await store.get("interactions", scope.session_id)
  )?.voice_until;
  assertions.noBrowserErrors =
    pageErrors.length === 0 && consoleErrorCount === 0;
  assertions.noFrameworkOverlay = !(await page
    .locator("[data-nextjs-dialog]")
    .count());
  await page.screenshot({
    path: join(visualDirectory, "after.png"),
    fullPage: true,
  });
  passed = Object.values(assertions).every(Boolean);
} catch (error) {
  fatal = error instanceof Error ? error.name : "UnknownError";
  if (page) {
    browserStatus = await page
      .locator("p.small[role=status]")
      .allTextContents()
      .catch(() => []);
    await page
      .screenshot({
        path: join(visualDirectory, "failure.png"),
        fullPage: true,
      })
      .catch(() => {});
  }
} finally {
  if (scope) await stopVoice(scope.session_id);
  // stopVoice drains tools before the provider's final usage/end callback.
  // Wait for that callback before deciding whether usage can settle a ticket.
  for (let i = 0; providerRequests > 0 && !ended && i < 60; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (
    reservation &&
    (providerRequests === 0 ||
      (naturalEnd && events.some((e) => e.type === "usage")))
  ) {
    try {
      await budget.settle(reservation, providerRequests === 0 ? 0 : cost());
      settled = true;
    } catch {
      passed = false;
      fatal = "PROVIDER_BUDGET_SETTLEMENT_FAILED";
    }
  }
  await browser?.close();
  web.kill("SIGTERM");
  for (const client of voices.clients) client.terminate();
  voices.close();
  await new Promise<void>((r) => server.close(() => r()));
  await maintenance((run) => clearEntities(entities, run));
  const pcm = Buffer.concat(audio),
    wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  await writeFile(join(directory, "nova-response.wav"), wav, { mode: 0o600 });
  await writeFile(
    join(directory, "tool-trace.json"),
    JSON.stringify(tools, null, 2),
    { mode: 0o600 },
  );
  const report = {
    at: new Date().toISOString(),
    runId,
    modelId: config.SAYGO_VOICE_MODEL,
    implementationHash,
    region: config.AWS_REGION,
    passed,
    fatal,
    failurePhase: fatal ? phase : undefined,
    streamFailureCode,
    providerRequests,
    browserStatus,
    pageErrors,
    consoleErrorCount,
    visualDirectory,
    assertions,
    input:
      "macOS synthetic TTS through software MediaStream; NO physical microphone",
    browser: "headless Chromium, muted output",
    usage,
    estimatedUsd: cost(),
    usageFullyObserved: naturalEnd && events.some((e) => e.type === "usage"),
    unknownOutcomeReservationUsd: reservation && !settled ? 0.25 : 0,
    additionalApproval: await budget.state(),
    audioBytes: pcm.length,
    audioHash: createHash("sha256").update(pcm).digest("hex"),
    toolNames: tools.map((t) => t.name),
    toolErrors: tools
      .filter((t) => t.error)
      .map((t) => ({ name: t.name, error: t.error })),
    transcripts: events
      .filter((e) => e.type === "caption" && e.final === true)
      .map((e) => ({ role: e.role, text: e.text })),
    temporaryEntityDataCleaned: true,
    physicalHardwareVerified: false,
    interruptionSignalsObserved: events.filter((e) => e.type === "interrupt")
      .length,
    audioFile: join(directory, "nova-response.wav"),
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await store.close();
  console.log(
    JSON.stringify({
      passed,
      fatal,
      assertions,
      estimatedUsd: cost(),
      reportPath,
    }),
  );
}
if (!passed) process.exitCode = 1;
