import {
  test,
  expect,
  type Page,
  type WebSocketRoute,
} from "./operator-fixture";
import { money, type View, type VoiceConfirmation } from "@saygo/contracts";

const first = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);
const audio = Buffer.alloc(24000).toString("base64"); // Half a second of software PCM.

type Capture = { context: AudioContext; stream: MediaStream };
declare global {
  interface Window {
    saygoConfirmationQa: {
      captures: Capture[];
      sockets: WebSocket[];
      outputStarts: number;
    };
  }
}

// These are browser presentation/playback tests. The provider socket and
// canonical confirmation/commit states are controlled fixtures, not speech QA.
async function prepare(page: Page) {
  const peers: WebSocketRoute[] = [];
  const outgoing: Record<string, unknown>[] = [];
  const submitRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith("/api/lane/confirm"))
      submitRequests.push(request.method());
  });
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), voice: true },
    });
  });
  await page.addInitScript(() => {
    const qa: Window["saygoConfirmationQa"] = {
      captures: [],
      sockets: [],
      outputStarts: 0,
    };
    window.saygoConfirmationQa = qa;
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this);
      const start = source.start.bind(source);
      source.start = (...args: Parameters<typeof source.start>) => {
        qa.outputStarts++;
        start(...args);
      };
      return source;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const context = new AudioContext({ sampleRate: 48000 });
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.01;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        qa.captures.push({ context, stream: destination.stream });
        await context.resume();
        return destination.stream;
      },
    });
  });
  await page.goto("/lane/lane-1");
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await page.getByRole("button", { name: "Start example order" }).click();
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toBeEnabled();
  let visible = (await (
    await page.request.get("/api/lane/state")
  ).json()) as View;
  await page.route("**/api/lane/state", (route) =>
    route.fulfill({ json: visible }),
  );
  const send = (data: object, index = peers.length - 1) =>
    peers[index].send(
      JSON.stringify({
        session_id: visible.session.id,
        epoch: visible.session.epoch,
        fence: visible.session.fence,
        ...data,
      }),
    );
  await page.routeWebSocket(/\/voice$/, (socket) => {
    peers.push(socket);
    socket.onMessage((message) => {
      if (typeof message === "string") outgoing.push(JSON.parse(message));
    });
    send({ type: "ready" });
  });
  await page.evaluate(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(String(url), location.href).pathname === "/voice")
          window.saygoConfirmationQa.sockets.push(this);
      }
    };
  });
  const confirmation = (
    id = first,
    status: VoiceConfirmation["status"] = "reading",
  ): VoiceConfirmation => ({
    readback_id: id,
    quote_id: visible.quote!.id,
    session_id: visible.session.id,
    epoch: visible.session.epoch,
    fence: visible.session.fence,
    cart_version: visible.cart_version,
    readback_hash: hash,
    readback_text: `Your current test order totals ${money(visible.totals.total)}. Shall I place this order?`,
    totals: visible.totals,
    status,
    ready_at: status === "reading" ? null : new Date().toISOString(),
    expires_at: new Date(Date.now() + 20000).toISOString(),
  });
  const set = (view: View) => {
    visible = view;
  };
  const readbacks = () =>
    outgoing.filter((message) => message.type === "readback_played");
  return {
    send,
    peers,
    outgoing,
    submitRequests,
    errors,
    confirmation,
    readbacks,
    set,
    get: () => visible,
  };
}
const start = (page: Page) =>
  page.getByRole("button", { name: "Start live voice", exact: true });
const stop = (page: Page) =>
  page.getByRole("button", { name: "Stop live voice", exact: true });
async function listening(page: Page) {
  await expect(
    page.getByText("Listening · AI-generated speech", { exact: true }),
  ).toBeVisible();
}
const tracks = (page: Page) =>
  page.evaluate(() =>
    window.saygoConfirmationQa.captures.map(
      (c) => c.stream.getTracks()[0]?.readyState,
    ),
  );
const complete = (id = first, generation = 0) => ({
  type: "confirmation_readback_complete",
  readback_id: id,
  readback_hash: hash,
  generation,
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    for (const capture of window.saygoConfirmationQa?.captures ?? []) {
      capture.stream.getTracks().forEach((track) => track.stop());
      await capture.context.close().catch(() => {});
    }
  });
});

