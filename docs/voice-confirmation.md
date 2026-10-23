# Confirm an order by voice

Live voice supports a separate spoken-approval recording after the full order readback. SayGo checks the completed recording against the current quote before submitting to the local POS sandbox. Payment stays due at the window.

## Place an order

1. Finish your changes, then say **“Review my order.”**
2. Listen to the full order and total. The board shows **Listen to your order** while the readback plays. Interrupt or make a correction if anything is wrong.
3. When **Record spoken confirmation** becomes available, select it and say **“Yes, place my order.”**
4. After the complete sentence, select **Finish spoken confirmation**. The buttons start and finish recording; the spoken words provide approval.
5. Wait for the result. **Sending your order…** means submission is pending. **Your order is in.** means the sandbox accepted it. If the result is uncertain, check the current order before trying again.

A simple “okay”, typed message, partial transcript or earlier recording cannot confirm an order. A correction, negative response, expired window, changed quote, staff takeover, new customer or lost connection invalidates spoken approval. Ask for a fresh review after resolving the issue.

For screen confirmation, stop live voice, review the current order and select **Confirm order**. Draft reset still requires its separate **Confirm reset** action.

## How approval is checked

The confirmation panel shows the server's exact readback and total. The server binds it to the quote, cart version, customer session, connection and ownership fence. The browser acknowledges playback only after the matching server completion and the entire audio queue have finished. That acknowledgment enables recording; it does not approve the order.

The gateway accepts fresh audio only within the confirmation window. After the customer finishes recording, it closes audio input and retains any model `submit_order` request. The model receives `PENDING_VERIFICATION`, which means no order has been submitted.

The gateway then closes the provider session and waits for natural stream termination. It combines all final customer transcript fragments from that recording and requires a complete explicit affirmative phrase. Extra, negative, provisional or missing content prevents approval. Successful verification records consent, releases the voice lease and sends the retained request through MCP. The MCP input remains only `quote_id`; it cannot supply consent itself.

If verification fails, stop voice and use a fresh screen review. See [voice lifecycle](voice.md#spoken-order-approval) for the surrounding stream behavior.

## Why transcript fragments are insufficient

The earlier fragment-based approach remains disabled by `CURRENT_NOVA_VOICE_CONFIRMATION_SUPPORTED=false`. Nova can label an individual customer transcript segment `FINAL` with `PARTIAL_TURN`; that segment need not contain the complete customer utterance. An assistant response ending or a silence timer cannot establish that the customer has finished.

An October 22, 2026 synthetic provider probe said: “Yes, place the order. No, do not place the order.” The affirmative and negative arrived as separate FINAL/PARTIAL_TURN fragments about two seconds apart. No order was submitted. The current recording flow waits for the whole provider stream to end before checking all fragments from the recording.

See the provider [output-event documentation](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html) and [chat-history example](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-chat-history.html).

## Verification

Controlled playback, domain, runtime and browser tests exercise readback identity, fresh capture, expiry, interruption, transcript fragments, consent and submission guards. Browser fixtures use software audio, intercepted WebSockets and controlled server state; they cannot establish recognition quality or real-provider behavior.

The October 22 probe tested the unsafe fragment case, before the separate recording flow. Earlier touch-confirmation demos also predate this implementation. A current provider trial must retain its own source identity and results. Physical microphone, speaker and noisy-car testing remain separate. See [evaluation](evaluation.md) for dated results.
