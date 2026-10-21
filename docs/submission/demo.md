# SayGo — recorded demo

**Public YouTube/Vimeo URL: pending.** The local candidate is not yet a verified public submission link. This document does not upload it.

| Property          | Recorded candidate                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Filename          | `SayGo-live-AI-male-demo.mp4`                                                                  |
| Duration          | **106.672 seconds** (1:46.672), below three minutes                                            |
| Format            | 1920×1080; English burned and embedded captions                                                |
| SHA256            | `2b1616f62aa908bdf438b181830d6b5fd658845021161b6632cb2de822148461`                             |
| Source            | Working tree based on `7cb44f4`, with local recording changes and explicit local test settings |
| Customer/narrator | Prerecorded Amazon Polly Generative Matthew speech                                             |
| Assistant         | Fresh Amazon Bedrock Nova 2 Sonic Tiffany replies generated during the take                    |
| Storage/delivery  | DynamoDB Local and SandboxPos                                                                  |

## What it shows

The customer edits an order, sees the cart change, reviews the exact quote and taps **Confirm order** after voice ends. One accepted **$9.72** order contains a classic burger without onions and a medium lemonade without ice. It reaches the local POS sandbox and kitchen display.

The cart initially showed a large drink although the input clip was scripted to request medium. A further spoken clarification restored medium before confirmation. This recovery remains visible. Its acoustic cause is unresolved.

The capture passed 21 flow assertions, including no order or approval before touch, voice ending before touch, one order/approval/receipt and agreement between cart and screen quote. Media and browser playback checks passed. The video does not itself demonstrate every separate spoken-yes, cancellation or staff-takeover regression.

## Boundaries

This is a browser-based **Alexa+ concept simulation**, not a registered Alexa+ SDK/device integration. It uses synthetic customer speech and fresh model replies. There is no physical microphone, real restaurant delivery or payment. Media checks do not establish perceptual naturalness or performance in noise.

The recording predates the concise-prompt change selected for publication. The new prompt has automated test coverage, but actual shorter spoken replies remain unverified. No replacement concise movie exists.

## Gallery

These frames are from the same recorded pre-concision build:

- [Voice order](screenshots/voice-order.png)
- [Screen review](screenshots/screen-review.png)
- [Accepted order](screenshots/accepted.png)
- [Kitchen ticket](screenshots/kitchen.png)

Before entering Devpost, review the candidate, publish it as a public YouTube or Vimeo video and add the actual URL. No public video or gallery upload is established here. See [verification scope](verification.md) and [submission checklist](submission-checklist.md).
