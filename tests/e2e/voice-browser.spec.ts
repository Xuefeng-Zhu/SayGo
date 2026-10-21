import { test, expect } from "./operator-fixture";

test("software-only capture, PCM framing, playback interruption and stop (NO provider)", async ({
  page,
}) => {
  const syntheticStream = { id: "", epoch: 0 };
  const frames: Buffer[] = [];
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), voice: true },
    });
  });
  await page.addInitScript(() => {
    const outputStats = { starts: 0, stops: 0 };
    (window as unknown as { saygoOutputStats: unknown }).saygoOutputStats =
      outputStats;
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const node = create.call(this),
        start = node.start.bind(node),
        stop = node.stop.bind(node);
      node.start = (...args: Parameters<typeof node.start>) => {
        outputStats.starts++;
        start(...args);
      };
      node.stop = (...args: Parameters<typeof node.stop>) => {
        outputStats.stops++;
        stop(...args);
      };
      return node;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const context = new AudioContext({ sampleRate: 48000 }),
          destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        gain.gain.value = 0.1;
        oscillator.frequency.value = 440;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        (window as unknown as { saygoTestAudio: unknown }).saygoTestAudio = {
          context,
          stream: destination.stream,
        };
        await context.resume();
        return destination.stream;
      },
    });
  });
  await page.routeWebSocket(/\/voice$/, (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== "string") frames.push(message);
    });
    const send = (data: object) =>
      socket.send(
        JSON.stringify({
          session_id: syntheticStream.id,
          epoch: syntheticStream.epoch,
          ...data,
        }),
      );
    send({ type: "ready" });
    setTimeout(() => {
      send({
        type: "audio",
        generation: 0,
        audio: Buffer.alloc(2400).toString("base64"),
      });
      send({ type: "interrupt", generation: 1 });
      send({
        type: "audio",
        generation: 0,
        audio: Buffer.alloc(2400).toString("base64"),
      });
      send({
        type: "caption",
        role: "ASSISTANT",
        final: true,
        text: "Synthetic transport test only.",
      });
    }, 150);
  });
  await page.goto("/lane/lane-1");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await page.getByRole("button", { name: "Start example order" }).click();
  await expect(page.locator(".order-line")).toHaveCount(3);
  const state = await (await page.request.get("/api/lane/state")).json();
  Object.assign(syntheticStream, state.session);
  const review = page.getByRole("button", {
    name: "Review order",
    exact: true,
  });
  await expect(review).toBeEnabled();
  await page
    .getByRole("button", { name: "Start live voice", exact: true })
    .click();
  await expect(
    page.getByText("Listening · response interrupted", { exact: true }),
  ).toBeVisible();
  await expect(review).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            saygoOutputStats: { starts: number; stops: number };
          }
        ).saygoOutputStats,
    ),
  ).toEqual({ starts: 1, stops: 1 });
  await expect.poll(() => frames.length).toBeGreaterThan(2);
  expect(frames.every((frame) => frame.length === 1024)).toBe(true);
  await expect
    .poll(() => frames.some((frame) => frame.some((byte) => byte !== 0)))
    .toBe(true);
  await page
    .getByRole("button", { name: "Stop live voice", exact: true })
    .click();
  await expect(page.getByText("Microphone off", { exact: true })).toBeVisible();
  await expect(review).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { saygoTestAudio: { stream: MediaStream } }
      ).saygoTestAudio.stream
        .getTracks()
        .every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
  const after = await (await page.request.get("/api/lane/state")).json();
  expect(after.cart).toEqual(state.cart);
  await page.evaluate(() =>
    (
      window as unknown as { saygoTestAudio: { context: AudioContext } }
    ).saygoTestAudio.context.close(),
  );
});
