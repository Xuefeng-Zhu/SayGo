# Voice lifecycle

Status: the [synthetic Sonic run](evidence/live-voice-sonic-v4-i-20261014.json) passed on October 14, 2026 after local AWS sign-in. Offline macOS TTS traversed real browser capture, authenticated WebSocket, Bedrock Sonic, HTTP MCP, DynamoDB Local and response playback. All 16 checks passed: direct large-drink correction with stable line IDs, exact $9.50 subtotal/$10.26 fixture total, final 50-cent comparison caption, nonempty provider PCM, review blocking, staff shutdown, lease cleanup and no approval/order submission. **No physical microphone, speaker, noisy outdoor audio or independent acoustic price assessment was tested.** One successful development trial is not a reliability estimate. Earlier failures are preserved.

The saved receipt and its [source manifest](evidence/live-voice-i-source-manifest.json) predate the later October 14 text-only model follow-up. Shared price guidance now preserves product identity across before/after modifications and selects signed subtraction by operand labels. The comparison summary now supplies both labeled subtraction directions; that follow-up left the comparison's numeric fields and schemas unchanged. The current contract 0.5 also adds `find_meal_savings`; the saved Sonic trial predates that tool. These changes reach the voice adapter through its shared guidance and MCP results, but **Sonic was not rerun during this text-only follow-up**. The earlier pass remains evidence for the recorded implementation, not verification of the changed voice behavior. Physical voice remains unverified. See [current text evaluation](evaluation.md).

## Enable live voice

First run the [local fixture demo](local-development.md). Live voice requires authorized Bedrock access through the normal AWS credential chain, such as an existing `AWS_PROFILE` or role, and an approved spending scope. Credentials stay server-side; never put them in `NEXT_PUBLIC_*` variables.

In the ignored repository-root `.env`, set:

```dotenv
SAYGO_VOICE_ENABLED=true
AWS_REGION=us-west-2
SAYGO_VOICE_MODEL=amazon.nova-2-sonic-v1:0
```

If you previously exported local fixture overrides, also run `export SAYGO_VOICE_ENABLED=true` in that terminal; shell values take precedence over `.env`. Restart `pnpm dev`, begin a customer session and select **Start live voice** to request microphone access. Use the configured `localhost` origin. Speech is AI-generated using a Nova voice. Stop voice before the final customer confirmation; stream failures are shown as failures, with text/fixture fallback available explicitly. Live sessions incur provider charges. Normal application voice does not use the synthetic QA harness's approval ledger or its 90-second test cap.

