# Voice lifecycle

SayGo streams browser audio to Nova 2 Sonic and uses MCP tools to update the order. Live voice is opt-in. The selected [October 23 take](submission/demo.md) verifies synthetic-audio ordering and sealed spoken approval through fresh Nova streams and remote DynamoDB. Physical microphone/speaker behavior remains unverified. The [October 14 trial](evidence/live-voice-sonic-v4-i-20261014.json) is separate historical evidence.

## Enable live voice

First run the [local demo](local-development.md). Live voice requires Bedrock model access, AWS credentials through an existing `AWS_PROFILE` or role, and an approved spending scope. Credentials stay server-side; never put them in `NEXT_PUBLIC_*` variables.

In the ignored repository-root `.env`, set:

```dotenv
SAYGO_VOICE_ENABLED=true
AWS_REGION=us-west-2
SAYGO_VOICE_MODEL=amazon.nova-2-sonic-v1:0
```

Shell values override `.env`. If the current terminal has voice disabled, run `export SAYGO_VOICE_ENABLED=true`. Restart `pnpm dev`, begin a customer session and select **Start live voice** to request microphone access. Use the configured `localhost` origin. Replies use an AI-generated Nova voice.

To confirm on screen, stop voice and select **Confirm order**. To confirm by speech, follow [spoken order approval](#spoken-order-approval). A failed stream displays an error; the customer can choose text or scripted examples as a fallback.

Live sessions incur provider charges. Application voice does not use the [test harness](#synthetic-live-test)'s spending ledger or 90-second cap.

## Audio and tool lifecycle

1. Starting voice requests mono microphone access. An AudioWorklet resamples browser input to 16 kHz signed PCM, emitting 512-sample (32 ms) frames. If the WebSocket send buffer fills, capture stops.
2. The authenticated Node WebSocket opens a server-side MCP client, initializes it over HTTP, lists tools and supplies their JSON schemas to Nova.
3. `BedrockRuntimeClient` uses the HTTP/2 handler and `InvokeModelWithBidirectionalStreamCommand`. A bounded async queue sends session/prompt start, system text, continuous audio, tool results and closing events in lifecycle order.
4. The adapter waits for `TOOL_USE` content to end before parsing and validating arguments, then calling MCP. Tool calls run serially with a bounded queue. Errors return the required recovery action. Provisional captions never cause cart writes.
5. Provider audio is 24 kHz mono PCM. Web Audio queues bursts of speech with limits of 30 seconds and 512 sources. Interruption clears active/scheduled audio. Fresh audio content can resume under a reused completion ID; delayed old content stays rejected. User transcripts remain visible during assistant playback suppression. Interrupting speech leaves committed writes intact; cart versions and ownership checks govern further writes.
6. UI captions distinguish provisional and final text. Live text fallback goes to the same Nova session. Stop, staff takeover, expiry, a new vehicle, stream failure or the seven-minute application limit closes the microphone, playback and stream.
7. A database voice lease blocks screen approval until voice stops and queued tools finish. Spoken approval uses a separate sealed recording after an exact readback. The gateway validates the complete recording before storing consent, releases that connection's lease, and invokes the model-requested `submit_order` through MCP. Model prose and typed text cannot create voice consent.

## Spoken order approval

1. Ask SayGo to review the order. Listen to the full readback and check the items and total.
2. Select **Record spoken confirmation**, say **“Yes, place my order,”** then select **Finish spoken confirmation**. The button closes the recording; the spoken words provide approval.
3. Wait for the accepted-order state. Payment is due at the window.

The gateway binds the recording to the current customer, connection, quote, cart version and completed playback. It accepts only a complete explicit affirmative phrase. It rejects negative, extra, provisional or missing transcript content, changed quotes, expired windows, typed input, lost connections and abnormal provider termination. Stop voice and use a fresh screen review if spoken verification cannot finish.

Nova's finalized USER transcripts can end with `PARTIAL_TURN`, so one segment alone cannot establish the full utterance. The gateway closes audio input, retains the model's submission request and returns `PENDING_VERIFICATION`. It then closes the provider session and waits for all transcript fragments through natural stream termination before acting. The existing provider-`USER END_TURN` gate remains separate. See the official [input lifecycle](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-input-events.html) and [output lifecycle](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html).

The October 23 take verifies this path with synthetic customer audio: no order before sealed capture, natural provider completion before approval, and one voice-approved order/receipt. The October 14 receipts below predate it and remain historical. See [current verification](submission/verification.md).

## Remaining verification

- Broaden the successful synthetic take beyond the selected menu/price/savings and sealed-approval scenario; one take does not establish general reliability.
- Test other accounts/regions and sustained sessions.
- Test microphone capture, resampling, permission denial, reconnects and echo across browsers and devices.
- Measure response latency, interruption ordering, late audio under network delay, model/tool accuracy and spoken prices.
- Test licensed or self-recorded noisy audio, acoustic echo and outdoor intercoms.

Latency hooks measure final transcript to first response audio and tool round trips; no benchmark is reported. Browser timings measure click → saved cart and confirmation → accepted board, including polling. Measuring end-of-utterance latency requires aligned audio and event timestamps from a live trial.

Fixture mode matches a fixed list in `packages/integrations/src/fixtures.ts` and rejects unsupported text. Correction, side, ambiguity and allergy scenarios use the same MCP transport and persistent domain logic as voice.

Primary references: [input events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-input-events.html), [output events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html), [barge-in](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-barge-in.html), [async tools](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-async-tools.html), [getting started](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-getting-started.html), [model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-sonic.html).

## Recorded Sonic trial — October 14, 2026

The [successful trial](evidence/live-voice-sonic-v4-i-20261014.json) sent offline macOS TTS through browser capture, an authenticated WebSocket, Bedrock Sonic, HTTP MCP, DynamoDB Local and response playback. All 16 checks passed, including a large-drink correction with stable line IDs, a $9.50 subtotal/$10.26 fixture total, a final 50-cent comparison caption, nonempty provider PCM, review blocking, staff shutdown, lease cleanup and no approval or submission.

Chromium was muted. The trial tested no physical microphone, speaker, noisy outdoor audio or independent acoustic price assessment. It observed no provider interruption signals; earlier failed trials did. It therefore provides no acoustic barge-in or reliability estimate.

The [source manifest](evidence/live-voice-i-source-manifest.json) predates the later October 14 price-guidance and signed-summary changes, contract 0.5's `find_meal_savings`, and sealed spoken confirmation. Sonic was not rerun for the text-only follow-up. See [evaluation history](evaluation.md) for later checkpoints.

## Synthetic live test

`tests/live-voice-evaluation.ts` creates three offline TTS utterances: add a burger/drink, correct drink size, and ask a meal-drink price comparison. A software `MediaStreamAudioDestinationNode` replaces `getUserMedia`; the original microphone API is never invoked. Headless Chromium is muted. Synthetic PCM then traverses the production AudioWorklet, authenticated WebSocket, real Sonic stream, discovered HTTP MCP tools, DynamoDB Local and playback path. The test checks saved cart prices, stable line identity, final transcripts, provider audio, tool use, review blocking, staff fencing, lease cleanup and absence of voice-generated consent/submission. It does not assess physical acoustics.

After provider approval and AWS sign-in, use an initialized budget approval ID and a fresh report ID:

```sh
: "${SAYGO_PROVIDER_APPROVAL_ID:?Set an initialized approval ID}"
SAYGO_VOICE_QA=true \
SAYGO_PROVIDER_APPROVAL_ID="$SAYGO_PROVIDER_APPROVAL_ID" \
SAYGO_VOICE_QA_RUN_ID=your-unique-id pnpm test:voice:live
```

The harness uses isolated ports 3120/3114, an isolated Next build directory and a temporary local database namespace. It stops before opening a paid stream if the AWS profile is not signed in. It reserves $0.25 in the shared text/voice ledger, caps a stream at 90 seconds and 24 tool calls, and stops when observed token-based cost exceeds $0.20. Only a naturally ended stream with validated modality usage settles the reservation; unknown outcomes remain reserved. These limits are enforced by the harness; AWS billing can exceed them. Historical Sonic cost estimates use the October 10 regional catalog ($3/M input speech, $12/M output speech, $0.319/M input text, $2.651/M output text); no invoice is verified. [AWS catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-west-2/index.json).

Sanitized provider receipts are saved under `docs/evidence/live-voice-<id>.json`. Synthetic input, private tool traces and response WAV stay in ignored owner-only `.local/voice-qa/<id>`. Current screenshots are in an owner-only `/private/tmp/saygo-voice-qa-*` directory recorded in each receipt; early development screenshots remain ignored. Application voice does not persist raw audio. Existing reports are never overwritten. Temporary entity data and owned servers are cleaned up. The offline `tests/e2e/voice-browser.spec.ts` intercepts the WebSocket instead of contacting Sonic; it tests browser behavior without a provider call.

Earlier failed trials exposed playback-buffer limits, confusion between edits and hypothetical prices, invalid request UUIDs and interruption/content tracking issues. The recorded fixes required in-place edits, explicit review intent and UUID errors that explain the format without echoing inputs. The passing stream recovered from an invalid UUID and a missing meal size through structured errors.

The successful stream's estimated cost was $0.006114 using [rechecked rates](evidence/provider-pricing-20261013.json); no invoice was verified. Budget settlement waits for final stream usage. A [reconciliation receipt](evidence/provider-budget-reconciliation-20261014.json) documents the earlier cleanup race. Attempts with no provider call settle at zero; unknown outcomes remain reserved.
