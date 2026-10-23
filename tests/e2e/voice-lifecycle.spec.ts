import {
  test,
  expect,
  type Page,
  type WebSocketRoute,
} from "./operator-fixture";
import type { View } from "@saygo/contracts";

type CaptureMode = "ready" | "pending" | "denied";
type CaptureRequest = {
  resolve: (stream: MediaStream) => void;
  reject: (error: DOMException) => void;
  settled: boolean;
  stream?: MediaStream;
};
type VoiceHarness = {
  mode: CaptureMode;
  requests: CaptureRequest[];
  sockets: WebSocket[];
  contexts: AudioContext[];
  outputStarts: number;
  outputStops: number;
  resolve: (index: number) => Promise<void>;
  reject: (index: number) => void;
  endCapture: (index: number) => void;
  close: () => Promise<void>;
};
declare global {
  interface Window {
    saygoLifecycle: VoiceHarness;
  }
}

// All capture is generated in software. The socket route never connects to the
// runtime's voice endpoint, so these regressions need neither a mic nor a model.
async function prepare(page: Page, mode: CaptureMode = "ready") {
  const peers: WebSocketRoute[] = [];
  const frames: Buffer[] = [];
  const outgoing: string[] = [];
  const errors: string[] = [];
  let session = { id: "", epoch: 0 };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), voice: true },
    });
  });
  await page.addInitScript((initialMode: CaptureMode) => {
    const harness: VoiceHarness = {
      mode: initialMode,
      requests: [],
      sockets: [],
      contexts: [],
      outputStarts: 0,
      outputStops: 0,
      resolve: async (index) => {
        const request = harness.requests[index];
        if (request.settled) throw new Error("Capture request already settled");
        request.settled = true;
        const context = new AudioContext({ sampleRate: 48000 });
        harness.contexts.push(context);
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.01;
        oscillator.frequency.value = 440;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        request.stream = destination.stream;
        await context.resume();
        request.resolve(destination.stream);
      },
      reject: (index) => {
        const request = harness.requests[index];
        if (request.settled) throw new Error("Capture request already settled");
        request.settled = true;
        request.reject(
          new DOMException("Synthetic permission denial", "NotAllowedError"),
        );
      },
      endCapture: (index) => {
        for (const track of harness.requests[index].stream!.getTracks()) {
          track.stop();
          // stop() intentionally emits no ended event. Dispatch it separately
          // to model a device ending capture, rather than an explicit UI stop.
          track.dispatchEvent(new Event("ended"));
        }
      },
      close: async () => {
        harness.requests.forEach((request) =>
          request.stream?.getTracks().forEach((track) => track.stop()),
        );
        await Promise.all(
          harness.contexts.map((context) => context.close().catch(() => {})),
        );
      },
    };
    window.saygoLifecycle = harness;
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this);
      const start = source.start.bind(source);
      const stop = source.stop.bind(source);
      source.start = (...args: Parameters<typeof source.start>) => {
        harness.outputStarts++;
        start(...args);
      };
      source.stop = (...args: Parameters<typeof source.stop>) => {
        harness.outputStops++;
        stop(...args);
      };
      return source;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        new Promise<MediaStream>((resolve, reject) => {
          const index = harness.requests.length;
          harness.requests.push({ resolve, reject, settled: false });
          if (harness.mode === "denied") harness.reject(index);
          if (harness.mode === "ready") void harness.resolve(index);
        }),
    });
  }, mode);
  const send = (data: object, index = peers.length - 1) =>
    peers[index].send(
      JSON.stringify({ session_id: session.id, epoch: session.epoch, ...data }),
    );
  await page.routeWebSocket(/\/voice$/, (socket) => {
    peers.push(socket);
    socket.onMessage((message) => {
      if (typeof message === "string") outgoing.push(message);
      else frames.push(Buffer.from(message));
    });
    send({ type: "ready" });
  });
  await page.goto("/lane/lane-1");
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await expect(
    page.getByRole("heading", { name: "Your order", exact: true }),
  ).toBeVisible();
  session = (await (await page.request.get("/api/lane/state")).json()).session;
  // Playwright's routeWebSocket instrumention replaces the constructor after
  // init scripts. Wrap the hydrated page's constructor before starting voice.
  await page.evaluate(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(String(url), location.href).pathname === "/voice")
          window.saygoLifecycle.sockets.push(this);
      }
    };
  });
  return { peers, frames, outgoing, errors, send };
}

