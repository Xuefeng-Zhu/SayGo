# Security and privacy

This is a loopback-bound, fictional demo—not a reviewed production deployment.

## Authority

- Staff passwords are salted scrypt hashes, provisioned by the idempotent seed. Signed HttpOnly, SameSite=Strict cookies expire after eight hours. Role/enabled status is checked against DynamoDB on each staff request. Admin, crew and kitchen permissions differ.
- Only admin/crew can start/depart lane interactions. Lane access is a random 256-bit opaque cookie with only its SHA-256 hash stored in the database. The lane ID is not a credential.
- Server-only MCP bearer credentials are HMAC-signed, short-lived and scoped to restaurant, lane, interaction, epoch, actor and ownership fence. Every request verifies the current interaction; a new customer revokes prior cookies and tokens. Model input cannot select another restaurant or lane.
- Customer approvals are separate from MCP. Voice “yes,” partial transcription, model booleans, stale quotes, unresolved choices, and staff-review states do not approve orders.
- Origin/Host checks, JSON limits (64 KiB), WebSocket payload/rate limits, mutation/login throttling, secure cookies under HTTPS, frame denial and no-store responses reduce common demo attack paths. The runtime is loopback-only. Origin is mandatory for cookie-authenticated POSTs. MCP requires a scoped bearer instead.
- Menu admin choices/prices are schema-validated. DynamoDB entity keys and expressions are created server-side. Environment and restaurant scope are fixed by trusted configuration. Bulk reset uses a maintenance fence and bounded transactions; menu/staff records are preserved.

## Shared-lane lifecycle

Each new vehicle has a fresh interaction ID and epoch. Prior interaction status becomes ended and its quotes are invalidated. The browser clears edit state, captions, audio sources and pending display generations. Requests using old scope fail. Staff takeover increments an independent fence; committed cart changes remain, but late AI writes fail. Voice checks scope during its lifetime and stops on ownership/session invalidation. Accepted order snapshots stay with the kitchen; they are not exposed to the next customer's scoped tool calls.

No voice biometrics, license plate, name, phone, payment card or loyalty identity is collected. Displayed staff messages are intentionally customer-facing, but detailed allergy concerns exist only in restricted handoff records—not agent/customer readback. Handoff concern handling is not certified medical/allergen processing.

## Retention and provider boundary

Raw microphone audio is streamed in memory and not written locally. Captions/tool argument buffers are in-memory and cleared at session end. Normal logs contain process/service status, not audio, credentials, utterances or concern contents. Audit rows record event kind/count/version only. Staff messages and handoff concerns are short-lived operational text, not a transcript archive.

Worker cleanup runs every minute: expire interactions; invalidate quotes; redact handoff concerns after one hour; revoke ended-session token hashes and staff messages after one hour; clear abandoned/ended draft content after 24 hours; remove audit/idempotency records after their 7-day/24-hour windows; redact completed/rejected order and old quote line snapshots after seven days. Unfulfilled orders are retained for staff resolution. Minimal entity records and POS idempotency receipts remain; this is explicit, not a claim of total erasure. The protected reset clears the dedicated fictional interaction/ticket dataset and preserves menu/staff settings. Backups and preserved legacy/local volumes have independent retention. The AWS table has deletion protection; automatic scaling and paid backup features are not configured.

When enabled, Nova receives microphone audio, tool results and the model conversation. Local deletion does not guarantee deletion or zero retention at AWS. Verify current provider terms/logging/region settings for the intended use before sending real data. No production/customer data was sent during this build.

## Before shared or production use

Replace default staff password and HMAC secret; use TLS and a proper kiosk provisioning/rotation model; add managed staff identity/session revocation, shared rate limiting, CSP and deployment hardening; review privacy/retention/backups, audit access, operational failure recovery, customer consent and commercial requirements. Production configuration refuses the default local credentials. Do not expose the default demo by port forwarding. Native Alexa+ conversation history/shared-device isolation cannot be asserted from this simulator's reset behavior.
