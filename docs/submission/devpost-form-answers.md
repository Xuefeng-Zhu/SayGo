# SayGo — Devpost form answers

Updated October 23, 2026 from the existing submission schema and inspected saved form values. There are **30 custom fields**, including **21 marked required**. The normal project description and video deliverable are additional. No Codex session ID appears in this form.

This document records the saved technical answers and entrant declarations. The October 23 revision adds tool-specific feedback and the three principal friction entries directly to Question 3. Onboarding elapsed times were not recorded.

## Choices and links

| Field ID    | Actual form field                                    | Saved answer / evidence                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 28285       | Submitter Type                                       | Saved: **Individual**.                                                                                                                                                                                                                       |
| 28286       | Organization Name                                    | Saved: **N/A**.                                                                                                                                                                                                    |
| 28287       | Submitter Country of Residence                       | Saved: **United States**.                                                                                                                                                                                                                                  |
| 28288       | Canadian province, if any teammate resides in Canada | Saved: **N/A**.                                                                                                                                                                                                                     |
| 28289       | Primary Track(s)                                     | Saved: **Alexa+**, simulated-experience route. No Fire TV, Bee or Ring claim.                                                                                                                                                                                |
| 28290       | GitHub repository URL                                | [Xuefeng-Zhu/SayGo](https://github.com/Xuefeng-Zhu/SayGo), verified public October 23 at `2b6dc36`; [MIT](../../LICENSE) for original source code and documentation. Third-party terms and generated-media exclusions are described in [notices](../../THIRD_PARTY_NOTICES.md). |
| 28291       | New or existing before August 31, 2026?              | Saved: **New**. Preserve the entrant's answer; Git history alone is not eligibility evidence.                                                                                                                                               |
| 28292       | Existing-project updates                             | Not used because the saved choice is **New**.                                                                                                                                                                           |
| 28293       | AWS Builder Mini Challenge?                          | Saved: **Yes**.                                                                                                                                                                                                                                     |
| 28294       | AWS services incorporated and how                    | Use the technical answer below. This textarea is marked required.                                                                                                                                                                                                  |
| 28295       | Open Source Mini Challenge?                          | Saved and verified: **Yes**; new additional MIT project route. |
| 28296       | Open Source contribution URL                         | [Standalone MCP validation helper contribution](https://github.com/Xuefeng-Zhu/mcp-validation-envelope/commit/9bb2bda70521fd074ac95f95461da8c101278db4). |
| 28297       | Open Source project repository URL                   | [Xuefeng-Zhu/mcp-validation-envelope](https://github.com/Xuefeng-Zhu/mcp-validation-envelope), public and MIT-licensed. |
| 28298       | Open Source GitHub username                          | Xuefeng-Zhu. |
| 28299       | Open Source contribution description                 | Exact saved contribution description below. |
| 28300       | Optional Feature Requests                            | Saved feature requests below.                                                                                                                                                                                                                           |
| 28301       | Optional Friction Log URL                            | Saved: [friction log](https://github.com/Xuefeng-Zhu/SayGo/blob/main/docs/submission/friction-log.md). The form defines this as a URL field; Question 3 also contains all three principal entries in full.                                                                                                                    |
| 28302       | Optional Project Testing Link                        | No hosted application URL verified. Local instructions are provided instead.                                                                                                                                                                                       |
| 29377       | Testing instructions / credentials                   | Use the short reviewer answer below.                                                                                                                                                                                                                               |
| 28303–28307 | Five required product-feedback answers               | Saved technical answers below; saved future-use answer is **Yes**.                                                                                                                                                                                       |
| 28308       | Age                                                  | Saved: checked. Preserve the entrant's declaration.                                                                                                                                                                                          |
| 28309       | Eligible Jurisdiction                                | Saved: checked. Preserve the entrant's declaration.                                                                                                                                                                                     |
| 28310       | Employee                                             | Saved: checked. Preserve the entrant's declaration.                                                                                                                                                                  |
| 29056       | AI tools used while working on the project           | Use the technical answer below.                                                                                                                                                                                                                                    |
| 29057       | Learning level                                       | Saved: **Moderate**.                                                                                                                                                                                                                          |
| 29058       | Career AI value                                      | Saved: **Yes**.                                                                                                                                                                                                                                               |

**Required video deliverable, outside the above custom fields:** [Public 179-second YouTube video](https://www.youtube.com/watch?v=vc-iBxxVerc), publication/watch page verified October 23. The live entry is Submitted; the original submission timestamp is retained in the receipt.

## 28299 — Open Source contribution description

I created mcp-validation-envelope as a new, additional MIT-licensed TypeScript project alongside SayGo, published October 23, 2026. It extracts and generalizes the structured MCP recovery pattern developed while building SayGo; it has no SayGo runtime, database, voice or AWS dependency.

The package uses the official MCP SDK low-level Server with Zod validation inside the tools/call handler. Invalid arguments, declared application failures and successful results share an advertised, validated envelope with matching structuredContent and JSON text; isError distinguishes failure. Unexpected exceptions are sanitized, invalid inputs skip execution and unknown tools remain protocol errors.

It includes a runnable SDK client/server example, generated input/output schemas and 12 passing tests, including JSON-RPC correlation, output validation and thrown-validation-error redaction. The repository documents provenance, reusable installation and its in-memory verification scope. This gives other MCP developers a small, inspectable alternative when they need consistent machine-readable recovery from validation failures.

## 28294 — AWS services incorporated and how

Amazon Bedrock Nova 2 Sonic handles live bidirectional speech and model tool requests through the AWS SDK for JavaScript. A server-side Node gateway streams browser PCM and keeps AWS credentials off the client. Nova 2 Lite was used separately for bounded menu/pricing evaluation.

Amazon DynamoDB holds the canonical menu, cart, quote, customer approval, order and delivery job. Transactions and cart/quote version checks protect state changes; stable delivery keys support sandbox POS retries. The successful take used remote DynamoDB in an isolated fictional namespace, cleaned up after verification. DynamoDB Local provides reproducible credential-free reviewer fixtures.

Amazon Polly Generative Matthew produces consistent prerecorded male customer speech and narration. Restaurant replies were generated live by Nova 2 Sonic with the female Tiffany voice. The MCP TypeScript SDK connects the pipeline through 11 tools over MCP 2025-11-25 Streamable HTTP; Zod validates tool inputs/results. Server-verified sealed spoken approval gates submission. This is an Alexa+ browser concept simulation with SandboxPos.

## 28292 — Existing-project update explanation, only if applicable

The entrant's saved choice is **New**, so this conditional Existing-project answer is not used. No pre-submission baseline is invented.

## 29377 — Short reviewer answer

Follow https://github.com/Xuefeng-Zhu/SayGo/blob/main/docs/submission/reviewer-instructions.md. The fixture route needs Node 22.12+, pnpm 11.25.0 and Docker or Java 17+ for DynamoDB Local. Explicitly set the loopback database endpoint before migration/seed/startup; no owner AWS credentials are needed. Fictional seeded login: admin / harbor-demo-only. Open localhost:3100/lane/lane-1, begin a session, select the example/correction, review and confirm, then inspect Kitchen.

The finite fixture scenario totals $18.09 and executes real MCP and persistent ordering logic; it does not recognize arbitrary speech. Free-form voice requires the reviewer's own authorized Bedrock access and incurs charges. The selected 179-second film separately shows synthetic customer speech, fresh Nova replies, ten Voice tool types, sealed spoken approval, remote DynamoDB and one matching $9.72 sandbox kitchen ticket. Staff help is intentionally skipped. No physical microphone, real restaurant order/payment or native Alexa+ integration is claimed.

## 29056 — AI tools used while working on the project

Nova 2 Sonic supplies live speech and tool requests; Nova 2 Lite was used for separate menu/pricing evaluation. Polly Generative Matthew supplies prerecorded synthetic male customer speech and narration. Nova Tiffany restaurant replies were generated live during take 08.

Codex assisted implementation, review, lifecycle/approval fixes, regression tests, synthetic-audio QA, evidence and submission preparation. Remotion/Cirro and local FFmpeg/NumPy tools produced and verified the film. Application logic retains explicit quote-bound customer approval. This is a browser-based Alexa+ concept simulation; no native Alexa+ deployment, official Alexa hardware or voice cloning was used.

## Required product feedback — saved answers

These technical updates describe current recorded behavior. The future-use **Yes** and its preference language are retained from the saved entrant answer.

### 28303 — Which developer tools, APIs and SDKs did you use, and for what?

Amazon Bedrock Nova 2 Sonic and the AWS SDK for JavaScript provide bidirectional speech, incremental audio/transcript events and model tool requests. Nova 2 Lite was used separately for bounded menu/pricing evaluation. Amazon Polly Generative Matthew generated the prerecorded synthetic male customer lines and narration; Nova Tiffany generated live female restaurant replies.

Amazon DynamoDB and its JavaScript SDK persist canonical carts, quotes, approvals, orders and delivery jobs using transactions and version checks. DynamoDB Local supports reproducible review without owner AWS credentials. The MCP TypeScript SDK exposes 11 tools over MCP 2025-11-25 Streamable HTTP. Its low-level Server supports our structured recovery envelopes; Zod validates tool inputs and results.

Node.js, Express and ws support the gateway; Next.js, React and TypeScript provide customer, crew and kitchen screens. Vitest and Playwright test application layers. Codex assisted implementation, debugging and evidence review; Remotion, Cirro and local FFmpeg/NumPy tools produced the film. This is an Alexa+ simulation, not a native Alexa+ integration.

### 28304 — What worked well?

Nova's incremental audio and transcript events let us build progressive browser playback and visible turn feedback. The Bedrock SDK's bidirectional stream connected PCM input, generated speech and tool requests in one session. This made the interaction practical to exercise; we did not record an end-to-end latency benchmark.

The MCP SDK's low-level Server gave us control over application error envelopes while retaining official request schemas and Streamable HTTP transport. Zod validation on both inputs and outputs made recovery data consistent and inspectable.

DynamoDB transactions and conditional version checks suited the canonical cart/quote/approval/order workflow. DynamoDB Local let reviewers reproduce persistent ordering behavior with fixtures and no AWS credentials. Polly Generative provided repeatable scripted speech, which made comparisons and recording easier than asking a conversational model to read fixed lines verbatim.

TypeScript caught cross-layer contract mistakes; Vitest and Playwright separated domain, protocol and browser checks. React/Next.js kept the canonical order visible, while Remotion/Cirro and FFmpeg made the recorded flow reproducible as a captioned film. Codex helped iterate on these integrations, with tests and evidence review checking the changes.

### 28305 — What needs work?

1. MCP validation envelope — Task: call an advertised tool with invalid arguments and return structured recovery data. Steps: advertise the schema, initialize an SDK client and send an invalid tools/call request. Expected: our per-tool error envelope reaches the client. Actual: in our October 10 integration, MCP TypeScript SDK 1.32.1's high-level server validated before our handler and returned its own text-only error. Severity: Important; recovery shape was inconsistent. Workaround: use the official low-level Server with explicit Zod input/output validation, keeping protocol errors separate. Suggestion: allow customizable high-level validation errors, with a documented structured recovery example.

2. Nova inputSchema.json serialization — Task: configure streamed Nova 2 Sonic tool schemas. Steps: compare the input-event and tool-configuration references, serialize the schema and open a stream. Expected: one unambiguous current-model format. Actual: public configuration examples showed both stringified JSON and objects; SDK comments also referenced original Sonic. Severity: Important; type checks could not prove runtime acceptance. Workaround: send JSON.stringify(schema) in inputSchema.json and verify using an account-backed stream. Suggestion: maintain one current Nova 2 Sonic end-to-end example covering schema serialization, interruption, usage events and stream cleanup, linked from the reference pages.

3. Sealed spoken approval — Task: read the exact quote and submit only after fresh explicit customer consent. Steps: prepare a quote, play its readback, record approval and inspect the pending tool request and provider termination. Expected: verified approval of that quote before MCP submission. Actual: partial transcripts, readback playback, model tool requests and stream completion had separate boundaries; a tool request alone could not prove consent. Severity: Blocking for trustworthy voice submission. Workaround: acknowledge completed playback, bind fresh capture to quote/cart/connection, seal the audio, defer the requested submission and verify through natural provider completion. Suggestion: publish a reference lifecycle for interrupted approval, deferred tools and final consent diagnostics. This is an application integration challenge, not an isolated vendor defect.

The successful take verifies these boundaries with one $9.72 order and matching kitchen ticket. Human/noisy-intercom testing and more concise conversation recovery remain next steps. Full evidence and additional setup entries are in the linked friction log.

### 28306 — How was onboarding, from zero to hello world?

We did not record elapsed time to the first Nova stream or the first MCP tool call, so I cannot provide reliable estimates for either milestone.

For Nova, hello world meant authorized AWS credentials, the correct region/model, a Bedrock bidirectional stream, correctly framed PCM input and playable returned audio. AWS access expiry, current-model documentation differences and inputSchema.json serialization slowed setup.

For MCP, hello world meant starting the authenticated Streamable HTTP endpoint, initializing a client, discovering tools and making a real get_cart call. Zod discovery/input/output schemas and customizing high-level validation errors took extra work; the low-level Server supplied the needed control. Protocol 2025-11-25 and 11-tool discovery are covered by HTTP integration tests.

DynamoDB Local made the next step reproducible without AWS credentials. Separate ports/data and matching Playwright Chromium were additional local setup requirements. A maintained Nova 2 Sonic example that reaches a first audio response and first MCP tool result would shorten this path. This feedback comes from the Alexa+ browser simulation.

### 28307 — Would you build with these devices and services again?

Yes. I would use the stack again to develop this Alexa+ experience. MCP gives the conversational client explicit application actions, while the Nova browser simulation lets us test ordering and corrections before connecting a native client.

The next priority is preserving a concise, natural conversation while making confirmation and recovery dependable. I would keep the supporting persistence, web and testing tools, and use Polly and Remotion for demonstrations where useful. Coding assistance remains subject to tests and review.

The current synthetic-audio take now verifies sealed spoken approval, with screen confirmation still available. I would not describe native Alexa+ integration, human/noisy-intercom performance or production reliability as proven.

## 28300 — Optional feature requests

Saved feature requests:

- **Important — provider streaming examples:** one maintained end-to-end Nova example covering current model ID, tool schemas, interruption, final usage and cleanup would reduce integration ambiguity.
- **Important — protocol diagnostics:** clearer structured schema/validation errors across MCP server abstraction levels would make recovery easier to implement.
- **Nice-to-have — speech QA fixtures:** documented test-audio and transcript-alignment examples would help separate recognition failures from application state errors.
