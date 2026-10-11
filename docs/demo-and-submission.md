# Demo script (target: 2 minutes 35 seconds)

Preparation: local services running, menu available, POS mode Accept, admin signed in. Use fictional data only. This is a script, not a claim that a demo video was recorded.

**0:00–0:15** — “This is SayGo: Say it. See it. Go. Harbor Burger is fictional. We're demonstrating our independent Alexa+ concept simulator, using a real MCP backend and a local POS sandbox.” Begin customer session.

**0:15–0:45** — Choose Start example order. Explain no-key fixture mode honestly: these predefined phrases execute actual MCP calls. Show two independent burger lines and medium lemonade. Choose Apply correction. Point to no onions/no cheese on only the intended burger, the same lemonade now large, and the $18.09 canonical total. Do not pretend this button demonstration is a live acoustic interruption.

**0:45–1:10** — Review order. “The exact quote is server-owned. The model cannot approve itself.” Show modifications, fixture tax and payment due at window. Click Confirm order. Briefly show pending, then accepted.

**1:10–1:35** — Open Kitchen. Show the same modifications and order number. Start preparing, then mark ready. “This is a durable sandbox acknowledgement, not a real restaurant connection.”

**1:35–1:55** — Vehicle departed; begin next customer. Empty new board, previous ticket remains in the kitchen.

**1:55–2:20** — Add an example order; ask staff; Crew → Take control. Show automation paused with the cart intact. Staff can send a message, edit, resolve and release. Alternatively show a stock-change invalidating a quote—do not cram both in.

**2:20–2:35** — “The Nova 2 Sonic adapter is implemented, but live speech is not part of this verified no-key recording. Native Alexa+ Food Ordering, real payments, commercial POS and intercom hardware are future validation.”

If a later authorized live-voice trial passes, record a separate clearly identified live segment using the same primary correction story. Never splice fixture speech into a claimed live response.

## Draft submission copy

**SayGo — Say it. See it. Go.**

SayGo is a conversational drive-through ordering assistant designed around a simple question: did the kitchen get the order the customer actually meant?

At fictional Harbor Burger, the order board stays visible while customers modify individual items, resize drinks and clarify ambiguous requests. A deterministic engine owns menu choices and integer-cent prices. A server-owned quote and authenticated customer confirmation separate conversation from consent. The model cannot approve its own order.

Our implemented path is an independent web simulator calling an authenticated Streamable HTTP MCP server, backed by PostgreSQL, a transactional outbox and a persistent local POS sandbox. Unknown acceptance is reconciled using the original key, rather than creating a replacement order. Accepted tickets retain their exact modifications. Staff takeover preserves the cart and fences out late AI writes. A new vehicle gets a fresh session without erasing the preceding kitchen ticket.

The app includes a real Nova 2 Sonic streaming adapter, while the verified no-key fixture workflow makes the ordering backend reproducible without cloud credentials. Live microphone/provider accuracy and native Alexa+ integration remain unverified. The public Food Ordering Category SPI is documented as a future adapter path, not claimed as completed registration. Payment is due at the window and is outside this demo.

**Technology:** TypeScript, Next.js/React, Tailwind 3.4, official MCP SDK, Amazon Bedrock Runtime SDK, PostgreSQL, Drizzle, Zod, Vitest, Playwright, Docker Compose.

**Submission gates still owned by the participant:** eligibility/team facts, repository publication/license/access decision, a recorded under-three-minute demo, final claims review against evidence, native/partner requirements if pursued, and final submission/terms acceptance. No submission or publication was performed automatically.
