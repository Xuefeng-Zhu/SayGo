"use client";

import { useEffect, useState } from "react";
import {
  customerMcpLogSchema,
  type CustomerMcpLogEntry,
} from "@saygo/contracts";

const HISTORY_LIMIT = 30;

/** A snapshot replaces the previous one; reconnects never append duplicate calls. */
export function uniqueMcpCalls(entries: CustomerMcpLogEntry[]) {
  const byId = new Map<string, CustomerMcpLogEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  return [...byId.values()].slice(-HISTORY_LIMIT);
}

type State = {
  entries: CustomerMcpLogEntry[];
  loading: boolean;
  error: string;
};

export function useMcpCallLog(
  sessionId: string,
  epoch: number,
  enabled: boolean,
) {
  const [state, setState] = useState<State>({
    entries: [],
    loading: false,
    error: "",
  });

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    setState((previous) => ({ ...previous, loading: true }));

    const poll = async () => {
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 8000);
      let clearHistory = false;
      try {
        const response = await fetch("/api/lane/mcp-log", {
          credentials: "same-origin",
          cache: "no-store",
          signal: request.signal,
        });
        if (disposed) return;
        if (!response.ok) {
          clearHistory = response.status === 401 || response.status === 403;
          throw new Error("Call history unavailable");
        }
        const snapshot = customerMcpLogSchema.parse(await response.json());
        if (disposed) return;
        if (snapshot.session_id !== sessionId || snapshot.epoch !== epoch) {
          clearHistory = true;
          throw new Error("Call history scope changed");
        }
        setState({
          entries: uniqueMcpCalls(snapshot.entries),
          loading: false,
          error: "",
        });
      } catch {
        if (!disposed)
          setState((previous) => ({
            entries: clearHistory ? [] : previous.entries,
            loading: false,
            error: "Call history is temporarily unavailable. Reconnecting…",
          }));
      } finally {
        clearTimeout(timeout);
        // Schedule after completion, so a slow or reconnecting request cannot
        // overlap another poll or overwrite a newer snapshot.
        if (!disposed) next = setTimeout(() => void poll(), 1000);
      }
    };

    void poll();
    return () => {
      disposed = true;
      clearTimeout(next);
      request?.abort();
    };
  }, [sessionId, epoch, enabled]);

  return state;
}
