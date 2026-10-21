"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackQueue } from "./playback";
export type ResetProposal = {
  reset_token: string;
  cart_version: number;
  session_id: string;
  epoch: number;
  fence: number;
};
export function useVoice(
  sessionId: string | undefined,
  epoch: number | undefined,
  url: string,
  onCart: () => void,
  onReset?: (proposal: ResetProposal) => void,
  control?: { fence: number; enabled: boolean },
) {
  const [status, setStatus] = useState("Microphone off"),
    [caption, setCaption] = useState(""),
    [pending, setPending] = useState(false),
    [active, setActive] = useState(false);
  const cleanup = useRef<() => void>(() => {}),
    interruptPlayback = useRef<() => void>(() => {}),
    socket = useRef<WebSocket | null>(null),
    scope = useRef(0),
    onCartRef = useRef(onCart),
    onResetRef = useRef(onReset),
    controlKey = useRef("");
  const key = `${sessionId}:${epoch}:${control?.fence}:${control?.enabled ?? true}`;
  controlKey.current = key;
  onCartRef.current = onCart;
  onResetRef.current = onReset;
  const stop = useCallback(() => {
    scope.current++;
    cleanup.current();
    cleanup.current = () => {};
    interruptPlayback.current = () => {};
    socket.current = null;
    setActive(false);
    setPending(false);
    setCaption("");
    setStatus("Microphone off");
  }, []);
  useEffect(() => {
    stop();
    return stop;
  }, [key, stop]);
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
    const playback = new PlaybackQueue(() => context?.currentTime ?? 0);
    let ready = false,
      waitingForInterrupt: string | undefined;
    const captureEnded = () => fail("Microphone disconnected. Voice stopped.");
    const release = () => {
      ready = false;
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
        playback.clear();
        waitingForInterrupt = crypto.randomUUID();
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
            setPending(false);
            setStatus("Listening · AI-generated speech");
          }
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
            playback.interrupt(msg.generation);
            setCaption("");
            setStatus("Listening · response interrupted");
          }
          if (msg.type === "caption") {
            if (typeof msg.text !== "string" || typeof msg.final !== "boolean")
              throw new Error("Invalid caption");
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
          if (msg.type === "reset_proposed") {
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
              playback.enqueue(msg.generation, buffer.duration, (time) => {
                const node = audioContext.createBufferSource();
                node.buffer = buffer;
                node.connect(audioContext.destination);
                node.start(time);
                return node;
              });
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
    text: (text: string) => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "text", text }));
    },
    interrupt: () => interruptPlayback.current(),
  };
}