const start = (page: Page) =>
  page.getByRole("button", { name: "Start live voice", exact: true });
const stop = (page: Page) =>
  page.getByRole("button", { name: "Stop live voice", exact: true });
const listening = (page: Page) =>
  expect(
    page.getByText("Listening · AI-generated speech", { exact: true }),
  ).toBeVisible();
const tracks = (page: Page) =>
  page.evaluate(() =>
    window.saygoLifecycle.requests.map(
      (request) => request.stream?.getTracks()[0]?.readyState ?? "none",
    ),
  );
async function depart(page: Page) {
  await page.getByText("Operator controls", { exact: true }).click();
  await page
    .getByRole("button", { name: "Vehicle departed", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Begin customer session" }),
  ).toBeVisible();
}
test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    // Finish intercepted config polling before the page/context is disposed.
    await page.unrouteAll({ behavior: "wait" });
    await page.evaluate(() => window.saygoLifecycle?.close());
  }
});

test("takeover and release between polls cancel pending capture; resume requires a fresh click", async ({
  page,
}) => {
  const qa = await prepare(page, "pending");
  let visible = await draft(page);
  await page.route("**/api/lane/state", (route) =>
    route.fulfill({ json: visible }),
  );
  await start(page).click();
  await expect(
    page.getByText("Requesting microphone permission…"),
  ).toBeVisible();
  const action = async (name: "takeover" | "release", view: View) => {
    const response = await page.request.post("/api/crew/action", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        session_id: view.session.id,
        expected_fence: view.session.fence,
        request_id: crypto.randomUUID(),
        action: name,
      },
    });
    expect(response.ok()).toBe(true);
    return draft(page);
  };
  const owned = await action("takeover", visible);
  const resumed = await action("release", owned);
  expect(resumed.session.owner).toBe("ai");
  expect(resumed.session.fence).toBeGreaterThan(visible.session.fence);
  // The customer sees only the final AI-owned view, never the intervening
  // staff-owned view. The changed fence must still invalidate old capture.
  visible = resumed;
  await expect(start(page)).toBeVisible();
  await page.evaluate(() => window.saygoLifecycle.resolve(0));
  await expect.poll(() => tracks(page)).toEqual(["ended"]);
  expect(qa.peers).toHaveLength(0);
  expect(await page.evaluate(() => window.saygoLifecycle.requests.length)).toBe(
    1,
  );
  await page.evaluate(() => {
    window.saygoLifecycle.mode = "ready";
  });
  await start(page).click();
  await listening(page);
  await expect.poll(() => tracks(page)).toEqual(["ended", "live"]);
  await stop(page).click();
  expect(qa.errors).toEqual([]);
});

