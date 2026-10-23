# SayGo

## One-line summary

A drive-through ordering assistant that lets customers speak, see each change, and confirm the order before it reaches the kitchen.

## Inspiration / Problem

Drive-through orders change during conversation: a customer removes a burger, resizes a drink or asks for no onions on one item. SayGo keeps those changes visible so the customer can correct a misunderstanding before approving the kitchen ticket.

## What it does / Solution

At fictional Harbor Burger, customers add items, change quantities and modifiers, and watch the order board update.

The screen shows the current cart and a server-generated quote. Customers stop voice before tapping **Confirm order**, and the accepted test order appears on the kitchen display. Spoken words alone cannot place an order; approval uses the screen.

Staff can take over without losing the draft. When the POS response is uncertain, SayGo checks the original delivery request before reporting acceptance.

## Why this matters

Customers and staff see the same item selections and modifiers. The prototype supports checking and correcting an order; it has not been deployed in a restaurant or measured for error reduction.

## How we built it / Architecture

Next.js, React, TypeScript and Tailwind CSS provide the customer and staff screens. Audio streams through the Node server to Amazon Bedrock's Nova 2 Sonic model; credentials stay server-side.

The model reads the menu and edits the draft through Streamable HTTP MCP tools. Zod schemas validate tool requests. The ordering engine checks menu choices and calculates prices in integer cents. Version checks reject edits based on an outdated cart.

DynamoDB stores the draft, quote, approval, order and delivery job. A worker delivers the confirmed order to the local POS sandbox using a stable request key.

SayGo runs as an independent **Alexa+ concept simulation in a browser**. Native Alexa+ registration and Fire TV support remain outside this prototype.

## Challenges

Speech and cart writes finish asynchronously. A delayed startup failure could hide the controls for a newer voice session. Session ownership checks and cleanup now handle that race. The gateway also owns retry IDs rather than trusting model-generated ones.

In the recording, the cart showed large although the customer clip was scripted to ask for medium. Another spoken clarification restored medium before confirmation. That recovery is left visible; the acoustic cause is unresolved.

## Accomplishments

The recorded flow reaches one accepted **$9.72** sandbox order: a classic burger without onions and a medium lemonade without ice. Its 21 checks include screen consent and matching order/receipt state.

An October 21 source snapshot passed 145 unit tests, lint, root/web TypeScript checks, a webpack web build and runtime/worker builds. Tests cover the concise-response prompt; its effect on spoken replies still needs a live run. See [verification scope](verification.md) for the source version.

## What we learned

A correct transcript alone does not prove a correct order. Tests also need to compare the cart, approval and POS receipt. We also found conflicting prompt instructions: a request for brief replies competed with a demand to repeat totals after every edit. The redundant instruction was removed; its effect still needs a live check.

## What's next

Verify the shorter replies with fresh Nova audio. Then test with human speech, background noise and intercom hardware. Broader menu testing, a commercial POS adapter and a native Alexa+ integration are later steps.

## How we used AI and Codex

Nova 2 Sonic handles speech and tools; Nova 2 Lite was used for separate menu/pricing evaluations. Polly Generative Matthew supplies prerecorded customer speech and narration. The demo's Nova Tiffany replies were generated live.

Codex assisted source inspection, lifecycle fixes, tests and demo preparation. Tests and saved source hashes tie each result to the code that produced it.

## Built with

Amazon Bedrock/Nova; DynamoDB/Local; Polly; AWS SDK/CLI; MCP TypeScript SDK; Zod; Node.js/Express/WebSocket; TypeScript; Next.js/React/Tailwind CSS; Vitest; Playwright; Codex.

## Demo disclosure

Recorded October 21, 2026.

The **1:46.672** English-captioned video uses synthetic customer speech, fresh Nova replies, local DynamoDB and mock POS. No physical microphone, real order or payment is involved.

The recorded working tree is based on **7cb44f4**, with local changes. It predates the concise-response prompt. [Demo details](demo.md).
