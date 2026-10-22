import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "@saygo/db";
import { scopeForToken, getView, voiceLease } from "@saygo/domain";
import { openMcp } from "@saygo/integrations";
import { NovaSession } from "../../../packages/integrations/src/nova.js";
import type { VoiceSessionOptions } from "../../../packages/integrations/src/nova.js";
import { agentToken, cookie } from "./auth.js";
import {
  CURRENT_NOVA_VOICE_CONFIRMATION_SUPPORTED,
  VoiceConfirmationCoordinator,
} from "./voice-confirmation.js";
const active = new Map<string, { fence: number; stop: () => Promise<void> }>();
// A takeover can finish while a previously authorized upgrade is still waiting
// for its state read. Remember the invalidated generation so it cannot register
// after stopVoice has returned. Sessions themselves expire after fifteen minutes.
const invalidated = new Map<string, { before: number; until: number }>();
export async function stopVoice(sessionId: string, beforeFence?: number) {
  if (beforeFence !== undefined) {
    const now = Date.now();
    for (const [id, entry] of invalidated)
      if (entry.until <= now) invalidated.delete(id);
    const previous = invalidated.get(sessionId)?.before ?? 0;
    invalidated.set(sessionId, {
      before: Math.max(previous, beforeFence),
      until: now + 16 * 60000,
    });
  }
  const connection = active.get(sessionId);
  if (
    connection &&
    (beforeFence === undefined || connection.fence < beforeFence)
  )
    await connection.stop();
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
          const blocked = invalidated.get(scope.session_id);
          if (
            blocked &&
            blocked.until > Date.now() &&
            scope.fence < blocked.before
          ) {
            ws.close(1008, "Control changed. Start a new voice session.");
            return;
          }
          if (active.has(scope.session_id)) {
            ws.close(1008, "One voice connection per customer");
            return;
          }
          let nova: NovaSession | undefined;
          const connectionId = randomUUID();
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
            if (ended) return;
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
                  fence: scope.fence,
                }),
              );
            }
          };
          const confirmation = new VoiceConfirmationCoordinator({
            scope,
            connectionId,
            // Current provider cannot certify whole customer turns. No testing,
            // model, browser or environment option may override this capability.
            certifiedWholeUserTurns: CURRENT_NOVA_VOICE_CONFIRMATION_SUPPORTED,
            send,
          });
          const stop = () => {
            if (stopping) return stopping;
            ended = true;
            const confirmationStopped = confirmation.disconnect();
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
                await cleanup(() => confirmationStopped);
                await cleanup(() => confirmation.drain());
              } finally {
                // Keep renewing while dispatched tools drain so consent stays
                // blocked even if a tool takes longer than the lease lifetime.
                renewLease = false;
                clearInterval(guard);
                await cleanup(() => renewing);
                await cleanup(() => mcp?.close());
                await cleanup(() =>
                  voiceLease(scope.session_id, null, connectionId),
                );
                if (active.get(scope.session_id)?.stop === stop)
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
              if (!ended)
                confirmation.observeView(
                  await getView({ ...scope, actor: "agent" }),
                );
              if (!renewLease) return;
              await voiceLease(
                scope.session_id,
                new Date(Date.now() + 20000).toISOString(),
                connectionId,
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
          active.set(scope.session_id, { fence: scope.fence, stop });
          confirmation.announceCapability();
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
                  void confirmation.interrupt(generation);
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
                } else if (msg.type === "readback_played") {
                  void confirmation.playbackAck(msg).catch(() => void stop());
                } else if (
                  msg.type === "text" &&
                  typeof msg.text === "string"
                ) {
                  void confirmation.typedInput();
                  nova.userText(msg.text);
                }
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
              connectionId,
            );
            if (ended) return;
            // Ownership can change during a slow initial lease/MCP acquisition.
            await getView({ ...scope, actor: "agent" });
            if (ended) return;
            mcp = await openMcp(agentToken(scope));
            if (ended) return;
            await getView({ ...scope, actor: "agent" });
            if (ended) return;
            nova = new NovaSession(mcp, send, {
              ...testing,
              onProviderEvidence: (event) => {
                if (!ended) confirmation.observeProvider(event);
                testing.onProviderEvidence?.(event);
              },
              transformToolResult: async (name, args, result) => {
                const authoritative = await confirmation.transformToolResult(
                  name,
                  args,
                  result,
                );
                return testing.transformToolResult
                  ? testing.transformToolResult(name, args, authoritative)
                  : authoritative;
              },
              onTool: (name, args, result) => {
                if (!ended) confirmation.observeView(result);
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
                if (!ended && name === "request_staff_help" && !result.error)
                  void stopVoice(scope.session_id, scope.fence + 1);
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
