"use client";

import { useState } from "react";
import type { CustomerMcpLogEntry } from "@saygo/contracts";
import { useMcpCallLog } from "./use-mcp-call-log";
import styles from "./mcp-call-log.module.css";

const statusText: Record<CustomerMcpLogEntry["status"], string> = {
  pending: "Pending",
  succeeded: "Succeeded",
  failed: "Failed",
  unknown: "Result not confirmed",
};
const sourceText: Record<CustomerMcpLogEntry["source"], string> = {
  voice: "Voice",
  screen: "Screen",
  fixture: "Test fixture",
  mcp: "MCP client",
};

function duration(milliseconds: number) {
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(1)} s`
    : `${milliseconds} ms`;
}

function SessionMcpCallLog({
  sessionId,
  epoch,
}: {
  sessionId: string;
  epoch: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { entries, loading, error } = useMcpCallLog(sessionId, epoch, expanded);
  const pending = entries.filter((entry) => entry.status === "pending").length;
  const announcement = error
    ? error
    : loading && entries.length === 0
      ? "Loading MCP call history…"
      : entries.length
        ? `${entries.length} recent ${entries.length === 1 ? "call" : "calls"}${pending ? `, ${pending} pending` : ""}.`
        : "No MCP calls yet.";

  return (
    <details
      className={styles.log}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className={styles.summary}>
        <span>MCP call log</span>
        {entries.length > 0 && (
          <span className={styles.count} aria-hidden="true">
            {entries.length}
          </span>
        )}
      </summary>
      <div className={styles.body} aria-busy={loading && !entries.length}>
        <p className={styles.description}>
          Recent tool calls for this customer only. Test fixtures are labeled.
        </p>
        <p className={styles.announcement} role="status" aria-live="polite">
          {announcement}
        </p>
        {entries.length > 0 && (
          <ol
            className={styles.calls}
            aria-label="MCP calls, newest first"
            tabIndex={0}
          >
            {[...entries].reverse().map((entry) => (
              <li className={styles.call} key={entry.id}>
                <div className={styles.heading}>
                  <code className={styles.tool}>{entry.tool}</code>
                  <span className={`${styles.status} ${styles[entry.status]}`}>
                    {statusText[entry.status]}
                  </span>
                </div>
                <p className={styles.metadata}>
                  <span>{sourceText[entry.source]}</span>
                  {entry.duration_ms !== undefined && (
                    <span aria-label="Measured call duration">
                      {duration(entry.duration_ms)}
                    </span>
                  )}
                </p>
                <p className={styles.input}>
                  <span className={styles.term}>Request:</span>{" "}
                  {entry.input_summary}
                </p>
                {entry.result_summary && (
                  <p className={styles.result}>
                    <span className={styles.term}>Result:</span>{" "}
                    {entry.result_summary}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className={styles.retention}>
          Up to 30 recent calls. A new customer session clears this history.
        </p>
      </div>
    </details>
  );
}

export function McpCallLog(props: { sessionId: string; epoch: number }) {
  // Remount both disclosure and polling state before any new customer's data
  // can render. Nothing is written to browser storage.
  return (
    <SessionMcpCallLog key={`${props.sessionId}:${props.epoch}`} {...props} />
  );
}