test("Ask staff stops capture immediately while help is pending and prevents duplicate requests", async ({
  page,
}) => {
  const qa = await prepare(page);
  await page.getByRole("button", { name: "Start example order" }).click();
  await start(page).click();
  await listening(page);
  await expect.poll(() => qa.frames.length).toBeGreaterThan(2);
  await expect(
    page.getByRole("button", { name: "Undo last change", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Stop live voice to undo this change.", { exact: true }),
  ).toBeVisible();
  let releaseHelp!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseHelp = resolve;
  });
  let requests = 0;
  await page.route("**/api/lane/tool", async (route) => {
    if (route.request().postDataJSON()?.name === "request_staff_help") {
      requests++;
      await hold;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Ask staff", exact: true }).click();
  await expect.poll(() => tracks(page)).toEqual(["ended"]);
  await expect(
    page.getByRole("button", { name: "Ask staff", exact: true }),
  ).toBeDisabled();
  expect(requests).toBe(1);
  releaseHelp();
  await expect(
    page.getByRole("heading", { name: "Staff is on the way." }),
  ).toBeVisible();
  await expect(start(page)).toHaveCount(0);
  const before = await draft(page);
  const undo = page.getByRole("button", {
    name: "Undo last change",
    exact: true,
  });
  await expect(undo).toBeDisabled();
  await expect(
    page.getByText("Staff must finish handling this order first."),
  ).toBeVisible();
  expect((await draft(page)).cart).toEqual(before.cart);
  expect(qa.errors).toEqual([]);
});

for (const lateOutcome of ["reject", "resolve"] as const) {
  test(`pending permission can stop; late ${lateOutcome} cannot corrupt the restarted stream`, async ({
    page,
  }) => {
    const qa = await prepare(page, "pending");
    await start(page).click();
    await expect(stop(page)).toBeVisible();
    await expect(
      page.getByText("Requesting microphone permission…"),
    ).toBeVisible();
    await stop(page).click();
    await expect(
      page.getByText("Microphone off", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.saygoLifecycle.mode = "ready";
    });
    await start(page).click();
    await listening(page);
    await expect.poll(() => qa.frames.length).toBeGreaterThan(2);
    await page.evaluate(async (outcome) => {
      if (outcome === "reject") window.saygoLifecycle.reject(0);
      else await window.saygoLifecycle.resolve(0);
    }, lateOutcome);
    await expect
      .poll(() => tracks(page))
      .toEqual([lateOutcome === "resolve" ? "ended" : "none", "live"]);
    await listening(page);
    await expect(stop(page)).toBeVisible();
    const before = qa.frames.length;
    await expect.poll(() => qa.frames.length).toBeGreaterThan(before + 2);
    expect(qa.peers).toHaveLength(1);
    await stop(page).click();
    await expect
      .poll(() => tracks(page))
      .toEqual([lateOutcome === "resolve" ? "ended" : "none", "ended"]);
    expect(qa.errors).toEqual([]);
  });
}

test("permission denial and an ended device clean up and allow another start", async ({
  page,
}) => {
  const qa = await prepare(page, "denied");
  await start(page).click();
  await expect(
    page.getByText(/Microphone unavailable:.*Synthetic permission denial/),
  ).toBeVisible();
  await expect(start(page)).toBeVisible();
  expect(qa.peers).toHaveLength(0);
  await page.evaluate(() => {
    window.saygoLifecycle.mode = "ready";
  });
  await start(page).click();
  await listening(page);
  await page.evaluate(() => window.saygoLifecycle.endCapture(1));
  await expect(start(page)).toBeVisible();
  await expect.poll(() => tracks(page)).toEqual(["none", "ended"]);
  await start(page).click();
  await listening(page);
  await expect.poll(() => tracks(page)).toEqual(["none", "ended", "live"]);
  await stop(page).click();
  expect(qa.errors).toEqual([]);
});

test("failed or malformed streams close capture; old socket events cannot stop the retry", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  qa.send({ type: "pending", pending: true });
  qa.send({ type: "error", text: "Synthetic provider unavailable." });
  await expect(
    page.getByText("Synthetic provider unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(start(page)).toBeVisible();
  await expect.poll(() => tracks(page)).toEqual(["ended"]);
  await start(page).click();
  await listening(page);
  await expect
    .poll(() => page.evaluate(() => window.saygoLifecycle.sockets.length))
    .toBe(2);
  await page.evaluate(() => {
    const old = window.saygoLifecycle.sockets[0];
    old.dispatchEvent(new Event("error"));
    old.dispatchEvent(new CloseEvent("close"));
    old.dispatchEvent(new Event("open"));
  });
  await listening(page);
  await expect.poll(() => tracks(page)).toEqual(["ended", "live"]);
  qa.peers[1].send("{bad");
  await expect(start(page)).toBeVisible();
  await expect.poll(() => tracks(page)).toEqual(["ended", "ended"]);
  await start(page).click();
  await listening(page);
  qa.send({
    type: "audio",
    generation: 0,
    audio: Buffer.from([1]).toString("base64"),
  });
  await expect(start(page)).toBeVisible();
  await expect.poll(() => tracks(page)).toEqual(["ended", "ended", "ended"]);
  expect(qa.errors).toEqual([]);
});

test("local interrupt waits for its latest acknowledgement before resuming playback", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  const audio = Buffer.alloc(48000).toString("base64");
  qa.send({ type: "audio", generation: 0, audio });
  qa.send({ type: "audio", generation: 0, audio });
  await expect
    .poll(() => page.evaluate(() => window.saygoLifecycle.outputStarts))
    .toBe(2);
  await page
    .getByRole("button", { name: "Interrupt response", exact: true })
    .click();
  await expect
    .poll(
      () =>
        qa.outgoing.filter(
          (message) => JSON.parse(message).type === "interrupt",
        ).length,
    )
    .toBe(1);
  const firstRequest = JSON.parse(qa.outgoing[0]) as {
    type: string;
    request_id: string;
  };
  expect(firstRequest.request_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(await page.evaluate(() => window.saygoLifecycle.outputStops)).toBe(2);
  await page.getByText("Captions & text fallback", { exact: true }).click();
  const barrier = async (text: string) => {
    qa.send({ type: "caption", role: "USER", final: true, text });
    await expect(page.getByText(`You: ${text}`, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.saygoLifecycle.outputStarts)).toBe(
      2,
    );
  };
  qa.send({ type: "audio", generation: 0, audio });
  qa.send({ type: "interrupt", generation: 1 });
  qa.send({ type: "audio", generation: 1, audio });
  await barrier("Older server interruption received.");
  qa.send({
    type: "interrupt_ack",
    request_id: "00000000-0000-4000-8000-000000000000",
    generation: 2,
  });
  qa.send({ type: "audio", generation: 2, audio });
  await barrier("Unrelated acknowledgement received.");
  await page
    .getByRole("button", { name: "Interrupt response", exact: true })
    .click();
  await expect.poll(() => qa.outgoing.length).toBe(2);
  const latestRequest = JSON.parse(qa.outgoing[1]) as {
    type: string;
    request_id: string;
  };
  expect(latestRequest.type).toBe("interrupt");
  expect(latestRequest.request_id).not.toBe(firstRequest.request_id);
  qa.send({
    type: "interrupt_ack",
    request_id: firstRequest.request_id,
    generation: 2,
  });
  qa.send({ type: "audio", generation: 2, audio });
  await barrier("Prior request acknowledgement received.");
  qa.send({
    type: "interrupt_ack",
    request_id: latestRequest.request_id,
    generation: 2,
  });
  qa.send({ type: "audio", generation: 0, audio });
  qa.send({ type: "audio", generation: 1, audio });
  qa.send({ type: "audio", generation: 2, audio });
  await expect
    .poll(() => page.evaluate(() => window.saygoLifecycle.outputStarts))
    .toBe(3);
  await stop(page).click();
  expect(qa.errors).toEqual([]);
});

test("a prepared quote cannot be confirmed while voice is starting or listening", async ({
  page,
}) => {
  const qa = await prepare(page, "pending");
  await page
    .getByRole("button", { name: "Start example order", exact: true })
    .click();
  await page.getByRole("button", { name: "Review order", exact: true }).click();
  const confirm = page.getByRole("button", {
    name: "Confirm order",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await start(page).click();
  await expect(stop(page)).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.evaluate(() => window.saygoLifecycle.resolve(0));
  await listening(page);
  await expect(confirm).toBeDisabled();
  await stop(page).click();
  await expect(confirm).toBeEnabled();
  expect(
    (await (await page.request.get("/api/lane/state")).json()).order,
  ).toBeFalsy();
  expect(qa.errors).toEqual([]);
});

test("departure ends capture and a late permission result cannot follow the next customer", async ({
  page,
}) => {
  const qa = await prepare(page);
  await start(page).click();
  await listening(page);
  await depart(page);
  await expect.poll(() => tracks(page)).toEqual(["ended"]);
  await page.getByRole("button", { name: "Begin customer session" }).click();
  await page.evaluate(() => {
    window.saygoLifecycle.mode = "pending";
  });
  await start(page).click();
  await expect(stop(page)).toBeVisible();
  await depart(page);
  await page.evaluate(() => window.saygoLifecycle.resolve(1));
  await expect.poll(() => tracks(page)).toEqual(["ended", "ended"]);
  expect(qa.peers).toHaveLength(1);
  await expect(stop(page)).toHaveCount(0);
  expect(qa.errors).toEqual([]);
});

async function draft(page: Page): Promise<View> {
  const response = await page.request.get("/api/lane/state");
  expect(response.ok()).toBe(true);
  return response.json() as Promise<View>;
}
async function resetProposal(page: Page) {
  // A click resolves before the fixture's write finishes. Wait for the UI's
  // action barrier so this direct API request uses the committed cart version.
  await expect(
    page.getByRole("button", { name: "Start over", exact: true }),
  ).toBeEnabled();
  const current = await draft(page);
  const response = await page.request.post("/api/lane/tool", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      name: "cancel_draft_order",
      arguments: { expected_version: current.cart_version },
    },
  });
  expect(response.ok()).toBe(true);
  const proposal = (await response.json()) as View;
  expect(proposal.reset_token).toBeTruthy();
  return {
    type: "reset_proposed",
    reset_token: proposal.reset_token!,
    cart_version: proposal.cart_version,
    fence: proposal.session.fence,
    session_id: proposal.session.id,
    epoch: proposal.session.epoch,
  };
}
const resetDialog = (page: Page) =>
  page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Start this draft over?",
      exact: true,
    }),
  });