The saved synthetic trial verified one account/region at its checkpoint; confirm access for the account you intend to use. Physical microphone/speaker testing remains separate from that trial. The [synthetic live test](#synthetic-live-test) below uses software input and muted Chromium instead of physical devices.

## Implemented path

1. A user gesture requests mono microphone access. AudioWorklet accumulates/resamples browser input to 16 kHz signed PCM, emitting 512-sample (32 ms) frames. The browser checks its WebSocket send buffer; overload stops capture instead of dropping an unbounded backlog.
2. The authenticated Node WebSocket opens a server-only MCP client, performs initialize + tool discovery over HTTP, and supplies the discovered JSON schemas to Nova.
3. `BedrockRuntimeClient` uses the HTTP/2 handler and `InvokeModelWithBidirectionalStreamCommand`. Input is an async bounded event queue. Session/prompt start, system text, continuous audio content, completed tool results, and closing events follow the published event lifecycle.
4. The adapter waits for a complete `TOOL_USE` content end before parsing/schema-validating/calling MCP. It serializes tools, bounds pending calls, and sends actionable errors back as tool results. Provisional captions never cause cart writes.
5. Provider audio is 24 kHz mono PCM. Web Audio permits faster-than-real-time speech bursts while bounding backlog to 30 seconds and 512 sources. Interruption clears active/scheduled audio. Fresh audio content can resume under a reused completion ID; delayed old content stays rejected. User ASR captions are independent of assistant playback suppression. In-flight database writes are not “undone”; versions/ownership fences govern them.
6. UI captions distinguish provisional and final text. Live text fallback goes to the same Nova session. Explicit Stop, staff takeover, expiry, new vehicle, stream failure or seven-minute limit cleans up the microphone, playback and stream. Seven minutes stays below the documented eight-minute provider connection limit.
7. A database voice lease blocks final approval until voice stops and queued tools drain. The UI also disables review during live speech. Final approval is deliberately **touch-only** in this MVP; Nova cannot approve itself.

## Verification still required

- Revalidate Sonic with the changed shared price guidance and signed-comparison summaries; the saved successful stream predates those changes.
- Revalidation across other accounts/regions and sustained sessions; configured account/region and actual stream acceptance passed in this bounded trial.
- Live duplex audio framing/resampling across Safari/Chrome/hardware, permission denial, disconnect/reconnect and echo behavior.
- Response audio latency, provider interruption signal ordering, late generation suppression under network delay, model/tool accuracy and spoken quote accuracy.
- Realistic licensed/self-recorded noisy fixtures, acoustic echo and outdoor intercom trials. No noise/completion-rate/confidence claims are made.

Latency hooks currently measure completed user transcript to first response audio and tool round trips. These hooks are not benchmark results. Browser evidence measures local click → canonical cart and confirmation → accepted board separately, including polling overhead. A true end-of-utterance metric requires aligning real audio/event timestamps during a live trial.

Fixture mode is a finite list in `packages/integrations/src/fixtures.ts`, not speech recognition or an unconstrained language interpreter. Unsupported fixture text fails explicitly. The primary correction scenario and side/ambiguity/allergy cases still traverse the actual MCP transport and persistent domain logic.

Primary references: [input events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-input-events.html), [output events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html), [barge-in](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-barge-in.html), [async tools](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-async-tools.html), [getting started](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-getting-started.html), [model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-sonic.html).

## Synthetic live test

`tests/live-voice-evaluation.ts` creates three offline TTS utterances: add a burger/drink, correct drink size, and ask a meal-drink price comparison. A software `MediaStreamAudioDestinationNode` replaces `getUserMedia`; the original microphone API is never invoked. Headless Chromium is muted. Synthetic PCM then traverses the production AudioWorklet, authenticated WebSocket, real Sonic stream, discovered HTTP MCP tools, DynamoDB Local and playback path. The test asserts exact canonical cart prices, stable line identity, final ASR captions, nonempty provider audio, tool use, review blocking, staff fencing, lease cleanup and absence of voice-generated consent/submission. Final-caption matching is not independent acoustic assessment, and barge-in acoustics remain unverified.

After explicit provider approval and local AWS sign-in, use a previously initialized additional-budget ID and a fresh report ID:

```sh
: "${SAYGO_PROVIDER_APPROVAL_ID:?Set an initialized approval ID}"
SAYGO_VOICE_QA=true \
SAYGO_PROVIDER_APPROVAL_ID="$SAYGO_PROVIDER_APPROVAL_ID" \
SAYGO_VOICE_QA_RUN_ID=your-unique-id pnpm test:voice:live
```

The harness uses isolated ports 3120/3114, an isolated Next build directory and a temporary local database namespace. It fails closed before a paid stream when the existing AWS profile is not signed in. It reserves $0.25 in the shared text/voice ledger, caps a stream at 90 seconds and 24 tool calls, and stops when observed token-based cost exceeds $0.20. Only a naturally ended stream with validated modality usage settles the reservation; unknown outcomes remain reserved. These are application guards, **not an AWS billing-enforced cap**. Usage-based Sonic estimates use the October 10 regional catalog ($3/M input speech, $12/M output speech, $0.319/M input text, $2.651/M output text); no invoice is verified. [AWS catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-west-2/index.json).

Sanitized provider receipts are saved under `docs/evidence/live-voice-<id>.json`. Synthetic input, private tool traces and response WAV stay in ignored owner-only `.local/voice-qa/<id>`. Current screenshots are in an owner-only `/private/tmp/saygo-voice-qa-*` directory recorded in each receipt; early development screenshots remain ignored. Production voice does not record raw audio. Existing reports are never overwritten. Temporary entity data and owned servers are cleaned up. The offline `tests/e2e/voice-browser.spec.ts` intercepts the WebSocket instead of contacting Sonic; its passing result is explicitly **no-provider** evidence.

The live failures exposed a too-small playback buffer, confusion between requested edits and hypothetical prices, invalid model-generated request UUIDs and interruption/content tracking. Voice guidance now requires in-place updates and explicit review intent. MCP validation still rejects invalid UUIDs, but explains the format without echoing inputs. The passing stream recovered from an invalid UUID and a missing meal size via structured errors. [Source manifest](evidence/live-voice-i-source-manifest.json). Provider interruption signals occurred in earlier failed runs; the final passing run had zero such signals, so its success does not establish live barge-in reliability. The successful stream estimated $0.006114 using [rechecked rates](evidence/provider-pricing-20261013.json); no invoice is verified. Settlement now waits for final stream usage; a [receipt](evidence/provider-budget-reconciliation-20261014.json) records reconciliation of the earlier cleanup race. Known no-provider attempts settle at zero; unknown outcomes stay reserved.
