# SayGo — Devpost form answers

Drafted from the live submission schema fetched October 21, 2026. There are **30 custom fields**, including **21 marked required**. The normal project description and video deliverable are additional. No Codex session ID appears in this form.

Review the technical drafts before using them. The entrant must supply personal declarations, future-use feedback and final track choices.

## Choices and links

| Field ID    | Actual form field                                    | Draft answer / remaining action                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 28285       | Submitter Type                                       | **OWNER:** Individual, Team or Organization.                                                                                                                                                                                                                       |
| 28286       | Organization Name                                    | **OWNER:** organization name, or `N/A` if not representing one.                                                                                                                                                                                                    |
| 28287       | Submitter Country of Residence                       | **OWNER:** select actual country.                                                                                                                                                                                                                                  |
| 28288       | Canadian province, if any teammate resides in Canada | **OWNER:** province, or `N/A` if inapplicable.                                                                                                                                                                                                                     |
| 28289       | Primary Track(s)                                     | Recommended: **Alexa+**, simulated-experience route. No Fire TV, Bee or Ring claim.                                                                                                                                                                                |
| 28290       | GitHub repository URL                                | [Xuefeng-Zhu/SayGo](https://github.com/Xuefeng-Zhu/SayGo), verified public October 21; [MIT](../../LICENSE) for original source code and documentation. Third-party terms and generated-media exclusions are described in [notices](../../THIRD_PARTY_NOTICES.md). |
| 28291       | New or existing before August 31, 2026?              | **OWNER:** confirm. Earliest available Git commit is October 10; this does not prove there was no earlier prototype.                                                                                                                                               |
| 28292       | Existing-project updates                             | If Existing is selected, use the conditional draft below and confirm the prior baseline.                                                                                                                                                                           |
| 28293       | AWS Builder Mini Challenge?                          | Recommended: **Yes**; confirm.                                                                                                                                                                                                                                     |
| 28294       | AWS services incorporated and how                    | Use the technical answer below. This textarea is marked required.                                                                                                                                                                                                  |
| 28295       | Open Source Mini Challenge?                          | Recommended: **No**, unless a separate qualifying additional project/contribution is supplied. Making the primary SayGo repository public does not itself establish that additional contribution.                                                                  |
| 28296       | Open Source contribution URL                         | Leave blank if not entering; otherwise supply an actual qualifying URL.                                                                                                                                                                                            |
| 28297       | Open Source project repository URL                   | Conditional on entering; supply the qualifying public repository.                                                                                                                                                                                                  |
| 28298       | Open Source GitHub username                          | Conditional on entering; owner confirms the contributor account.                                                                                                                                                                                                   |
| 28299       | Open Source contribution description                 | Conditional on entering; describe the actual additional work.                                                                                                                                                                                                      |
| 28300       | Optional Feature Requests                            | Draft suggestions below; owner may omit.                                                                                                                                                                                                                           |
| 28301       | Optional Friction Log URL                            | Proposed: [friction log](https://github.com/Xuefeng-Zhu/SayGo/blob/main/docs/submission/friction-log.md); verify public access before using it.                                                                                                                    |
| 28302       | Optional Project Testing Link                        | No hosted application URL verified. Local instructions are provided instead.                                                                                                                                                                                       |
| 29377       | Testing instructions / credentials                   | Use the short reviewer answer below.                                                                                                                                                                                                                               |
| 28303–28307 | Five required product-feedback answers               | Drafts below; owner reviews observations and confirms the future-use answer.                                                                                                                                                                                       |
| 28308       | Age                                                  | **OWNER ONLY:** confirm the age-of-majority declaration for all entrants.                                                                                                                                                                                          |
| 28309       | Eligible Jurisdiction                                | **OWNER ONLY:** confirm against the rules; country-list presence is not proof.                                                                                                                                                                                     |
| 28310       | Employee                                             | **OWNER ONLY:** confirm no entrant is an employee/representative/agent of the promotion entities.                                                                                                                                                                  |
| 29056       | AI tools used while working on the project           | Use the technical answer below.                                                                                                                                                                                                                                    |
| 29057       | Learning level                                       | **OWNER:** None / Moderate / Significant.                                                                                                                                                                                                                          |
| 29058       | Career AI value                                      | **OWNER:** Yes / No.                                                                                                                                                                                                                                               |

**Required video deliverable, outside the above custom fields:** add a public YouTube or Vimeo URL. The current local/Library MP4 is not that public link.

## 28294 — AWS services incorporated and how

Amazon Bedrock supplies Nova 2 Sonic for real-time speech and tool use. The browser sends audio to the Node runtime, which opens the model stream and connects completed tool requests to SayGo's MCP server. Nova 2 Lite was used separately for bounded menu and pricing evaluations.

Amazon DynamoDB stores structured menu, cart, quote, approval, order and delivery records. Transactions and version checks protect state changes. DynamoDB Local provides isolated development and test storage; the recorded demo uses that local route.

Amazon Polly Generative Matthew generated the prerecorded customer inputs and narration for the demo. The assistant's Nova replies were generated live. Polly is a demo-production tool, not a required service for the fixture application.

## 28292 — Existing-project update explanation, only if applicable

**Owner: confirm what existed before August 31 before using this answer.**

During the submission window, the repository's recorded work added the current ordering board, validated MCP tools, DynamoDB persistence, customer-owned review/confirmation, durable sandbox POS delivery, kitchen/staff views and streaming voice integration. The recorded October 21 work also added voice-session cleanup, gateway-owned retry IDs and screen confirmation for orders and resets. Synthetic-audio tests and a live-response demo were recorded. The response-concision change has automated tests but still needs live verification.

## 29377 — Short reviewer answer

Use the [local reviewer instructions](reviewer-instructions.md). For the no-cloud route, use Node 22.12+, pnpm 11.25.0 and DynamoDB Local; explicitly set the loopback database endpoint before migration, seed and startup. The seeded local login is admin / harbor-demo-only. Open localhost:3100/lane/lane-1, begin a session, try the displayed example and correction, review and confirm, then inspect Kitchen.

Fixture inputs are predefined, but execute real MCP calls and persistent ordering logic. Free-form live speech is separate and requires the reviewer's own authorized AWS/Bedrock access and incurs charges. No owner cloud credentials are shared. The selected recording shows Nova responses generated during the take, synthetic customer speech and mock POS delivery. Its public URL remains pending in the saved preparation record.

## 29056 — AI tools used while working on the project

Nova 2 Sonic provides live speech and tool use. Nova 2 Lite was used for menu/pricing evaluation. Polly Generative Matthew produced stock male customer speech and narration for the recorded demo. Codex assisted implementation review, voice-lifecycle fixes, regression testing, synthetic-audio QA and demo preparation. This is a browser-based Alexa+ concept simulation; no official Alexa SDK, Alexa hardware or voice cloning was used.

## Required product feedback — evidence-based draft

These drafts describe recorded behavior. Edit them to reflect your experience and complete the personal answer to question 5.

### 28303 — Which developer tools, APIs and SDKs did you use, and for what?

- **Bedrock, Nova 2 Sonic and AWS SDK for JavaScript:** streamed speech, captions and model tool calls. **Nova 2 Lite:** separate menu/pricing evaluations.
- **DynamoDB, its JavaScript SDK and DynamoDB Local:** persistent ordering records, conditional transactions and isolated tests. Docker Compose or the documented Java helper runs local storage.
- **Polly Generative Matthew:** prerecorded synthetic customer speech and demo narration.
- **MCP TypeScript SDK and Zod:** Streamable HTTP discovery, tool calls, schemas and structured recovery.
- **Node.js, TypeScript, Express and ws:** server routes and authenticated voice transport. **Next.js, React and Tailwind CSS:** customer and staff screens.
- **Vitest, Playwright and MCP Inspector:** deterministic, browser and protocol checks; Inspector results identify their older tool-catalog checkpoint.
- **Codex:** coding/QA assistance. **pnpm, tsx, ESLint, TypeScript compiler and tsup:** development, checks and builds. **FFmpeg and Pillow:** video/audio assembly, captions and visual overlays.

### 28304 — What worked well?

- **Bedrock/Nova and the AWS SDK:** completed synthetic-audio sessions delivered fresh audio and tools through the actual app. Outcomes could be compared with the stored cart.
- **DynamoDB/Local and its SDK:** conditional writes and isolated local datasets made concurrent edits, consent and delivery retries testable.
- **Polly:** stock Matthew clips gave repeatable male inputs without microphone capture or cloning.
- **MCP SDK/Zod:** discovered tool schemas and validated results kept model requests behind the same business rules used by the app.
- **Web/server stack:** the order board, quote and kitchen views displayed the same persisted selections.
- **Vitest/Playwright/Inspector:** executable checks exposed lifecycle races and contract problems. Each receipt records its scope.
- **Codex and the build/media tools:** source inspection, regression harnesses and reproducible MP4 assembly supported iteration.

### 28305 — What needs work?

- **Nova/Sonic integration:** the recorded cart showed a large drink although the input was scripted to request medium, and another spoken clarification corrected it. The exact acoustic cause is unresolved. Replies were verbose; a conflicting application prompt was corrected, but the new behavior is not live-verified.
- **AWS SDK/docs and CLI:** string-versus-object tool-schema examples needed reconciliation with a real stream. An expired CLI login blocked further live voice checks. The blocked follow-up needed a refreshed session.
- **MCP SDK:** consistent structured validation errors required a lower-level server API and explicit Zod envelopes. Protocol-version behavior needed direct testing.
- **Next.js:** the default bundler hit isolated-environment limitations; the documented webpack build passed.
- **Playwright/local test setup:** pinned browser versions, port selection and fresh database namespaces matter. A passing browser mock is not a live-provider test.
- **Polly/media workflow:** successful synthesis does not establish intelligibility or naturalness. The installed CLI's streaming command required explicit flags; JSON input alone failed locally before any provider request.
- The remaining observations concern application code or local setup. No separate vendor defect was identified for React, Tailwind, Express, ws, Zod, DynamoDB, Vitest or the build/media tools.

### 28306 — How was onboarding, from zero to hello world?

The setup record lists the steps but includes no measured setup time or personal rating.

Bedrock required an existing AWS identity, region/model selection, server-side credentials, PCM framing and a working streaming/tool-schema example. DynamoDB needed a selected table or an explicit local endpoint; Docker or Java was needed only for local storage. Polly used the existing account and stock voice discovery before synthesis.

MCP setup required pinning the SDK/protocol combination, checking discovery over HTTP and making the schemas agree at both ends. The Node/Next/React/Tailwind stack used the repository's pinned dependencies. Playwright needed the matching Chromium build and isolated ports/data. Vitest, TypeScript, ESLint and tsup supplied the local checks. Codex assisted those steps; FFmpeg/Pillow handled the separate recording build.

**Owner:** add your onboarding experience.

### 28307 — Would you build with these devices and services again?

**OWNER ANSWER NEEDED.**

Choose Yes or No, with a reason for each tool/service group above. The stack supported a working prototype and repeatable tests. Live voice still needs human speech, noisy-audio testing and a real POS trial before a production decision. This project did not test Alexa or Fire TV hardware.

Complete this answer personally and review the technical observations in questions 1–4.

## 28300 — Optional feature requests

Draft suggestions for owner review:

- **Important — provider streaming examples:** one maintained end-to-end Nova example covering current model ID, tool schemas, interruption, final usage and cleanup would reduce integration ambiguity.
- **Important — protocol diagnostics:** clearer structured schema/validation errors across MCP server abstraction levels would make recovery easier to implement.
- **Nice-to-have — speech QA fixtures:** documented test-audio and transcript-alignment examples would help separate recognition failures from application state errors.
