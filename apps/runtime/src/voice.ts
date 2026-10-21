import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "@saygo/db";
import { scopeForToken, getView, voiceLease } from "@saygo/domain";
import { openMcp } from "@saygo/integrations";
import { NovaSession } from "../../../packages/integrations/src/nova.js";
import type { VoiceSessionOptions } from "../../../packages/integrations/src/nova.js";
import { agentToken, cookie } from "./auth.js";
const active = new Map<string, () => Promise<void>>();
export async function stopVoice(sessionId: string) {
  await active.get(sessionId)?.();
}
export function attachVoice(
  server: Server,
  testing: VoiceSessionOptions & {
    maximumSessionMs?: number;
    onEvent?: (event: Record<string, unknown>) => void;
    onEnd?: () => void;
  } = {},
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/voice" ||
      ![
        `localhost:${config.SAYGO_RUNTIME_PORT}`,
        `127.0.0.1:${config.SAYGO_RUNTIME_PORT}`,
      ].includes(req.headers.host ?? "") ||
      req.headers.origin !== config.SAYGO_WEB_ORIGIN ||
      config.SAYGO_VOICE_ENABLED !== "true"
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    void scopeForToken(cookie(req, "saygo_lane"))
      .then(async (scope) => {
        const view = await getView({ ...scope, actor: "agent" });
        if (view.session.needs_staff_review) throw new Error("Staff review");
        wss.handleUpgrade(req, socket, head, (ws) => {
          if (active.has(scope.session_id)) {
            ws.close(1008, "One voice connection per customer");
            return;
          }
          let nova: NovaSession | undefined;
          let mcp: Awaited<ReturnType<typeof openMcp>> | undefined;
          let ended = false;
          let stopping: Promise<void> | undefined;
          let initializing: Promise<void> = Promise.resolve();
          let renewing: Promise<void> = Promise.resolve();
          let renewLease = true;
          let renewalPending = false;
          const cleanup = async (action: () => unknown | Promise<unknown>) => {
            try {
              await action();
            } catch {
              console.error("SayGo voice cleanup encountered a service error.");
            }
          };
          const send = (event: object) => {
            testing.onEvent?.(event as Record<string, unknown>);
            if (ws.readyState === WebSocket.OPEN) {
              if (ws.bufferedAmount > 256000) {
                void stop();
                return;
              }
              ws.send(
                JSON.stringify({
                  ...event,
                  session_id: scope.session_id,
                  epoch: scope.epoch,
                }),
              );
            }
          };
          const stop = () => {
            if (stopping) return stopping;
            ended = true;
            clearTimeout(limit);
            // Memoize before closing: socket callbacks can reenter stop().
            stopping = Promise.resolve().then(async () => {
              try {
                await cleanup(() => nova?.close());
                await cleanup(() => ws.close(1000, "Voice session ended"));
                // Late acquisition belongs to this connection until cleanup
                // finishes; it must not outlive the active registration.
                await cleanup(() => initializing);
                await cleanup(() => nova?.drain());
              } finally {
                // Keep renewing while dispatched tools drain so consent stays
                // blocked even if a tool takes longer than the lease lifetime.
                renewLease = false;
                clearInterval(guard);
                await cleanup(() => renewing);
                await cleanup(() => mcp?.close());
                await cleanup(() => voiceLease(scope.session_id, null));
                if (active.get(scope.session_id) === stop)
                  active.delete(scope.session_id);
                await cleanup(() => testing.onEnd?.());
              }
            });
            return stopping;
          };
          const guard = setInterval(() => {
            if (!renewLease || renewalPending) return;
            renewalPending = true;
            renewing = (async () => {
              if (!renewLease) return;
              if (!ended) await getView({ ...scope, actor: "agent" });
              if (!renewLease) return;
              await voiceLease(
                scope.session_id,
                new Date(Date.now() + 20000).toISOString(),
              );
            })()
              .catch(() => void stop())
              .finally(() => {
                renewalPending = false;
              });
          }, 500);
          const limit = setTimeout(
            stop,
            Math.min(testing.maximumSessionMs ?? 7 * 60000, 7 * 60000),
          );
          active.set(scope.session_id, stop);
          let windowStart = Date.now(),
            bytes = 0;
          ws.on("message", (data, binary) => {
            if (!nova || ended) return;
            try {
              if (Date.now() - windowStart > 1000) {
                windowStart = Date.now();
                bytes = 0;
              }
              bytes += Buffer.byteLength(data as Buffer);
              if (bytes > 80000) throw new Error("Audio rate limit");
              if (binary) nova.audio(Buffer.from(data as Buffer));
              else {
                const msg = JSON.parse(data.toString());
                if (msg.type === "stop") void stop();
                else if (msg.type === "interrupt") {
                  const generation = nova.interrupt();
                  if (
                    typeof msg.request_id === "string" &&
                    msg.request_id.length > 0 &&
                    msg.request_id.length <= 64
                  )
                    send({
                      type: "interrupt_ack",
                      request_id: msg.request_id,
                      generation,
                    });
                } else if (msg.type === "text" && typeof msg.text === "string")
                  nova.userText(msg.text);
              }
            } catch {
              send({
                type: "error",
                text: "Invalid or overloaded voice stream. Use the menu fallback.",
              });
              void stop();
            }
          });
          ws.on("close", stop);
          ws.on("error", stop);
          initializing = (async () => {
            await voiceLease(
              scope.session_id,
              new Date(Date.now() + 20000).toISOString(),
            );
            if (ended) return;
            mcp = await openMcp(agentToken(scope));
            if (ended) return;
            nova = new NovaSession(mcp, send, {
              ...testing,
              onTool: (name, args, result) => {
                // Only the authoritative tool result can propose a reset. The
                // model cannot provide customer consent or its own token.
                if (
                  !ended &&
                  name === "cancel_draft_order" &&
                  !result.error &&
                  typeof result.reset_token === "string" &&
                  result.reset_token.length >= 20 &&
                  result.reset_token.length <= 512 &&
                  typeof result.cart_version === "number" &&
                  Number.isSafeInteger(result.cart_version) &&
                  result.cart_version >= 0
                )
                  send({
                    type: "reset_proposed",
                    reset_token: result.reset_token,
                    cart_version: result.cart_version,
                    fence: scope.fence,
                  });
                testing.onTool?.(name, args, result);
              },
            });
            void nova.start().then(stop, unavailable);
          })();
          function unavailable() {
            if (ended) return;
            send({
              type: "error",
              text: "Live Nova speech is unavailable. Check server-side AWS credentials, model access and region. Fixture mode has NOT been started.",
            });
            void stop();
          }
          void initializing.catch(unavailable);
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  });
  return wss;
}
