# SayGo submission draft

Preparation snapshot: October 21, 2026, with documentation updated for the published source. This is the submission packet for Build, Ship, Shape: Amazon Developer Hackathon.

SayGo is a drive-through ordering assistant. Customers can see and correct the draft, review an exact quote, and approve the order before it reaches the kitchen. Harbor Burger is fictional; delivery uses a local POS sandbox.

## Submission materials

| Material                                             | File                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| Project description                                  | [Project story](docs/submission/project-story.md)                 |
| Technical form answers and unanswered entrant fields | [Devpost form answers](docs/submission/devpost-form-answers.md)   |
| Setup without AWS credentials                        | [Reviewer instructions](docs/submission/reviewer-instructions.md) |
| Video details and screenshots                        | [Recorded demo](docs/submission/demo.md)                          |
| Test results and source versions                     | [Verification scope](docs/submission/verification.md)             |
| Integration feedback                                 | [Friction log](docs/submission/friction-log.md)                   |
| Remaining submission steps                           | [Checklist](docs/submission/submission-checklist.md)              |

## Demo

The selected video is `SayGo-live-AI-male-demo.mp4`: **106.672 seconds**, 1920×1080, with English captions. It shows prerecorded Polly Generative Matthew customer speech and narration, Nova 2 Sonic Tiffany replies generated during the recording, DynamoDB Local, and one screen-approved **$9.72** sandbox order. An additional spoken clarification corrects a drink-size mismatch.

The recording is based on `7cb44f4` with local changes. It predates the concise-response prompt. It uses no physical microphone and places no real restaurant order or payment.

**Public YouTube or Vimeo URL: pending in the saved preparation record.** The private Library copy does not provide the required public link. No hosted application URL has been verified; reviewers can use the local setup.

The older 2:36 fixture video is documented separately in [historical demo notes](docs/demo-and-submission.md).

## Repository and license

The October 21 [publication record](docs/submission/verification-summary.json) verified the [public repository](https://github.com/Xuefeng-Zhu/SayGo) and MIT license. Original SayGo source and documentation are covered by [LICENSE](LICENSE), copyright 2026 Xuefeng Zhu. Third-party packages, generated media, audio and model assets retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Before submission

Add the public video URL, complete the entrant declarations and future-use feedback, review the proposed track choices, and check the final preview. Reconcile the published source with the setup instructions and dated evidence. The [checklist](docs/submission/submission-checklist.md) records the remaining items; it does not establish that an entry has been submitted.
