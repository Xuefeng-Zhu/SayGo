# SayGo submission record

**Submitted** to Build, Ship, Shape: Amazon Developer Hackathon on **October 23, 2026 at 08:27:56 PDT** (`2026-10-23T11:27:56.582-04:00`). [Public Devpost project](https://devpost.com/software/saygo-q2o7f4) · [Sanitized submission receipt](docs/submission/submission-receipt.json).

SayGo lets a customer speak an order, see and correct each change, hear the exact quote and approve it before it reaches the kitchen. Harbor Burger and its POS are fictional.

| Material | File |
| --- | --- |
| Project description | [Project story](docs/submission/project-story.md) |
| Technical and saved personal answers | [Devpost form answers](docs/submission/devpost-form-answers.md) |
| Setup without AWS credentials | [Reviewer instructions](docs/submission/reviewer-instructions.md) |
| Current film and provenance | [Recorded demo](docs/submission/demo.md) |
| Checks and source versions | [Verification scope](docs/submission/verification.md) |
| Integration feedback | [Friction log](docs/submission/friction-log.md) |
| Remaining submission steps | [Checklist](docs/submission/submission-checklist.md) |

## Current demo

`SayGo-submission-take08.mp4` is **179 seconds**, 1920×1080 H.264/AAC with English captions. It includes a problem animation, a continuous 134-second slice of successful take 08, and animated Nova/MCP/DynamoDB data flows. Prerecorded Polly Matthew customer speech and narration accompany fresh Nova 2 Sonic Tiffany restaurant replies.

The MCP log stays visible through ordering, correction, information reads, a dismissed reset proposal, exact readback and sealed spoken approval. Sixteen successful Voice calls cover ten of eleven registered tools; staff help is intentionally skipped. One accepted **$9.72** order and its matching kitchen ticket contain one Classic Burger without onions and one medium lemonade without ice.

The take uses remote DynamoDB, an isolated namespace and SandboxPos. The recorded source is `2b6dc36` plus fingerprinted local changes. No physical microphone, real restaurant order, payment or native Alexa+ deployment is claimed.

**Public YouTube video:** [SayGo — voice ordering and technical demo](https://www.youtube.com/watch?v=vc-iBxxVerc). No hosted application URL has been verified; reviewers can use the credential-free local fixture route.

## Repository and publication

The [repository](https://github.com/Xuefeng-Zhu/SayGo) was verified public with an MIT license on October 23 at `2b6dc36`. The judged implementation and packet were published at **`42e8d43f64934da1506af6993d7a1e160d65cb48`**. This follow-up records submission status only; application, runtime and tests remain unchanged. Original source and documentation use [MIT](LICENSE); third-party materials, generated media, audio and model assets retain their terms in [notices](THIRD_PARTY_NOTICES.md).

The live API and form verify entry **1255219** as **Submitted**, with **5/5** steps complete. Alexa+, AWS Builder and the Open Source Mini Challenge remain selected. The October 23 amendment strengthens the impact story, names all AWS services and MCP/Zod roles, adds `amazon-polly` and `zod` tags, and includes three full friction entries directly in feedback Question 3; the dedicated friction URL is retained. Onboarding times were not recorded, so no estimates are invented. Eight amended answers were verified exactly and the other 22 answers were preserved.

The Open Source entry now links the new additional MIT project [mcp-validation-envelope](https://github.com/Xuefeng-Zhu/mcp-validation-envelope), at [commit `9bb2bda`](https://github.com/Xuefeng-Zhu/mcp-validation-envelope/commit/9bb2bda70521fd074ac95f95461da8c101278db4). It has a runnable MCP SDK example and **12 passing tests**, independently repeated from a fresh public clone with a locked dependency install. See [contribution scope](docs/submission/open-source.md). The public 2:59 video and five-image gallery remain in place. A fresh-machine SayGo reviewer setup remains unverified; see the [checklist](docs/submission/submission-checklist.md).
