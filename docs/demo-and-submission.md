# Demo recording and submission copy

## Recorded local demo

A **2:36 (156.159-second), 1920×1080 demo** was recorded on October 14, 2026 from source commit `2d8b000`. The recording shows scripted phrases executing real MCP calls against an isolated in-memory DynamoDB Local instance and a local POS sandbox, with offline macOS Samantha narration. It made **zero provider calls**, used no physical microphone or speakers, and has **not been uploaded or published**.

The [preserved verification receipt](evidence/demo-recording-20261014.json) records the $18.09 corrected total, stable line IDs, customer review/confirmation, accepted kitchen ticket, next-customer isolation and staff takeover. It also records full video/audio decode, H.264/AAC, embedded English captions, reviewed frames and temporary-service cleanup. These are recording-time checks; the documentation update separately checked the local file's metadata and SHA-256, not the application flow.

The MP4 and companion narration, captions, poster and original receipt remain local under `output/playwright/saygo-demo-20261014/`; these artifacts are not tracked in Git and will not be present in a fresh clone. The portable receipt is included in `docs/evidence`. The video file is `SayGo-demo.mp4`, with SHA-256 `c7853a9ff0419e6693d0c129604d4925502039c8cc9450f73612976cd1c02a2a`.

The final evidence slide describes a separate [synthetic trial through real Sonic](evidence/live-voice-sonic-v4-i-20261014.json). That trial passed 16 checks; it is not live speech captured in this video. Physical acoustics, interruption reliability and independent spoken-price accuracy remain unverified.

## Recording outline (approximately 2 minutes 35 seconds)

This is the outline used to prepare the recording, not its exact edit timings. Preparation: local services running, menu available, POS mode Accept, admin signed in. Use fictional data only.

**0:00–0:15** — “This is SayGo: Say it. See it. Go. Harbor Burger is fictional. We're demonstrating our independent Alexa+ concept simulator, using a real MCP backend and a local POS sandbox.” Begin customer session.

**0:15–0:45** — Choose Start example order. Explain no-key fixture mode honestly: these predefined phrases execute actual MCP calls. Show two independent burger lines and medium lemonade. Choose Apply correction. Point to no onions/no cheese on only the intended burger, the same lemonade now large, and the $18.09 canonical total. Do not pretend this button demonstration is a live acoustic interruption.

**0:45–1:10** — Review order. “The exact quote is server-owned. The model cannot approve itself.” Show modifications, fixture tax and payment due at window. Click Confirm order. Briefly show pending, then accepted.

**1:10–1:35** — Open Kitchen. Show the same modifications and order number. Start preparing, then mark ready. “This is a durable sandbox acknowledgement, not a real restaurant connection.”

**1:35–1:55** — Vehicle departed; begin next customer. Empty new board, previous ticket remains in the kitchen.

**1:55–2:20** — Add an example order; ask staff; Crew → Take control. Show automation paused with the cart intact. Staff can send a message, edit, resolve and release. Alternatively show a stock-change invalidating a quote—do not cram both in.

**2:20–2:35** — “The Nova 2 Sonic adapter is implemented, but live speech is not part of this verified no-key recording. Native Alexa+ Food Ordering, real payments, commercial POS and intercom hardware are future validation.”

For a future physical-voice recording, first run the authorized microphone/speaker acceptance checks in [voice verification](voice.md), then label the resulting segment clearly. Keep fixture footage and the separate synthetic-provider evidence identifiable.

## Draft submission copy

**SayGo — Say it. See it. Go.**

SayGo is a conversational drive-through ordering assistant designed around a simple question: did the kitchen get the order the customer actually meant?

At fictional Harbor Burger, the order board stays visible while customers modify individual items, resize drinks and clarify ambiguous requests. A deterministic engine owns menu choices and integer-cent prices. A server-owned quote and authenticated customer confirmation separate conversation from consent. The model cannot approve its own order.

Our implemented path is an independent web simulator calling an authenticated Streamable HTTP MCP server, backed by DynamoDB, an atomic order/outbox transaction and a persistent local POS sandbox. Its eleven tools include read-only price comparisons and equivalent meal-savings proposals; applying a proposal requires separate customer acceptance. Unknown acceptance is reconciled using the original key, rather than creating a replacement order. Accepted tickets retain their exact modifications. Staff takeover preserves the cart and fences out late AI writes. A new vehicle gets a fresh session without erasing the preceding kitchen ticket.

The app includes a Nova 2 Sonic streaming adapter. One earlier synthetic-audio trial through real Sonic, browser capture and MCP passed 16 checks, including an in-place drink correction, exact cart prices and staff shutdown. The latest shared pricing-guidance changes have not been rerun through Sonic. The 2:36 recorded demo separately shows the no-key fixture workflow, which makes the ordering backend reproducible without cloud credentials. Physical microphone/speaker behavior, acoustic barge-in and broad speech reliability remain unverified.

The final [original Nova 2 Lite benchmark](evidence/live-model-evaluation-reasoning-low-8192-run-identity-original-20261014.json) and [additional-question suite](evidence/live-model-evaluation-reasoning-low-8192-run-identity-generalization-20261014.json) each passed 10/10 in complete runs on the same [preserved October 14 implementation](evidence/model-fix-source-manifest-20261014.json), before the contract 0.5 draft improvements. The fixed questions, expected answers and exact scorer were unchanged; earlier failed and partial results remain preserved. These bounded text results do not establish general model reliability or spoken-price accuracy. See the [verification receipt](evidence/model-fix-verification-20261014.json).

SayGo is an independent Alexa+ concept simulator. Native Alexa+ registration and Food Ordering Category SPI integration remain future work. Payment is due at the window and is outside this demo. No commercial restaurant/POS or intercom integration is claimed.

**Technology:** TypeScript, Next.js/React, Tailwind 3.4, official MCP SDK, Amazon Bedrock Runtime SDK, DynamoDB and DynamoDB Local, Zod, Vitest, Playwright, Docker Compose.

## Submission handoff

- **Prepared:** source through `118eef4` is the base for the October 20 publication preparation; the local captioned demo and portable verification receipt exist. The video and October 14 model results describe their recorded source checkpoints, before the later contract 0.5 draft improvements.
- **Still to review:** current competition rules, eligibility/team facts, the intended track and any partner requirements, repository visibility/access and license, and final claims. The [October 10 rules snapshot](integrations.md) is historical; this update does not establish entry eligibility or rule compliance.
- **Still to publish or submit:** upload the reviewed video, add the resulting link and any required access instructions, review the actual submission preview, and complete participant-controlled terms and final submission. No application hosting, video upload or entry submission was performed by this documentation update.
