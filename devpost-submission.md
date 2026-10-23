# SayGo submission draft

Updated October 23, 2026 for Build, Ship, Shape: Amazon Developer Hackathon. This packet is prepared locally; it does not establish final Devpost submission.

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

The [repository](https://github.com/Xuefeng-Zhu/SayGo) was verified public with an MIT license on October 23 at `2b6dc36`. Current source and packet changes still require publication. Original source and documentation use [MIT](LICENSE); third-party materials, generated media, audio and model assets retain their terms in [notices](THIRD_PARTY_NOTICES.md).

The live form already contains the entrant's personal choices. Preserve those choices while replacing stale technical claims. Publish the selected source, verify the public video and final preview and obtain action-time consent before final submission. See the [checklist](docs/submission/submission-checklist.md).
