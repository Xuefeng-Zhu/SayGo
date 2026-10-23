# SayGo

**Speak, see each change, and approve the exact order before it reaches the kitchen.**

## Inspiration

A drive-through employee is often taking an order while handling another task. One “actually…” can change quantities, drink sizes and modifiers at once. SayGo makes the current order visible, so a misunderstanding can be corrected before a kitchen ticket is created.

## What it does

SayGo is a browser-based Alexa+ concept simulation for fictional Harbor Burger. Customers order and correct items by voice while the order board and MCP call log show the resulting state. The model can look up ingredients, compare prices, check meal savings and read draft status without changing the cart.

Review creates an exact, expiring quote. The customer hears the complete items and total, starts a fresh spoken-approval recording, says “Yes, place my order,” and finishes that recording. The server verifies the sealed audio and quote before recording approval and completing the actual MCP submission. Screen confirmation is also available. A review request, typed text or the model’s own words cannot approve an order.

The successful October 23 take shows 16 successful Voice calls covering ten tool types, followed by one accepted $9.72 sandbox order and its matching kitchen ticket: one Classic Burger without onions and one medium lemonade without ice. The registered staff-help tool is intentionally omitted from this demo. The application has eleven MCP tools in total.

## How we built it

Next.js, React and TypeScript provide customer, crew and kitchen screens. Browser PCM audio streams through an authenticated Node gateway to Amazon Bedrock’s Nova 2 Sonic. Credentials remain server-side.

Nova requests structured actions through the MCP TypeScript SDK. Zod schemas validate tool inputs and results. The ordering engine checks menu choices, prices in integer cents and cart versions. Amazon DynamoDB stores the canonical cart, reviewed quote, approval, order and delivery job. Transactions and stable delivery keys support one consistent sandbox receipt when delivery is retried.

The demo uses remote DynamoDB in an isolated fictional namespace, which is removed after verification. Reviewers can reproduce the fixture route with DynamoDB Local and no AWS credentials. Free-form voice requires their own authorized AWS access. Polly Generative Matthew supplies the synthetic male customer speech and narration; the female restaurant replies were generated live by Nova Tiffany during the recording.

## Challenges and learning

Streaming speech, playback, tool calls and database writes finish at different times. We had to distinguish a model’s request from customer approval, wait for actual readback playback, bind fresh spoken consent to the exact quote, seal the capture and complete provider cleanup before submitting. Pending verification must never be presented as an accepted order.

Observability also matters: the MCP log exposes actual source, outcome, measured duration and request/result summaries. The selected take keeps it visible, including a proposed reset that the customer dismisses while preserving the draft.

Dedicated TTS was more suitable for repeatable scripted customer lines than prompting a conversational model to narrate verbatim. We preserved failed synthesis/recording evidence and measured usage rather than treating a failed attempt as a pass. The successful take also preserves genuine partial or repeated restaurant replies.

## Verification

The selected take passed 24 flow assertions: no order before sealed spoken approval, exactly one voice approval/order/receipt, correct $9.72 totals, successful Voice coverage for ten selected tools, matching kitchen state and cleanup. Its source fingerprints were preserved across all 217 recorded files.

The submission film is 179 seconds, 1920×1080 H.264/AAC with English captions. It contains a humorous problem animation, one continuous 134-second slice of the successful take, and animated Nova/MCP/DynamoDB data flows. Nineteen independent media checks and complete normal-speed, sound-enabled browser playback passed. Subjective voice naturalness has not received human acceptance.

## What’s next

Test human speech, background noise, intercom hardware and a broader range of menus. Commercial POS adapters and native Alexa+ integration remain future work. We have not deployed this prototype in a restaurant or measured real-world error reduction.

## AI and disclosure

Nova 2 Sonic handles live speech and tools; Nova 2 Lite was used separately for bounded menu/pricing evaluation. Polly creates prerecorded demo speech. Codex assisted implementation, debugging, tests, evidence review and video preparation; Remotion and Cirro produce the local film.

SayGo is an independent Alexa+ concept simulator, not a native Alexa+ deployment. The restaurant and POS are fictional/sandboxed. No physical microphone, real restaurant order or payment was used.

[Watch the public 2:59 demo](https://www.youtube.com/watch?v=vc-iBxxVerc).
