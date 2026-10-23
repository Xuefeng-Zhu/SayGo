# SayGo

**Speak, see each change, and approve the exact order before it reaches the kitchen.**

## Impact

A busy drive-through employee is juggling a headset and another task when a customer says, “Actually…” A missed quantity or modifier can become a wrong order, a remake, a comp and a frustrated customer. SayGo is designed to catch that misunderstanding before the kitchen starts: show the current order, make corrections visible and require verified consent to the exact items and total.

## What it does

Customers order and correct items by voice while the order board and MCP call log show the resulting state. The assistant can look up ingredients, compare prices, check meal savings and read draft status without changing the cart.

Review creates an exact, expiring quote. The customer hears the complete items and total, starts a fresh approval recording, says “Yes, place my order,” and finishes that recording. The server verifies the sealed audio and quote before recording approval and completing the actual MCP submission. Screen confirmation is also available. A model request or partial transcript cannot approve an order.

## Technical implementation

Next.js, React and TypeScript provide customer, crew and kitchen screens. Browser PCM audio streams through an authenticated Node gateway to Amazon Bedrock Nova 2 Sonic; AWS credentials remain server-side. The MCP TypeScript SDK exposes **11 tools over MCP 2025-11-25 Streamable HTTP**. Zod validates inputs and results; the ordering engine checks menu choices, integer-cent prices and cart versions.

Amazon DynamoDB transactions maintain the canonical cart, quote, approval and order, with delivery jobs and stable keys for sandbox POS retries. DynamoDB Local provides a reproducible reviewer path without AWS credentials. Nova 2 Lite was used separately for bounded menu/pricing evaluation. Amazon Polly Generative Matthew supplies consistent male customer speech and narration; the female restaurant replies were generated live by Nova Tiffany during recording.

## The demo and evidence

The public 2:59 film opens with a busy employee, then shows a continuous slice of the successful October 23 take and animated Nova/MCP/DynamoDB data flows. The MCP log stays visible with actual source, outcome, measured duration and request/result summaries.

The take contains **16 successful Voice calls across 10 tool types**; staff help is intentionally skipped. It finishes with one Classic Burger without onions, one medium lemonade without ice, and one accepted **$9.72** order with a matching kitchen ticket. Twenty-four flow assertions verify no order before sealed spoken approval, exactly one approval/order/receipt and cleanup of the isolated remote DynamoDB namespace. Recorded source fingerprints and failed attempts are preserved.

## Open source companion

We extracted [mcp-validation-envelope](https://github.com/Xuefeng-Zhu/mcp-validation-envelope) as an additional MIT project. It gives low-level MCP tools consistent structured validation recovery, with a runnable SDK client/server example and 12 tests. Developers can reuse it independently of SayGo.

## What we learned and what comes next

Speech, playback, tool requests and database writes finish at different times. Binding fresh customer audio to the exact quote, acknowledging completed readback and waiting for natural provider completion made the consent boundary inspectable. The next step is testing human speech, noisy intercoms and broader menus, then integrating commercial POS systems and native Alexa+.

**Limits:** This independent Alexa+ browser concept uses a fictional restaurant, synthetic customer speech and sandbox POS. Native Alexa+, physical-microphone/noisy-intercom performance, human acceptance of voice naturalness and real-world error reduction remain unverified.

Codex assisted implementation, debugging, tests, evidence review and video preparation. Remotion and Cirro produced the film with English captions.

[Watch the public 2:59 demo](https://www.youtube.com/watch?v=vc-iBxxVerc).
