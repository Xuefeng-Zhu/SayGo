# Confirm an order by voice

**Current Nova connection: use screen confirmation.** The verified provider stream does not supply a certified boundary for a complete final user utterance. A finalized transcript fragment is not enough to prove that a later fragment will not add a correction or negation. SayGo therefore keeps voice confirmation unavailable on that adapter rather than treating a partial “yes” as consent.

The server and UI support the guarded flow below for an adapter that can supply the required complete speech evidence. That implementation and its controlled tests are not a claim that voice confirmation worked in a real Nova session. Screen confirmation remains available. All orders stay in the fictional local POS sandbox; this does not charge a payment or send an order to a real restaurant.

1. Finish your changes, then say **“Review my order.”**
2. Listen to the full order and total. The board shows **Listen to your order** while the readback plays. You can still interrupt or make a correction.
3. When the board says **Ready to place this order?**, say **“Yes, place the order.”** The confirmation window is short. A simple “okay”, a partial transcript or an earlier recording is not consent.
4. Check the result. **Sending your order…** means the test order is waiting for the POS sandbox. **Your order is in.** means the sandbox has accepted it. An uncertain result is shown honestly; do not submit a second order to resolve it.

If you say no or change an item, the draft stays editable and the pending confirmation is discarded. Ask for a new readback after correcting the order. Undo, staff takeover, a new customer, a lost voice connection and expiration also require a new confirmation window. Returning control from staff does not restart voice or submit the draft.

You can still confirm on screen. Stop live voice, review the current order and select **Confirm order**. Typed messages to Nova do not confirm an order. Draft reset continues to require its separate **Confirm reset** screen action; confirming an order never clears the draft as a side effect.

## What the board knows

The confirmation panel uses the server's current quote, cart version, customer session and control fence. It shows the exact server readback and total. Captions are for visibility; the browser never treats their text as permission to place an order.

The browser acknowledges a readback only after the matching server completion message and the entire corresponding audio queue have finished. That playback receipt is not customer consent. The server separately checks final speech evidence, the current confirmation window and all quote/session guards before submission. If those checks cannot be established, the voice path stays closed and the screen flow remains available.

## Verification boundaries

`tests/unit/readback-playback.test.ts` covers playback receipts, stale identities, expiry and invalidation. `tests/e2e/voice-confirmation.spec.ts` uses software audio, controlled WebSockets and controlled server state to check UI presentation and playback acknowledgment. Those browser fixtures do not prove recognition or server consent enforcement. Domain/runtime tests and a separately recorded real-provider trial are required for those claims. Human microphone, speaker and noisy-car testing remain separate.

## Why the current provider stays closed

The [Nova output-event contract](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html) describes content segments. Its [chat-history example](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-chat-history.html) explicitly pairs USER `generationStage: FINAL` with `stopReason: PARTIAL_TURN`. Neither page guarantees that an assistant `END_TURN` seals all customer transcript fragments. Endpointing sensitivity controls a pause threshold; it is not a consent guarantee.

A bounded real-provider probe on October 22, 2026 used synthetic customer speech: “Yes, place the order. No, do not place the order.” The affirmative and negative arrived as separate FINAL/PARTIAL_TURN fragments about two seconds apart. Committing after the first fragment would have ignored the correction. No order was submitted in that probe.

`CURRENT_NOVA_VOICE_CONFIRMATION_SUPPORTED` is therefore a literal `false` in the runtime. Client JSON, tool arguments, environment variables, captions, an assistant response ending and silence timers cannot enable it. The domain and coordinator positive tests use controlled complete-turn evidence for a future adapter; they do not establish current Nova support. Enabling voice submission requires a documented, verified terminal transcript boundary and fresh-audio onset contract, followed by real-provider readback, interruption, correction and exactly-once receipt tests.