test("playback receipt waits for full readback; server confirmation state never clicks Confirm", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  const readback = qa.confirmation();
  qa.set({ ...qa.get(), voice_confirmation: readback });
  qa.send({ type: "confirmation_readback", ...readback, generation: 0 });
  await expect(
    page.getByRole("heading", { name: "Listen to your order", exact: true }),
  ).toBeVisible();
  qa.send({ type: "audio", generation: 0, audio });
  qa.send({ type: "audio", generation: 0, audio });
  await expect
    .poll(() => page.evaluate(() => window.saygoConfirmationQa.outputStarts))
    .toBe(2);
  qa.send(complete());
  expect(qa.readbacks()).toEqual([]);
  await expect.poll(() => qa.readbacks().length).toBe(1);
  expect(qa.readbacks()[0]).toEqual({
    type: "readback_played",
    readback_id: first,
    readback_hash: hash,
    generation: 0,
  });
  qa.send(complete());
  qa.send({ type: "confirmation_readback", ...readback, generation: 0 });
  qa.set({
    ...qa.get(),
    voice_confirmation: {
      ...readback,
      status: "awaiting_confirmation",
      ready_at: new Date().toISOString(),
    },
  });
  qa.send({ type: "cart_changed" });
  await expect(
    page.getByRole("heading", {
      name: "Ready to place this order?",
      exact: true,
    }),
  ).toBeVisible();
  for (const text of [
    "okay",
    "do not place the order",
    "Yes, place the order",
  ]) {
    qa.send({ type: "caption", role: "USER", final: true, text });
  }
  expect(qa.submitRequests).toEqual([]);
  expect(qa.get().order).toBeNull();
  expect(qa.readbacks()).toHaveLength(1);
  const current = qa.get();
  qa.set({
    ...current,
    voice_confirmation: null,
    quote: null,
    order: {
      id: "20000000-0000-4000-8000-000000000090",
      number: 1,
      status: "submitted",
      snapshot: current.quote!.snapshot,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
  qa.send({ type: "cart_changed" });
  await expect(
    page.getByRole("heading", { name: "Sending your order…", exact: true }),
  ).toBeVisible();
  await expect.poll(() => tracks(page)).toEqual(["ended"]);
  qa.set({ ...qa.get(), order: { ...qa.get().order!, status: "accepted" } });
  await expect(
    page.getByRole("heading", { name: "Your order is in.", exact: true }),
  ).toBeVisible();
  expect(qa.submitRequests).toEqual([]);
  expect(qa.errors).toEqual([]);
});

test("interrupt cancels a pending playback receipt and only a fresh readback may acknowledge", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  qa.send({
    type: "confirmation_readback",
    ...qa.confirmation(),
    generation: 0,
  });
  qa.send({ type: "audio", generation: 0, audio });
  await expect
    .poll(() => page.evaluate(() => window.saygoConfirmationQa.outputStarts))
    .toBe(1);
  await page
    .getByRole("button", { name: "Interrupt response", exact: true })
    .click();
  const interrupt = qa.outgoing.find(
    (message) => message.type === "interrupt",
  )!;
  qa.send(complete());
  qa.send({
    type: "interrupt_ack",
    request_id: interrupt.request_id,
    generation: 1,
  });
  const next = qa.confirmation(second);
  qa.send({ type: "confirmation_readback", ...next, generation: 1 });
  qa.send({ type: "audio", generation: 1, audio });
  qa.send(complete(second, 1));
  await expect.poll(() => qa.readbacks().length).toBe(1);
  expect(qa.readbacks()[0].readback_id).toBe(second);
  expect(qa.submitRequests).toEqual([]);
  await stop(page).click();
  expect(qa.errors).toEqual([]);
});

test("partial user input, stale scope, missing audio and wrong completion cannot acknowledge", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  qa.send({
    type: "confirmation_readback",
    ...qa.confirmation(),
    generation: 0,
  });
  qa.send(complete()); // No audio was played.
  expect(qa.readbacks()).toEqual([]);
  qa.send({ type: "audio", generation: 0, audio });
  qa.send({ type: "caption", role: "USER", final: false, text: "yes place" });
  qa.send(complete());
  const next = qa.confirmation(second);
  qa.send({ type: "confirmation_readback", ...next, generation: 0 });
  qa.send({ type: "audio", generation: 0, audio });
  qa.send({ ...complete(second), readback_hash: "b".repeat(64) });
  qa.send({ ...complete(second), fence: next.fence + 1 });
  qa.send({ ...complete(second), epoch: next.epoch + 1 });
  qa.send({ ...complete(second), session_id: "other-customer" });
  await expect
    .poll(() => page.evaluate(() => window.saygoConfirmationQa.outputStarts))
    .toBe(2);
  await expect.poll(() => tracks(page)).toEqual(["live"]);
  qa.send({
    type: "caption",
    role: "ASSISTANT",
    final: true,
    text: "Still waiting for valid playback evidence.",
  });
  await page.getByText("Captions & text fallback", { exact: true }).click();
  await expect(
    page.getByText("SayGo: Still waiting for valid playback evidence.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(qa.readbacks()).toEqual([]);
  expect(qa.submitRequests).toEqual([]);
  await stop(page).click();
  expect(qa.errors).toEqual([]);
});

test("stop, reconnect and staff ownership discard readback state and never restart capture automatically", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  const readback = qa.confirmation();
  qa.set({ ...qa.get(), voice_confirmation: readback });
  qa.send({ type: "confirmation_readback", ...readback, generation: 0 });
  qa.send({ type: "audio", generation: 0, audio });
  await stop(page).click();
  await start(page).click();
  await listening(page);
  await page.evaluate(
    (frame) => {
      window.saygoConfirmationQa.sockets[0].dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(frame) }),
      );
    },
    {
      ...readback,
      ...complete(),
      session_id: readback.session_id,
      epoch: readback.epoch,
      fence: readback.fence,
    },
  );
  qa.set({
    ...qa.get(),
    voice_confirmation: null,
    session: { ...qa.get().session, owner: "staff", fence: readback.fence + 1 },
  });
  qa.send({ type: "cart_changed", fence: readback.fence });
  await expect(
    page.getByRole("heading", { name: "You’re with our crew.", exact: true }),
  ).toBeVisible();
  await expect.poll(() => tracks(page)).toEqual(["ended", "ended"]);
  qa.set({
    ...qa.get(),
    session: { ...qa.get().session, owner: "ai", fence: readback.fence + 2 },
  });
  await expect(start(page)).toBeVisible();
  await expect(stop(page)).toHaveCount(0);
  expect(qa.readbacks()).toEqual([]);
  expect(qa.submitRequests).toEqual([]);
  expect(qa.errors).toEqual([]);
});

