# Voice lifecycle

Status: real adapter code, official AWS SDK types, and synthetic lifecycle tests. **No live Bedrock invocation, real microphone recording, noisy audio, barge-in acoustics or spoken-price accuracy was verified.** No audio fixtures are included because no licensed/self-recorded samples were provided.

## Implemented path

1. A user gesture requests mono microphone access. AudioWorklet accumulates/resamples browser input to 16 kHz signed PCM, emitting 512-sample (32 ms) frames. The browser checks its WebSocket send buffer; overload stops capture instead of dropping an unbounded backlog.
2. The authenticated Node WebSocket opens a server-only MCP client, performs initialize + tool discovery over HTTP, and supplies the discovered JSON schemas to Nova.
3. `BedrockRuntimeClient` uses the HTTP/2 handler and `InvokeModelWithBidirectionalStreamCommand`. Input is an async bounded event queue. Session/prompt start, system text, continuous audio content, completed tool results, and closing events follow the published event lifecycle.
4. The adapter waits for a complete `TOOL_USE` content end before parsing/schema-validating/calling MCP. It serializes tools, bounds pending calls, and sends actionable errors back as tool results. Provisional captions never cause cart writes.
5. Provider audio is 24 kHz mono PCM. Web Audio schedules bounded playback. Provider interruption signals increment a generation, block old completion IDs, stop active sources and clear scheduled buffers. In-flight database writes are not “undone”; versions/ownership fences govern them.
6. UI captions distinguish provisional and final text. Live text fallback goes to the same Nova session. Explicit Stop, staff takeover, expiry, new vehicle, stream failure or seven-minute limit cleans up the microphone, playback and stream. Seven minutes stays below the documented eight-minute provider connection limit.
7. A database voice lease blocks final approval until voice stops and queued tools drain. The UI also disables review during live speech. Final approval is deliberately **touch-only** in this MVP; Nova cannot approve itself.

## Verification still required

- Authorized account/model access and chosen region; request schema acceptance with a real stream.
- Live duplex audio framing/resampling across Safari/Chrome/hardware, permission denial, disconnect/reconnect and echo behavior.
- Response audio latency, provider interruption signal ordering, late generation suppression under network delay, model/tool accuracy and spoken quote accuracy.
- Realistic licensed/self-recorded noisy fixtures, acoustic echo and outdoor intercom trials. No noise/completion-rate/confidence claims are made.

Latency hooks currently measure completed user transcript to first response audio and tool round trips. These hooks are not benchmark results. Browser evidence measures local click → canonical cart and confirmation → accepted board separately, including polling overhead. A true end-of-utterance metric requires aligning real audio/event timestamps during a live trial.

Fixture mode is a finite list in `packages/integrations/src/fixtures.ts`, not speech recognition or an unconstrained language interpreter. Unsupported fixture text fails explicitly. The primary correction scenario and side/ambiguity/allergy cases still traverse the actual MCP transport and persistent domain logic.

Primary references: [input events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-input-events.html), [output events](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-output-events.html), [barge-in](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-barge-in.html), [async tools](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-async-tools.html), [getting started](https://docs.aws.amazon.com/nova/latest/nova2-userguide/sonic-getting-started.html), [model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-sonic.html).