async function voiceBarrier(
  page: Page,
  qa: Awaited<ReturnType<typeof prepare>>,
  text: string,
) {
  qa.send({ type: "caption", role: "USER", final: true, text });
  await expect(page.getByText(`You: ${text}`, { exact: true })).toBeVisible();
}

test("voice cancellation displays the customer reset dialog and needs explicit touch", async ({
  page,
}) => {
  const qa = await prepare(page);
  await page
    .getByRole("button", { name: "Start example order", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start over", exact: true }),
  ).toBeVisible();
  const proposal = await resetProposal(page);
  const resetPosts: object[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/lane/reset"))
      resetPosts.push(request.postDataJSON());
  });
  await start(page).click();
  await listening(page);
  qa.send(proposal);
  await expect(resetDialog(page)).toBeVisible();
  await expect(
    page.getByText(
      "Confirming stops live voice and waits for pending changes before clearing this draft.",
    ),
  ).toBeVisible();
  const before = await draft(page);
  expect(before.lines.length).toBeGreaterThan(0);
  expect(before.order).toBeFalsy();
  expect(resetPosts).toEqual([]);
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/lane/reset"),
  );
  await resetDialog(page)
    .getByRole("button", { name: "Confirm reset", exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(resetDialog(page)).toHaveCount(0);
  await expect.poll(() => tracks(page)).toEqual(["ended"]);
  const after = await draft(page);
  expect(after.lines).toEqual([]);
  expect(after.order).toBeFalsy();
  expect(after.quote).toBeFalsy();
  expect(after.cart_version).toBe(before.cart_version + 1);
  expect(resetPosts).toEqual([
    {
      expected_version: proposal.cart_version,
      reset_token: proposal.reset_token,
    },
  ]);
  expect(qa.errors).toEqual([]);
});

test("stale, fenced and other-session reset events cannot open or silently clear the draft", async ({
  page,
}) => {
  const qa = await prepare(page);
  await page
    .getByRole("button", { name: "Start example order", exact: true })
    .click();
  const old = await resetProposal(page);
  await page
    .getByRole("button", { name: "Apply correction", exact: true })
    .click();
  const current = await resetProposal(page);
  expect(current.cart_version).toBeGreaterThan(old.cart_version);
  await start(page).click();
  await listening(page);
  await page.getByText("Captions & text fallback", { exact: true }).click();
  qa.send(old);
  qa.send({ ...current, fence: current.fence + 1 });
  qa.send({ ...current, session_id: "another-customer" });
  qa.send({ ...current, epoch: current.epoch + 1 });
  await voiceBarrier(page, qa, "Ignored stale reset proposals.");
  await expect(resetDialog(page)).toHaveCount(0);
  await listening(page);
  qa.send(current);
  await expect(resetDialog(page)).toBeVisible();
  const changed = await page.request.post("/api/lane/tool", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      name: "apply_cart_changes",
      arguments: {
        expected_version: current.cart_version,
        request_id: "96d55db5-79fb-47be-a989-e75b8b2a5701",
        commands: [
          {
            type: "add",
            product_id: "fries",
            variant: "small",
            quantity: 1,
            choices: {},
          },
        ],
      },
    },
  });
  expect(changed.ok()).toBe(true);
  qa.send({ type: "cart_changed" });
  await expect(resetDialog(page)).toHaveCount(0);
  qa.send(current);
  await voiceBarrier(page, qa, "The changed cart needs a new reset proposal.");
  await expect(resetDialog(page)).toHaveCount(0);
  const after = await draft(page);
  expect(after.lines.length).toBeGreaterThan(0);
  expect(after.order).toBeFalsy();
  await stop(page).click();
  expect(qa.errors).toEqual([]);
});

