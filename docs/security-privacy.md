# Security and privacy

SayGo is a fictional demo that binds to loopback. It has not undergone a production security review.

## Authority

- Staff passwords are salted scrypt hashes, provisioned by the idempotent seed. Signed HttpOnly, SameSite=Strict cookies expire after eight hours. Role/enabled status is checked against DynamoDB on each staff request. Admin, crew and kitchen permissions differ.
- Only admin/crew can start/depart lane interactions. Lane access is a random 256-bit opaque cookie with only its SHA-256 hash stored in the database. The lane ID is not a credential.
- Server-only MCP bearer credentials are HMAC-signed, short-lived and scoped to restaurant, lane, interaction, epoch, actor and ownership fence. Every request verifies the current interaction; a new customer revokes prior cookies and tokens. Model input cannot select another restaurant or lane.
- Customer approval is recorded outside MCP through the screen route. [Spoken approval remains disabled on the current Nova adapter](voice-confirmation.md). A spoken or typed affirmation, partial transcript or model-supplied flag cannot approve an order. Stale quotes, unresolved choices and pending staff review block approval.
- Origin/Host checks, JSON limits (64 KiB), WebSocket payload/rate limits, mutation/login throttling, secure cookies under HTTPS, frame denial and no-store responses reduce common demo attack paths. The runtime is loopback-only. Origin is mandatory for cookie-authenticated POSTs. MCP requires a scoped bearer instead.
- Menu admin choices/prices are schema-validated. DynamoDB entity keys and expressions are created server-side. Environment and restaurant scope are fixed by trusted configuration. Bulk reset uses a maintenance fence and bounded transactions; menu/staff records are preserved.

## Shared-lane lifecycle

Each new vehicle has a fresh interaction ID and epoch. Prior interaction status becomes ended and its quotes are invalidated. The browser clears edit state, captions, audio sources and pending display generations. Requests using old scope fail. Staff takeover increments an independent fence; committed cart changes remain, but late AI writes fail. Voice checks scope during its lifetime and stops on ownership/session invalidation. Accepted order snapshots stay with the kitchen; they are not exposed to the next customer's scoped tool calls.

The app collects no voice biometrics, license plate, name, phone, payment card or loyalty identity. Staff messages are customer-facing. Detailed allergy concerns stay in restricted handoff records and are excluded from agent/customer readback. The demo provides no certified allergen-safety process.

## Retention and provider boundary

The runtime streams raw microphone audio in memory without writing it locally. Captions and tool-argument buffers are cleared at session end. Logs contain process/service status; audit rows contain event kinds, counts, versions and relevant record IDs. Neither stores raw audio, credentials, utterances or concern contents. Staff messages and handoff concerns have separate retention periods below.

The opt-in synthetic voice QA harness has a separate evidence policy: synthetic input, provider-response WAV and private tool traces are saved in ignored owner-only `.local/voice-qa/` directories. Sanitized reports in `docs/evidence` include synthetic test captions and usage; they contain no physical microphone recording. See [voice verification](voice.md). These QA artifacts are not subject to the runtime worker's retention sweep.

Worker cleanup runs every minute. It expires interactions and invalidates quotes, then applies these retention periods:

| Data                                          | Cleanup                                                     |
| --------------------------------------------- | ----------------------------------------------------------- |
| Handoff concerns                              | Redacted one hour after handoff creation.                   |
| Ended-session token hashes and staff messages | Revoked/removed once the session is ended and one hour old. |
| Ended draft content                           | Cleared once the session is ended and 24 hours old.         |
| Audit records                                 | Removed after seven days.                                   |
| Idempotency records                           | Removed after 24 hours.                                     |
| Handed-off/rejected order line snapshots      | Redacted seven days after order creation.                   |
| Expired quote line snapshots                  | Redacted seven days after expiry.                           |

Unfulfilled orders stay available for staff resolution. Minimal entity records and POS idempotency receipts remain. Demo reset clears fictional interactions/tickets and preserves menu/staff settings. Backups and local database files have independent retention. The [recorded AWS setup](dynamodb.md) used deletion protection without autoscaling or paid backup features.

When enabled, Nova receives microphone audio, tool results and the model conversation. Local deletion does not guarantee deletion or zero retention at AWS. Verify current provider terms/logging/region settings for the intended use before sending real data. No production/customer data was sent during this build.

## Before shared or production use

Replace default staff password and HMAC secret; use TLS and a proper kiosk provisioning/rotation model; add managed staff identity/session revocation, shared rate limiting, CSP and deployment hardening; review privacy/retention/backups, audit access, operational failure recovery, customer consent and commercial requirements. Production configuration refuses the default local credentials. Do not expose the default demo by port forwarding. Native Alexa+ conversation history/shared-device isolation cannot be asserted from this simulator's reset behavior.
