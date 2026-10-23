# SayGo — Devpost form answers

Updated October 23, 2026 from the existing submission schema and inspected saved form values. There are **30 custom fields**, including **21 marked required**. The normal project description and video deliverable are additional. No Codex session ID appears in this form.

Review the technical drafts before using them. Preserve the entrant's saved personal declarations, future-use opinion and track choices; this document updates technical evidence.

## Choices and links

| Field ID    | Actual form field                                    | Draft answer / remaining action                                                                                                                                                                                                                                    |
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
| 28295       | Open Source Mini Challenge?                          | Saved: **No**. No additional Open Source mini-challenge contribution is claimed.                                                                  |
| 28296       | Open Source contribution URL                         | Leave blank if not entering; otherwise supply an actual qualifying URL.                                                                                                                                                                                            |
| 28297       | Open Source project repository URL                   | Conditional on entering; supply the qualifying public repository.                                                                                                                                                                                                  |
| 28298       | Open Source GitHub username                          | Conditional on entering; owner confirms the contributor account.                                                                                                                                                                                                   |
| 28299       | Open Source contribution description                 | Conditional on entering; describe the actual additional work.                                                                                                                                                                                                      |
| 28300       | Optional Feature Requests                            | Draft suggestions below; owner may omit.                                                                                                                                                                                                                           |
| 28301       | Optional Friction Log URL                            | Proposed: [friction log](https://github.com/Xuefeng-Zhu/SayGo/blob/main/docs/submission/friction-log.md); verify public access before using it.                                                                                                                    |
| 28302       | Optional Project Testing Link                        | No hosted application URL verified. Local instructions are provided instead.                                                                                                                                                                                       |
| 29377       | Testing instructions / credentials                   | Use the short reviewer answer below.                                                                                                                                                                                                                               |
| 28303–28307 | Five required product-feedback answers               | Current technical drafts below; saved future-use answer is **Yes**.                                                                                                                                                                                       |
| 28308       | Age                                                  | Saved: checked. Preserve the entrant's declaration.                                                                                                                                                                                          |
| 28309       | Eligible Jurisdiction                                | Saved: checked. Preserve the entrant's declaration.                                                                                                                                                                                     |
| 28310       | Employee                                             | Saved: checked. Preserve the entrant's declaration.                                                                                                                                                                  |
| 29056       | AI tools used while working on the project           | Use the technical answer below.                                                                                                                                                                                                                                    |
| 29057       | Learning level                                       | Saved: **Moderate**.                                                                                                                                                                                                                          |
| 29058       | Career AI value                                      | Saved: **Yes**.                                                                                                                                                                                                                                               |

**Required video deliverable, outside the above custom fields:** [Public 179-second YouTube video](https://www.youtube.com/watch?v=vc-iBxxVerc), publication/watch page verified October 23. Final Devpost submission remains a separate action.

## 28294 — AWS services incorporated and how

Amazon Bedrock provides Nova 2 Sonic for live speech and tool requests. Browser PCM passes through an authenticated Node gateway; Nova uses schema-validated MCP tools rather than writing orders directly. Nova 2 Lite was used separately for bounded menu/pricing evaluation.

Amazon DynamoDB stores canonical menu, cart, quote, approval, order and delivery records. Transactions and version checks protect changes. The successful October 23 take used remote DynamoDB with a fresh fictional namespace, removed after verification. DynamoDB Local is available for isolated tests and credential-free reviewer fixtures.

Amazon Polly Generative Matthew generated prerecorded male customer speech and narration. Nova Tiffany restaurant replies were generated live in the take. Server-verified sealed spoken approval now precedes the actual MCP submission. SayGo is an independent Alexa+ browser concept simulation, not a native Alexa+ deployment; delivery uses SandboxPos.

## 28292 — Existing-project update explanation, only if applicable

The entrant's saved choice is **New**, so this conditional Existing-project answer is not used. No pre-submission baseline is invented.

## 29377 — Short reviewer answer

Follow https://github.com/Xuefeng-Zhu/SayGo/blob/main/docs/submission/reviewer-instructions.md. The fixture route needs Node 22.12+, pnpm 11.25.0 and Docker or Java 17+ for DynamoDB Local. Explicitly set the loopback database endpoint before migration/seed/startup; no owner AWS credentials are needed. Fictional seeded login: admin / harbor-demo-only. Open localhost:3100/lane/lane-1, begin a session, select the example/correction, review and confirm, then inspect Kitchen.

The finite fixture scenario totals $18.09 and executes real MCP and persistent ordering logic; it does not recognize arbitrary speech. Free-form voice requires the reviewer's own authorized Bedrock access and incurs charges. The selected 179-second film separately shows synthetic customer speech, fresh Nova replies, ten Voice tool types, sealed spoken approval, remote DynamoDB and one matching $9.72 sandbox kitchen ticket. Staff help is intentionally skipped. No physical microphone, real restaurant order/payment or native Alexa+ integration is claimed.

## 29056 — AI tools used while working on the project

Nova 2 Sonic supplies live speech and tool requests; Nova 2 Lite was used for separate menu/pricing evaluation. Polly Generative Matthew supplies prerecorded synthetic male customer speech and narration. Nova Tiffany restaurant replies were generated live during take 08.

Codex assisted implementation, review, lifecycle/approval fixes, regression tests, synthetic-audio QA, evidence and submission preparation. Remotion/Cirro and local FFmpeg/NumPy tools produced and verified the film. Application logic retains explicit quote-bound customer approval. This is a browser-based Alexa+ concept simulation; no native Alexa+ deployment, official Alexa hardware or voice cloning was used.

## Required product feedback — evidence-based draft

These technical updates describe current recorded behavior. The future-use **Yes** and its preference language are retained from the saved entrant answer.

### 28303 — Which developer tools, APIs and SDKs did you use, and for what?

SayGo targets the Alexa+ simulation track with visible, correctable restaurant ordering. Amazon Bedrock Nova 2 Sonic and the AWS SDK for JavaScript provide live browser speech, captions and model tool requests; Nova 2 Lite supported separate bounded menu/pricing evaluation. This is not a native Alexa+ connection.

The MCP TypeScript SDK and Zod expose eleven validated menu/order tools. DynamoDB and its SDK persist canonical carts, quotes, approvals, orders and delivery jobs; DynamoDB Local supports isolated tests. Node.js, TypeScript, Express and ws support the server; Next.js, React and Tailwind support customer/crew/kitchen screens. Vitest, Playwright and historical MCP Inspector checks test separate layers.

Codex assisted implementation, debugging, tests and evidence review. Polly Matthew creates synthetic customer/narration audio; Remotion, Cirro and local FFmpeg/NumPy tools produce the demo. Provider audio and model text cannot themselves establish customer consent.

### 28304 — What worked well?

The useful result was connecting a spoken request to an inspectable application action. The successful October 23 take shows sixteen actual successful Voice calls covering ten tool types: ordering, correction, information reads, a dismissed reset proposal, review and submission. The visible MCP log shows source, outcome, measured duration and request/result summaries alongside the cart. Staff help is intentionally omitted.

DynamoDB transactions and quote/cart checks support the approval boundary. The customer hears the exact quote, records fresh explicit approval, seals the capture and waits for server verification through natural provider completion before actual MCP submission. The take creates exactly one accepted $9.72 order/receipt with a matching kitchen ticket.

The web stack keeps persisted selections visible; Polly Matthew supplies repeatable synthetic male input. Tests and local media receipts retain source identity and failures. This successful synthetic-browser example does not establish native Alexa+ behavior or broad speech reliability.

### 28305 — What needs work?

Trustworthy spoken approval required application work: provisional transcripts, model tool requests, actual readback playback, fresh capture, quote binding and provider completion occur at different times. The earlier screen-only fallback has now been replaced in the successful take by server-verified sealed spoken approval. A pending model submission request is not executed until that gate passes.

The current take preserves genuine partial/repeated Nova replies, so concise, natural conversation and recovery still need broader human/noisy-audio testing. We have not isolated these integration issues as Nova, MCP or Alexa+ defects. An interrupted-confirmation reference lifecycle with clear diagnostics would help.

Earlier attempts encountered expired AWS access and failed conversational customer synthesis. Dedicated Polly TTS produced repeatable scripted customer lines; a JSON-only CLI attempt failed locally before a service request. Local rendering failures are retained. Next.js 16.4.0 also triggered a known security advisory during the publication build; current source was patched narrowly to 16.4.1, while the recorded demo remains tied to 16.4.0. Native Alexa+ and commercial POS behavior remain untested.

### 28306 — How was onboarding, from zero to hello world?

For this project, the meaningful milestone was a customer speaking, correcting an order, and seeing the corresponding application action. A tool list or successful service connection alone would not demonstrate that journey.

The browser simulation let us work on those interactions before native Alexa+ integration. Bedrock required authorized AWS access, model/region selection, PCM framing and streaming/tool-schema integration. MCP discovery and Zod schemas needed agreement at both ends. DynamoDB used an authorized table for the selected demo; the reviewer fixture route explicitly selects DynamoDB Local. The pinned web/server stack and matching Playwright Chromium need separate local ports/data.

The successful current take adds exact readback and sealed spoken approval to those milestones. For Alexa+ developers, I would welcome a complete reference lifecycle connecting turns, corrections, MCP execution and final approval with clear diagnostics. This is feedback from building the simulation, not a claim of native Alexa+ API failure. We have not measured onboarding time.

### 28307 — Would you build with these devices and services again?

Yes. I would use the stack again to develop this Alexa+ experience. MCP gives the conversational client explicit application actions, while the Nova browser simulation lets us test ordering and corrections before connecting a native client.

The next priority is preserving a concise, natural conversation while making confirmation and recovery dependable. I would keep the supporting persistence, web and testing tools, and use Polly and Remotion for demonstrations where useful. Coding assistance remains subject to tests and review.

The current synthetic-audio take now verifies sealed spoken approval, with screen confirmation still available. I would not describe native Alexa+ integration, human/noisy-intercom performance or production reliability as proven.

## 28300 — Optional feature requests

Draft suggestions for owner review:

- **Important — provider streaming examples:** one maintained end-to-end Nova example covering current model ID, tool schemas, interruption, final usage and cleanup would reduce integration ambiguity.
- **Important — protocol diagnostics:** clearer structured schema/validation errors across MCP server abstraction levels would make recovery easier to implement.
- **Nice-to-have — speech QA fixtures:** documented test-audio and transcript-alignment examples would help separate recognition failures from application state errors.
