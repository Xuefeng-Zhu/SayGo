"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackQueue } from "./playback";
import { ReadbackPlayback } from "./readback-playback";
export type ResetProposal = {
  reset_token: string;
  cart_version: number;
  session_id: string;
  epoch: number;
  fence: number;
};
export type SpokenConfirmationPhase =
  | "idle"
  | "ready"
  | "starting"
  | "recording"
  | "verifying";
type ReadbackIdentity = {
  readback_id: string;
  readback_hash: string;
  generation: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readbackIdentity(frame: Record<string, unknown>): ReadbackIdentity {
  if (
    typeof frame.readback_id !== "string" ||
    !uuid.test(frame.readback_id) ||
    typeof frame.readback_hash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(frame.readback_hash) ||
    typeof frame.generation !== "number" ||
    !Number.isSafeInteger(frame.generation) ||
    frame.generation < 0
  )
    throw new Error("Invalid spoken confirmation identity");
  return {
    readback_id: frame.readback_id,
    readback_hash: frame.readback_hash,
    generation: frame.generation,
  };
}
export function useVoice(
  sessionId: string | undefined,
  epoch: number | undefined,
  url: string,
  onCart: () => void,
  onReset?: (proposal: ResetProposal) => void,
  control?: { fence: number; enabled: boolean; cartVersion?: number },
) {
  const [status, setStatus] = useState("Microphone off"),
    [caption, setCaption] = useState(""),
    [pending, setPending] = useState(false),
    [active, setActive] = useState(false),
    [confirmationUnavailable, setConfirmationUnavailable] = useState(false),
    [spokenConfirmation, setSpokenConfirmation] =
      useState<SpokenConfirmationPhase>("idle");
  const cleanup = useRef<() => void>(() => {}),
    interruptPlayback = useRef<() => void>(() => {}),
    socket = useRef<WebSocket | null>(null),
    scope = useRef(0),
    onCartRef = useRef(onCart),
    onResetRef = useRef(onReset),
    invalidateReadback = useRef<() => void>(() => {}),
    beginConfirmation = useRef<() => void>(() => {}),
    finishConfirmation = useRef<() => void>(() => {}),
    disableSpokenConfirmation = useRef<() => void>(() => {}),
    currentControl = useRef(control),
    controlKey = useRef("");
  const key = `${sessionId}:${epoch}:${control?.fence}:${control?.enabled ?? true}`;
  controlKey.current = key;
  currentControl.current = control;
  onCartRef.current = onCart;
  onResetRef.current = onReset;
  const stop = useCallback(() => {
    scope.current++;
    cleanup.current();
    invalidateReadback.current();
    invalidateReadback.current = () => {};
    cleanup.current = () => {};
    interruptPlayback.current = () => {};
    beginConfirmation.current = () => {};
    finishConfirmation.current = () => {};
    disableSpokenConfirmation.current = () => {};
    socket.current = null;
    setActive(false);
    setPending(false);
    setCaption("");
    setConfirmationUnavailable(false);
    setSpokenConfirmation("idle");
    setStatus("Microphone off");
  }, []);
  useEffect(() => {
    stop();
    return stop;
  }, [key, stop]);
  useEffect(() => {
    invalidateReadback.current();
  }, [control?.cartVersion]);
  const start = async () => {
    stop();
    if (!sessionId || control?.enabled === false) return;
    const local = scope.current;
    const current = () => local === scope.current && key === controlKey.current;
    // Permission/startup must be cancellable, before a socket can open.
    setActive(true);
    setPending(true);
    setStatus("Requesting microphone permission…");
    let stream: MediaStream | undefined,
      context: AudioContext | undefined,
      ws: WebSocket | undefined,
      worklet: AudioWorkletNode | undefined;
    const readback = new ReadbackPlayback();
    const playback = new PlaybackQueue(
      () => context?.currentTime ?? 0,
      () => acknowledgeReadback(),
    );
    let ready = false,
      waitingForInterrupt: string | undefined,
      unsupportedConfirmation = false,
      forwardPcm = false,
      phase: SpokenConfirmationPhase = "idle",
      identity: ReadbackIdentity | undefined,
      captureId: string | undefined,
      captureRequested = false,
      confirmationExpiry: ReturnType<typeof setTimeout> | undefined,
      inputReset:
        | { id: string; enabled: boolean; after?: () => void }
        | undefined;
    const changePhase = (next: SpokenConfirmationPhase) => {
      phase = next;
      if (current()) setSpokenConfirmation(next);
    };
    // Port messages are ordered. A reset acknowledgement retires all earlier
    // PCM, while a sealing acknowledgement follows the final partial frame.
    const setInput = (enabled: boolean, after?: () => void, flush = false) => {
      if (!flush) forwardPcm = false;
      if (!worklet) return;
      const id = crypto.randomUUID();
      inputReset = { id, enabled, after };
      worklet.port.postMessage({
        type: "capture_state",
        enabled,
        request_id: id,
        flush,
      });
    };
    const clearConfirmation = (resume = true) => {
      clearTimeout(confirmationExpiry);
      confirmationExpiry = undefined;
      identity = undefined;
      captureId = undefined;
      changePhase("idle");
      // A readback can arrive while the customer is already speaking. Keep
      // ordinary PCM continuous; approval capture still performs explicit
      // resets before its request and after the server acknowledgement.
      if (
        !resume ||
        !forwardPcm ||
        inputReset ||
        !ready ||
        waitingForInterrupt ||
        captureRequested
      )
        setInput(resume && ready && !waitingForInterrupt && !captureRequested);
    };
    const cancelConfirmation = (expired = false) => {
      unsupportedConfirmation = true;
      readback.invalidate();
      clearConfirmation();
      setConfirmationUnavailable(true);
      setStatus(
        `Spoken confirmation ${expired ? "expired" : "cancelled"}. Continue ordering; stop and restart voice to confirm by voice, or confirm on screen.`,
      );
    };
    invalidateReadback.current = () => {
      readback.invalidate();
      clearConfirmation();
    };
    disableSpokenConfirmation.current = () => {
      unsupportedConfirmation = true;
      readback.invalidate();
      clearConfirmation();
      setConfirmationUnavailable(true);
      setStatus(
        "Typed input disables spoken confirmation. Stop voice and review the order again on screen.",
      );
    };
    const captureEnded = () => fail("Microphone disconnected. Voice stopped.");
    const acknowledgeReadback = () => {
      if (
        !current() ||
        !ready ||
        unsupportedConfirmation ||
        waitingForInterrupt ||
        currentControl.current?.enabled === false ||
        ws?.readyState !== WebSocket.OPEN
      )
        return;
      const receipt = readback.played({
        generation: playback.generation,
        queuedSources: playback.queuedSources,
        cartVersion: currentControl.current?.cartVersion,
        running: context?.state === "running",
        now: Date.now(),
      });
      if (!receipt) return;
      try {
        ws.send(JSON.stringify(receipt));
      } catch {
        fail("Live speech connection failed. Microphone stopped.");
      }
    };
    const release = () => {
      ready = false;
      forwardPcm = false;
      clearTimeout(confirmationExpiry);
      inputReset = undefined;
      readback.invalidate();
      playback.clear();
      if (worklet) {
        worklet.port.onmessage = null;
        worklet.disconnect();
        worklet.port.close();
        worklet = undefined;
      }
      stream?.getTracks().forEach((track) => {
        track.removeEventListener("ended", captureEnded);
        track.stop();
      });
      stream = undefined;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
        ws = undefined;
      }
      if (context) {
        const closing = context;
        context = undefined;
        if (closing.state !== "closed") void closing.close().catch(() => {});
      }
    };
    const fail = (message: string) => {
      if (!current()) {
        release();
        return;
      }
      stop();
      setStatus(message);
    };
    cleanup.current = release;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!current()) {
        release();
        return;
      }
      for (const track of stream.getTracks())
        track.addEventListener("ended", captureEnded);
      const audioContext = new AudioContext();
      context = audioContext;
      await audioContext.resume();
      if (!current()) return release();
      await audioContext.audioWorklet.addModule("/pcm-worklet.js");
      if (!current()) return release();
      const connection = new WebSocket(url);
      ws = connection;
      socket.current = connection;
      worklet = new AudioWorkletNode(audioContext, "saygo-pcm");
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(worklet);
      const silent = audioContext.createGain();
      silent.gain.value = 0;
      worklet.connect(silent).connect(audioContext.destination);
      worklet.port.onmessage = (e) => {
        if (!current() || !ready || connection.readyState !== WebSocket.OPEN)
          return;
        if (!(e.data instanceof ArrayBuffer)) {
          const message = e.data as Record<string, unknown>;
          if (
            message?.type === "capture_state" &&
            inputReset &&
            inputReset.id === message.request_id &&
            inputReset.enabled === message.enabled
          ) {
            const reset = inputReset;
            inputReset = undefined;
            forwardPcm = reset.enabled;
            reset.after?.();
          }
          return;
        }
        if (!forwardPcm) return;
        if (connection.bufferedAmount > 64000)
          return fail("Audio connection is too slow. Microphone stopped.");
        try {
          connection.send(e.data);
        } catch {
          fail("Live speech connection failed. Microphone stopped.");
        }
      };
      interruptPlayback.current = () => {
        if (!current() || !ready || connection.readyState !== WebSocket.OPEN)
          return;
        readback.invalidate();
        playback.clear();
        waitingForInterrupt = crypto.randomUUID();
        clearConfirmation(false);
        setCaption("");
        setStatus("Listening · response interrupted");
        try {
          connection.send(
            JSON.stringify({
              type: "interrupt",
              request_id: waitingForInterrupt,
            }),
          );
        } catch {
          fail("Live speech connection failed. Microphone stopped.");
        }
      };
      beginConfirmation.current = () => {
        if (
          !current() ||
          !ready ||
          unsupportedConfirmation ||
          waitingForInterrupt ||
          phase !== "ready" ||
          !identity ||
          connection.readyState !== WebSocket.OPEN
        )
          return;
        setInput(false);
        // The server may have opened this capture before its acknowledgement
        // arrives. Clearing local presentation state must never reopen ordinary
        // input for this connection after this irreversible boundary.
        captureRequested = true;
        changePhase("starting");
        setStatus("Preparing spoken confirmation…");
        try {
          connection.send(
            JSON.stringify({ type: "confirmation_capture_start", ...identity }),
          );
        } catch {
          fail("Live speech connection failed. Microphone stopped.");
        }
      };
      finishConfirmation.current = () => {
        if (
          !current() ||
          phase !== "recording" ||
          !captureId ||
          connection.readyState !== WebSocket.OPEN
        )
          return;
        const sealedId = captureId;
        clearTimeout(confirmationExpiry);
        changePhase("verifying");
        setStatus("Verifying spoken confirmation…");
        setPending(true);
        // Flush the final samples before the end marker. The button seals the
        // recording; only server-verified speech can authorize an order.
        setInput(
          false,
          () => {
            if (!current() || captureId !== sealedId || phase !== "verifying")
              return;
            try {
              connection.send(
                JSON.stringify({
                  type: "confirmation_capture_end",
                  capture_id: sealedId,
                }),
              );
            } catch {
              fail("Live speech connection failed. Microphone stopped.");
            }
          },
          true,
        );
      };
      connection.onopen = () => {
        if (!current()) return release();
        setStatus("Connecting to Nova…");
      };
      connection.onmessage = (e) => {
        if (!current()) return;
        try {
          const msg = JSON.parse(e.data) as Record<string, unknown>;
          if (!msg || typeof msg !== "object" || Array.isArray(msg))
            throw new Error("Invalid voice event");
          if (msg.session_id !== sessionId || msg.epoch !== epoch) return;
          if (
            typeof msg.fence === "number" &&
            Number.isSafeInteger(msg.fence) &&
            control &&
            msg.fence !== control.fence
          )
            return;
          if (msg.type === "ready") {
            ready = true;
            setInput(true);
            setPending(false);
            setStatus("Listening · AI-generated speech");
          }
          if (
            typeof msg.type === "string" &&
            msg.type.startsWith("confirmation_") &&
            (typeof msg.fence !== "number" ||
              !Number.isSafeInteger(msg.fence) ||
              msg.fence < 0)
          )
            throw new Error("Invalid confirmation scope");
          if (msg.type === "interrupt" || msg.type === "interrupt_ack") {
            if (
              typeof msg.generation !== "number" ||
              !Number.isSafeInteger(msg.generation) ||
              msg.generation < 0
            )
              throw new Error("Invalid audio generation");
            if (msg.type === "interrupt_ack") {
              if (typeof msg.request_id !== "string")
                throw new Error("Invalid interrupt acknowledgement");
              if (msg.request_id !== waitingForInterrupt) return;
              waitingForInterrupt = undefined;
            }
            if (msg.generation < playback.generation) return;
            readback.invalidate();
            clearConfirmation();
            playback.interrupt(msg.generation);
            setCaption("");
            setStatus("Listening · response interrupted");
          }
          if (msg.type === "caption") {
            if (typeof msg.text !== "string" || typeof msg.final !== "boolean")
              throw new Error("Invalid caption");
            if (msg.role === "USER") readback.invalidate();
            setCaption(
              `${msg.role === "USER" ? "You" : "SayGo"}${msg.final ? "" : " (provisional)"}: ${msg.text}`,
            );
          }
          if (msg.type === "pending") {
            if (typeof msg.pending !== "boolean")
              throw new Error("Invalid pending state");
            setPending(msg.pending);
          }
          if (msg.type === "cart_changed") onCartRef.current();
          if (msg.type === "confirmation_readback") {
            if (unsupportedConfirmation) return;
            clearConfirmation();
            setStatus("Listening · speak to change your order during readback");
            readback.begin(msg, playback.generation, Date.now());
            const next = readbackIdentity(msg);
            if (
              next.generation === playback.generation &&
              msg.cart_version === currentControl.current?.cartVersion &&
              typeof msg.expires_at === "string" &&
              Date.parse(msg.expires_at) > Date.now()
            )
              identity = next;
            onCartRef.current();
          }
          if (msg.type === "confirmation_readback_complete") {
            if (unsupportedConfirmation) return;
            readback.complete(msg);
            acknowledgeReadback();
          }
          if (msg.type === "confirmation_invalidated") {
            readback.invalidate();
            onCartRef.current();
            if (phase === "verifying")
              return fail(
                "Confirmation result was not verified. Check the order status before trying again.",
              );
            if (captureRequested)
              return fail(
                "Spoken confirmation was not accepted. Review the order again.",
              );
            cancelConfirmation(msg.reason === "CONFIRMATION_EXPIRED");
          }
          if (msg.type === "confirmation_ready") {
            if (unsupportedConfirmation) return;
            const next = readbackIdentity(msg);
            if (
              !identity ||
              next.readback_id !== identity.readback_id ||
              next.readback_hash !== identity.readback_hash ||
              next.generation !== identity.generation ||
              typeof msg.expires_at !== "string" ||
              !Number.isFinite(Date.parse(msg.expires_at)) ||
              Date.parse(msg.expires_at) <= Date.now()
            )
              throw new Error("Stale spoken confirmation window");
            setInput(false);
            changePhase("ready");
            setStatus("Microphone paused · ready for spoken confirmation");
            clearTimeout(confirmationExpiry);
            confirmationExpiry = setTimeout(
              () => {
                if (phase === "ready") cancelConfirmation(true);
                else
                  fail("Spoken confirmation expired. Review the order again.");
              },
              Date.parse(msg.expires_at) - Date.now(),
            );
            onCartRef.current();
          }
          if (msg.type === "confirmation_capture_started") {
            if (unsupportedConfirmation) return;
            const next = readbackIdentity(msg);
            if (
              phase !== "starting" ||
              !identity ||
              next.readback_id !== identity.readback_id ||
              next.readback_hash !== identity.readback_hash ||
              next.generation !== identity.generation ||
              typeof msg.capture_id !== "string" ||
              !uuid.test(msg.capture_id)
            )
              throw new Error("Invalid spoken confirmation capture");
            captureId = msg.capture_id;
            setInput(true, () => {
              if (!current() || phase !== "starting") return;
              changePhase("recording");
              setStatus(
                "Recording spoken confirmation · say the complete sentence",
              );
            });
          }
          if (msg.type === "confirmation_verifying") {
            if (msg.capture_id !== captureId || phase !== "verifying")
              throw new Error("Invalid spoken confirmation seal");
            setInput(false);
            setPending(true);
          }
          if (msg.type === "confirmation_committed") {
            clearConfirmation(false);
            setStatus("Order submitted · waiting for kitchen acceptance");
            onCartRef.current();
          }
          if (msg.type === "confirmation_unavailable") {
            unsupportedConfirmation = true;
            readback.invalidate();
            clearConfirmation();
            setConfirmationUnavailable(true);
            setStatus(
              "Voice confirmation isn’t available for this connection. Stop voice and confirm on screen.",
            );
            onCartRef.current();
          }
          if (msg.type === "reset_proposed") {
            readback.invalidate();
            clearConfirmation();
            if (
              typeof msg.reset_token !== "string" ||
              msg.reset_token.length < 20 ||
              msg.reset_token.length > 512 ||
              typeof msg.cart_version !== "number" ||
              !Number.isSafeInteger(msg.cart_version) ||
              msg.cart_version < 0 ||
              typeof msg.fence !== "number" ||
              !Number.isSafeInteger(msg.fence) ||
              msg.fence < 0
            )
              throw new Error("Invalid reset proposal");
            onResetRef.current?.({
              reset_token: msg.reset_token,
              cart_version: msg.cart_version,
              session_id: sessionId,
              epoch: epoch!,
              fence: msg.fence,
            });
          }
          if (msg.type === "error") {
            if (typeof msg.text !== "string") throw new Error("Invalid error");
            return fail(msg.text);
          }
          if (
            msg.type === "audio" &&
            !waitingForInterrupt &&
            msg.generation === playback.generation
          ) {
            if (typeof msg.audio !== "string") throw new Error("Invalid audio");
            const bytes = Uint8Array.from(atob(msg.audio), (c) =>
              c.charCodeAt(0),
            );
            if (!bytes.length || bytes.length % 2)
              throw new Error("Invalid PCM frame");
            const pcm = new DataView(bytes.buffer);
            const buffer = audioContext.createBuffer(
                1,
                bytes.length / 2,
                24000,
              ),
              channel = buffer.getChannelData(0);
            for (let i = 0; i < channel.length; i++)
              channel[i] = pcm.getInt16(i * 2, true) / 32768;
            try {
              const enqueued = playback.enqueue(
                msg.generation,
                buffer.duration,
                (time) => {
                  const node = audioContext.createBufferSource();
                  node.buffer = buffer;
                  node.connect(audioContext.destination);
                  node.start(time);
                  return node;
                },
              );
              if (enqueued) readback.audio(msg.generation as number);
            } catch {
              fail("Playback queue exceeded its limit. Voice stopped.");
            }
          }
        } catch {
          fail(
            "Live speech data was invalid. Voice stopped. Please try again.",
          );
        }
      };
      connection.onerror = () =>
        fail(
          "Live speech connection failed. Use the menu or choose fixture mode.",
        );
      connection.onclose = () => fail("Voice session ended. Microphone off.");
    } catch (e) {
      fail(`Microphone unavailable: ${(e as Error).message}`);
    }
  };
  return {
    start,
    stop,
    status,
    caption,
    pending,
    active,
    confirmationUnavailable,
    spokenConfirmation,
    beginSpokenConfirmation: () => beginConfirmation.current(),
    finishSpokenConfirmation: () => finishConfirmation.current(),
    text: (text: string) => {
      disableSpokenConfirmation.current();
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "text", text }));
    },
    interrupt: () => interruptPlayback.current(),
  };
}
