# Customer MCP call log

Open **MCP call log** on the customer order screen to inspect recent calls for that customer. The log starts collapsed. Each entry shows the tool name, source (Voice, Screen, Test fixture or MCP client), outcome, duration when available, and short request/result summaries.

Entries represent actual MCP calls. Opening the log sends no ordering commands. Scripted examples appear as **Test fixture** calls. Undo and operator actions appear only if they invoke MCP. Discovery and connection handshakes are excluded.

Web gateway durations run from invocation to validated response. Calls from other authenticated MCP clients show server execution time. Signed gateway metadata prevents duplicate entries; an arbitrary request header cannot suppress server logging.

## Safety and privacy

- The authenticated customer cookie selects the session. The API accepts no caller-selected customer or log identifier.
- Entries retain only allowlisted operation categories, counts, prices and status descriptions. They exclude raw arguments, model prose, IDs, notes, credentials and backend exceptions.
- A transport error appears as **Result not confirmed**. Check the order before retrying: an interrupted write may have committed.
- The log has no retry or submit controls. An order requires explicit customer screen approval before submission to the POS sandbox. The current Nova adapter cannot submit an order from speech.

## Lifetime and reconnects

The runtime retains at most 30 calls per interaction, across at most 100 interactions, for 15 minutes after the last invocation. Polling does not extend retention. A restart or eviction clears this temporary diagnostic history.

The browser polls only while the log is expanded, runs one request at a time, validates the response scope and replaces snapshots by stable call ID. Closing the log aborts its request. A new customer or epoch clears the browser log. Vehicle departure clears server history and revokes access. Staff takeover retains the same customer's history while blocking further AI ordering actions.

## Local verification

Unit tests cover sanitization, pending/completed states, uncertain failures, session isolation, retention limits, expiration and completion after clearing. Integration tests use HTTP MCP and an isolated DynamoDB Local database. Browser tests exercise the scripted ordering flow, with mocked log responses for transient states and reconnects. These tests require neither a microphone nor a paid model provider.
