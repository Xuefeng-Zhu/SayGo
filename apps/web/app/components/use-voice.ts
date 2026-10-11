"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackQueue } from "./playback";
export function useVoice(
  sessionId: string | undefined,
  epoch: number | undefined,
  url: string,
  onCart: () => void,
) {
  const [status, setStatus] = useState("Microphone off"),
    [caption, setCaption] = useState(""),
    [pending, setPending] = useState(false),
    [active, setActive] = useState(false);
  const cleanup = useRef<() => void>(() => {}),
    socket = useRef<WebSocket | null>(null),
    scope = useRef(0),
    onCartRef = useRef(onCart);
  onCartRef.current = onCart;
  const stop = useCallback(() => {
    scope.current++;
    cleanup.current();
    cleanup.current = () => {};
    socket.current = null;
    setActive(false);
    setPending(false);
    setCaption("");
    setStatus("Microphone off");
  }, []);
  useEffect(() => {
    stop();
    return stop;
  }, [sessionId, epoch, stop]);
  const start = async () => {
    stop();
    if (!sessionId) return;
    const local = scope.current;
    setStatus("Requesting microphone permission…");
    let stream: MediaStream | undefined,
      context: AudioContext | undefined,
      ws: WebSocket | undefined,
      worklet: AudioWorkletNode | undefined;
    const playback = new PlaybackQueue(() => context?.currentTime ?? 0);
    let ready = false;
    const release = () => {
      playback.clear();
      worklet?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      ws?.close();
      if (context && context.state !== "closed") void context.close();
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
      if (local !== scope.current) {
        release();
        return;
      }
      context = new AudioContext();
      await context.resume();
      await context.audioWorklet.addModule("/pcm-worklet.js");
      if (local !== scope.current) {
        release();
        return;
      }
      ws = new WebSocket(url);
      socket.current = ws;
      worklet = new AudioWorkletNode(context, "saygo-pcm");
      const source = context.createMediaStreamSource(stream);
      source.connect(worklet);
      const silent = context.createGain();
      silent.gain.value = 0;
      worklet.connect(silent).connect(context.destination);
      worklet.port.onmessage = (e) => {
        if (
          local !== scope.current ||
          !ready ||
          ws?.readyState !== WebSocket.OPEN
        )
          return;
        if (ws.bufferedAmount > 64000) {
          setStatus("Audio connection is too slow. Microphone stopped.");
          release();
          setActive(false);
          return;
        }
        ws.send(e.data);
      };
      ws.onopen = () => {
        setActive(true);
        setStatus("Connecting to Nova…");
      };
      ws.onmessage = (e) => {
        if (local !== scope.current) return;
        const msg = JSON.parse(e.data);
        if (msg.session_id !== sessionId || msg.epoch !== epoch) return;
        if (msg.type === "ready") {
          ready = true;
          setStatus("Listening · AI-generated speech");
        }
        if (msg.type === "interrupt") {
          playback.interrupt(msg.generation);
          setCaption("");
          setStatus("Listening · response interrupted");
        }
        if (msg.type === "caption")
          setCaption(
            `${msg.role === "USER" ? "You" : "SayGo"}${msg.final ? "" : " (provisional)"}: ${msg.text}`,
          );
        if (msg.type === "pending") setPending(msg.pending);
        if (msg.type === "cart_changed") onCartRef.current();
        if (msg.type === "error") {
          setStatus(msg.text);
          release();
          setActive(false);
        }
        if (
          msg.type === "audio" &&
          msg.generation === playback.generation &&
          context
        ) {
          const bytes = Uint8Array.from(atob(msg.audio), (c: string) =>
            c.charCodeAt(0),
          );
          const pcm = new DataView(bytes.buffer);
          const buffer = context.createBuffer(1, bytes.length / 2, 24000),
            channel = buffer.getChannelData(0);
          for (let i = 0; i < channel.length; i++)
            channel[i] = pcm.getInt16(i * 2, true) / 32768;
          try {
            playback.enqueue(msg.generation, buffer.duration, (time) => {
              const node = context!.createBufferSource();
              node.buffer = buffer;
              node.connect(context!.destination);
              node.start(time);
              return node;
            });
          } catch {
            setStatus("Playback queue exceeded its limit. Voice stopped.");
            release();
            setActive(false);
            return;
          }
        }
      };
      ws.onerror = () => {
        setStatus(
          "Live speech connection failed. Use the menu or choose fixture mode.",
        );
        release();
        setActive(false);
      };
      ws.onclose = () => {
        if (local !== scope.current) return;
        ready = false;
        release();
        setActive(false);
        setPending(false);
        setStatus((current) =>
          current.startsWith("Listening") || current.startsWith("Connecting")
            ? "Voice session ended. Microphone off."
            : current,
        );
      };
    } catch (e) {
      release();
      setActive(false);
      setStatus(`Microphone unavailable: ${(e as Error).message}`);
    }
  };
  return {
    start,
    stop,
    status,
    caption,
    pending,
    active,
    text: (text: string) =>
      socket.current?.send(JSON.stringify({ type: "text", text })),
    interrupt: () =>
      socket.current?.send(JSON.stringify({ type: "interrupt" })),
  };
}
