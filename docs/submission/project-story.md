# SayGo

**Say it. See it. Go.**

## One-line summary

A drive-through ordering assistant that lets customers speak, see each change, and confirm the order before it reaches the kitchen.

## Inspiration / Problem

A drive-through order can change midway through a conversation. Two burgers become one. A drink changes size. “No onions” needs to stay with the right burger.

SayGo focuses on what happens between those requests and the kitchen ticket. The customer should be able to see what the assistant understood, correct it, and approve the result.

## What it does / Solution

At fictional Harbor Burger, customers add items, change quantities and modifiers, and watch the order board update.

The screen shows the actual cart and a server-generated quote. Voice stops before the customer taps **Confirm order**. A spoken “yes” cannot place the order. An accepted test order then appears on the kitchen display.

Staff can take over without losing the draft. Uncertain POS responses stay visibly unresolved until reconciled.

## Why this matters

Customers can check a misunderstanding before approving it. Staff receive the same structured selections. This is a prototype of that interaction, with no restaurant deployment or measured error-reduction claim.

## How we built it / Architecture

Next.js, React, TypeScript and Tailwind CSS provide the customer and staff screens. Audio streams through the Node server to Amazon Bedrock's Nova 2 Sonic model; credentials stay server-side.

The model reads the menu and edits the draft through Streamable HTTP MCP tools. Zod schemas and a deterministic engine validate items, modifiers and integer-cent prices. Cart versions protect newer changes.

DynamoDB stores the draft, quote, approval, order and delivery job. A worker delivers the confirmed order to the local POS sandbox using a stable request key.

This is an independent **Alexa+ concept simulation in a browser**. It is not a registered Alexa+ integration or a Fire TV application.

## Challenges

Speech and cart writes finish asynchronously. A delayed startup failure could hide the controls for a newer voice session. Session ownership checks and cleanup now handle that race. The gateway also owns retry IDs rather than trusting model-generated ones.

In the recording, the cart showed large although the customer clip was scripted to ask for medium. Another spoken clarification restored medium before confirmation. That recovery is left visible; the acoustic cause is unresolved.

## Accomplishments

The recorded flow reaches one accepted **$9.72** sandbox order: a classic burger without onions and a medium lemonade without ice. Its 21 checks include screen consent and matching order/receipt state.

The October 21 selected source passed 145 unit tests, lint, root/web types, a webpack web build and runtime/worker builds. The new prompt has deterministic coverage; shorter spoken replies remain unverified.

## What we learned

Voice tests need to inspect the cart, approval and receipt as well as the transcript. Reply style also depends on consistent instructions: the prompt's conflicting demand for totals after every edit has been removed locally. That change still needs a fresh live run.

## What's next

Verify the shorter replies with fresh Nova audio. Then test with human speech, background noise and intercom hardware. Broader menu testing, a commercial POS adapter and a native Alexa+ integration are later steps.

## How we used AI and Codex

Nova 2 Sonic handles speech and tools; Nova 2 Lite was used for separate menu/pricing evaluations. Polly Generative Matthew supplies prerecorded customer speech and narration. The demo's Nova Tiffany replies were generated live.

Codex assisted source inspection, lifecycle fixes, tests and demo preparation. Executable checks and source fingerprints were used to verify the work.

## Built with

Amazon Bedrock/Nova; DynamoDB/Local; Polly; AWS SDK/CLI; MCP TypeScript SDK; Zod; Node.js/Express/WebSocket; TypeScript; Next.js/React/Tailwind CSS; Vitest; Playwright; Codex.

## Demo disclosure

The **1:46.672** English-captioned video uses synthetic customer speech, fresh Nova replies, local DynamoDB and mock POS. No physical microphone, real order or payment is involved.

Its captured working tree is based on **7cb44f4**, with recorded local changes. It predates the concise-prompt change and does not demonstrate that new behavior.
