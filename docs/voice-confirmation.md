# Voice confirmation

**Use screen confirmation with the current Nova adapter.** A finalized transcript fragment may be followed by a correction or negation. SayGo keeps spoken approval disabled until the adapter can provide complete final customer speech.

To place a fictional order, stop live voice, choose **Review order**, check the current quote and select **Confirm order**. Typed messages and spoken affirmations do not approve orders. Draft reset requires its separate **Confirm reset** action. Orders go to the local POS sandbox; payment stays due at the window.

## Guarded flow for a future adapter

The server and UI contain a voice-confirmation core for an adapter that can supply complete speech evidence. Controlled tests exercise this flow:

1. The customer asks to review the order.
2. SayGo reads the exact server quote, including every item, modifier and the total. Corrections or interruptions invalidate that readback.
3. After the full readback finishes, a short confirmation window opens. The customer must give an explicit affirmative such as **“Yes, place the order.”** A simple “okay”, typed message, partial transcript or earlier recording is insufficient.
4. The server validates complete final speech against the current quote and session before submission. **Sending your order…** means submission is pending. **Your order is in.** means the sandbox accepted it. An uncertain result requires checking the current order before trying again.

Negative responses, changed items, Undo, staff takeover, a new customer, lost connections or expiry require a new readback and confirmation window. Returning control from staff never restarts voice or submits the draft.

This flow remains unavailable through the current Nova adapter. Its controlled positive tests use complete-turn evidence supplied by fixtures.

## How the core checks approval

The confirmation panel shows the server's exact readback and total. The server binds it to the quote, cart version, customer session, connection and ownership fence. The browser acknowledges playback only after the matching server completion and the entire audio queue have finished. That acknowledgment is separate from customer consent.

The server then requires complete final speech from the current confirmation window and rechecks quote/session guards before submission. Captions, client-supplied flags and model prose cannot supply consent. When evidence is incomplete, the voice path stays closed and screen confirmation remains available.

## Why Nova approval remains disabled

The [Nova output-event documentation](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html) describes transcript segments. Its [chat-history example](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-chat-history.html) pairs USER `generationStage: FINAL` with `stopReason: PARTIAL_TURN`. An assistant response ending or a silence timer cannot establish that all customer fragments have arrived.

An October 22, 2026 synthetic provider probe said: “Yes, place the order. No, do not place the order.” The affirmative and negative arrived as separate FINAL/PARTIAL_TURN fragments about two seconds apart. Committing after the first would have ignored the correction. No order was submitted.

`CURRENT_NOVA_VOICE_CONFIRMATION_SUPPORTED` is a literal `false` in the runtime. Client JSON, tool arguments, environment variables, captions, an assistant response ending and silence timers cannot enable it. Enabling spoken approval requires a verified complete-transcript boundary and fresh-audio onset contract, followed by provider readback, interruption, correction and duplicate-submission tests.

## Verification

`tests/unit/readback-playback.test.ts` covers playback receipts, stale identities, expiry and invalidation. `tests/e2e/voice-confirmation.spec.ts` uses software audio, intercepted WebSockets and controlled server state to check the panel and playback acknowledgment. Browser fixtures cannot establish recognition quality or server consent enforcement; domain/runtime tests cover those guards under controlled evidence.

A real-provider trial must retain its own source identity and results. Physical microphone, speaker and noisy-car testing remain separate. See [evaluation](evaluation.md) for dated results.
