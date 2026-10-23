# Historical fixture demo — October 14, 2026

The later provider-backed video and current submission materials are in [the submission packet](../devpost-submission.md). This page preserves the earlier fixture recording and its script.

## Recording and evidence

The **2:36 (156.159-second), 1920×1080 demo** was recorded on October 14, 2026 from commit `2d8b000`. Scripted phrases execute MCP calls against an isolated in-memory DynamoDB Local instance and a local POS sandbox. Narration uses the offline macOS Samantha voice. The recording made **zero provider calls** and used no physical microphone or speakers.

The [verification receipt](evidence/demo-recording-20261014.json) records the corrected **$18.09** total, stable cart lines, customer review and confirmation, accepted kitchen ticket, next-customer isolation, and staff takeover. It also records video/audio decoding, H.264/AAC, embedded English captions, reviewed frames and temporary-service cleanup. A later documentation check verified the file's metadata and SHA-256 without rerunning the app.

The video, narration, captions, poster and original receipt remain under `output/playwright/saygo-demo-20261014/`. They are untracked and absent from a fresh clone; the portable receipt is in `docs/evidence`.

- File: `SayGo-demo.mp4`.
- SHA-256: `c7853a9ff0419e6693d0c129604d4925502039c8cc9450f73612976cd1c02a2a`.
- Publication status in the receipt: **not uploaded or published**.

The final slide cites a separate [synthetic trial through Sonic](evidence/live-voice-sonic-v4-i-20261014.json), which passed 16 checks. That audio was not captured live in this video. The trial does not establish physical acoustics, interruption reliability or spoken-price accuracy.

## Recording script

These are preparation timings, not exact edit points. The recording starts with local services running, the seeded menu loaded, POS mode set to Accept, and an admin signed in.

| Approximate time | Action and narration                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:15        | Introduce SayGo, fictional Harbor Burger, the independent Alexa+ concept simulator and local POS sandbox. Begin a customer session.                                                                                                                                      |
| 0:15–0:45        | Select **Start example order**, then **Apply correction**. Show two independent burger lines, the modifiers on the intended burger, the lemonade changing from medium to large, and the $18.09 total. Explain that predefined fixture phrases call the ordering backend. |
| 0:45–1:10        | Select **Review order**. Show the server quote, modifiers, fixture tax and payment due at the window. Select **Confirm order** and wait for acceptance.                                                                                                                  |
| 1:10–1:35        | Open Kitchen. Show the matching modifiers and order number, then mark the ticket preparing and ready. Explain that delivery uses the local sandbox.                                                                                                                      |
| 1:35–1:55        | Select **Vehicle departed**, then begin a new customer session. Show the empty board and the previous kitchen ticket.                                                                                                                                                    |
| 1:55–2:20        | Add an example order, select **Ask staff**, then **Take control** in Crew. Show the preserved draft, paused automation, staff edit/message, resolution and release.                                                                                                      |
| 2:20–2:35        | Explain that this fixture recording does not exercise live speech. Native Alexa+, commercial POS, payments and intercom hardware remain future integrations.                                                                                                             |

A physical-voice recording requires separate [voice acceptance checks](voice.md). Keep fixture footage and provider-backed results labeled with their own source and test scope.

## Historical text-model results

The [original Nova 2 Lite suite](evidence/live-model-evaluation-reasoning-low-8192-run-identity-original-20261014.json) and [additional-question suite](evidence/live-model-evaluation-reasoning-low-8192-run-identity-generalization-20261014.json) each passed **10/10** on the same [preserved October 14 source](evidence/model-fix-source-manifest-20261014.json), before contract 0.5. Questions, expected answers and exact scoring were unchanged; earlier failed and partial runs remain preserved.

These results cover those text questions. They do not establish general model reliability or spoken-price accuracy. See the [verification receipt](evidence/model-fix-verification-20261014.json).

The October 20 publication preparation used source through `118eef4` as its base. For later source, video, access and form status, use the [current submission checklist](submission/submission-checklist.md). The [October 10 rules snapshot](integrations.md) is historical.