test("changed cart and expired windows do not retain a voice confirmation prompt", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  const readback = qa.confirmation();
  qa.set({ ...qa.get(), voice_confirmation: readback });
  qa.send({ type: "confirmation_readback", ...readback, generation: 0 });
  qa.send({ type: "audio", generation: 0, audio });
  qa.set({
    ...qa.get(),
    cart_version: readback.cart_version + 1,
    cart: { ...qa.get().cart, version: readback.cart_version + 1 },
  });
  qa.send({ type: "cart_changed" });
  await expect(
    page.getByRole("heading", { name: "Listen to your order", exact: true }),
  ).toHaveCount(0);
  qa.send(complete());
  const expired = {
    ...qa.confirmation(second, "awaiting_confirmation"),
    expires_at: new Date(Date.now() - 1000).toISOString(),
  };
  qa.set({ ...qa.get(), voice_confirmation: expired });
  qa.send({ type: "cart_changed" });
  await expect(
    page.getByRole("heading", { name: "Review this order again", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Not submitted. Ask SayGo to review the current order again.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(qa.readbacks()).toEqual([]);
  expect(qa.submitRequests).toEqual([]);
  await stop(page).click();
  expect(qa.errors).toEqual([]);
});

test("unsupported confirmation stays closed and the explicit screen fallback still works", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  const readback = qa.confirmation();
  qa.set({ ...qa.get(), voice_confirmation: readback });
  qa.send({ type: "confirmation_readback", ...readback, generation: 0 });
  qa.send({ type: "audio", generation: 0, audio });
  qa.send(complete());
  qa.send({ type: "confirmation_unavailable" });
  await expect(
    page.getByText(
      "Voice confirmation isn’t available for this connection. Stop voice and confirm on screen.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Listen to your order", exact: true }),
  ).toHaveCount(0);
  qa.send({
    type: "confirmation_readback",
    ...qa.confirmation(second),
    generation: 0,
  });
  qa.send({ type: "audio", generation: 0, audio });
  qa.send(complete(second));
  qa.send({
    type: "caption",
    role: "USER",
    final: true,
    text: "Yes, place the order",
  });
  expect(qa.readbacks()).toEqual([]);
  expect(qa.submitRequests).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Confirm order", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/lane/state");
  await stop(page).click();
  const confirm = page.getByRole("button", {
    name: "Confirm order",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  const submitted = page.waitForResponse((response) =>
    response.url().endsWith("/api/lane/confirm"),
  );
  await confirm.click();
  const response = await submitted;
  expect(response.ok()).toBe(true);
  expect((await response.json()).order).toBeTruthy();
  expect(qa.submitRequests).toEqual(["POST"]);
  expect(qa.errors).toEqual([]);
});
