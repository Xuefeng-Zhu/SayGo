# Customer MCP call log

Open **MCP call log** on the customer order screen to inspect recent tool calls for that customer. The log stays collapsed by default. It shows the tool name, source (Voice, Screen, Test fixture or MCP client), pending/completed outcome, measured call duration when available, and short request/result summaries.

These entries wrap actual MCP invocations. Reading or expanding the log does not call an ordering tool. Finite demo fixtures still invoke MCP, but are explicitly labeled **Test fixture**; they are not live speech-model evidence. Local Undo and operator actions that do not invoke MCP are not fabricated as MCP entries.

Web gateway calls are measured from invocation to validated response. Other authenticated MCP clients are recorded at the server and show server execution time. Signed gateway metadata prevents the same call from being recorded twice; an arbitrary request header cannot suppress server logging. Discovery and connection handshakes do not create tool-call entries.

## Safety and privacy

- The authenticated customer cookie determines the session. The API accepts no caller-selected customer or log identifier.
- Only allowlisted operation categories, counts, prices and status descriptions are retained. Raw arguments, model prose, IDs, notes, authentication material and backend exceptions are excluded.
- A transport error appears as **Result not confirmed**. Check the current order before retrying an action; the log cannot establish whether an interrupted write committed.
- The log has no retry or submit controls. Review still requires explicit customer screen confirmation before a mock POS order is submitted. The current Nova adapter does not enable automatic voice submission.

## Lifetime and reconnects

The runtime keeps at most 30 calls per customer interaction, up to 100 interactions, for 15 minutes since the last invocation. This is an ephemeral diagnostic view, not a durable audit log. Runtime restart or eviction can clear it. Polling does not extend retention.

The browser fetches only while expanded, serializes polls, validates the response scope and replaces snapshots by stable call ID. Closing the log aborts its request. A new customer/epoch remounts and clears the log; departure clears server history and revokes the departed customer's access. Takeover retains that same customer's history without allowing new AI ordering actions.

## Local verification

Unit tests cover sanitization, pending/completion updates, uncertain failures, scope isolation, bounds, expiration and late completion after clearing. Integration tests use local HTTP MCP and an isolated DynamoDB Local database. Browser tests exercise the real finite fixture journey plus explicitly mocked log responses for transient states and reconnects. None require a microphone or a paid model provider.