test("late old socket reset events cannot reopen a dismissed proposal on restart", async ({
  page,
}) => {
  const qa = await prepare(page);
  await page
    .getByRole("button", { name: "Start example order", exact: true })
    .click();
  const proposal = await resetProposal(page);
  await start(page).click();
  await listening(page);
  qa.send(proposal);
  await expect(resetDialog(page)).toBeVisible();
  await resetDialog(page)
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await stop(page).click();
  await start(page).click();
  await listening(page);
  await page.evaluate((message) => {
    window.saygoLifecycle.sockets[0].dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }, proposal);
  await page.getByText("Captions & text fallback", { exact: true }).click();
  await voiceBarrier(page, qa, "Old socket reset ignored.");
  await expect(resetDialog(page)).toHaveCount(0);
  expect((await draft(page)).lines.length).toBeGreaterThan(0);
  await stop(page).click();
  expect(qa.errors).toEqual([]);
});

test("invalid reset proposal payloads fail closed without a reset", async ({
  page,
}) => {
  const qa = await prepare(page);
  await page
    .getByRole("button", { name: "Start example order", exact: true })
    .click();
  const valid = await resetProposal(page);
  const invalid = [
    { ...valid, reset_token: "short" },
    { ...valid, cart_version: -1 },
    { ...valid, fence: 0.5 },
  ];
  for (let index = 0; index < invalid.length; index++) {
    await start(page).click();
    await listening(page);
    qa.send(invalid[index]);
    await expect(
      page.getByText(
        "Live speech data was invalid. Voice stopped. Please try again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(start(page)).toBeVisible();
    await expect
      .poll(() => tracks(page))
      .toEqual(Array(index + 1).fill("ended"));
    await expect(resetDialog(page)).toHaveCount(0);
  }
  expect((await draft(page)).lines.length).toBeGreaterThan(0);
  expect((await draft(page)).order).toBeFalsy();
  expect(qa.errors).toEqual([]);
});
