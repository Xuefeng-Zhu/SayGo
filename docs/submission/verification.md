# SayGo — verification scope

This summary separates the source selected for publication from older live and regression evidence. It does not establish production reliability or completion of the Devpost entry.

## Fresh selected-source checks — October 21, 2026

The isolated test copy contained base commit `7cb44f47fc40bbe9e43945c83a6238dc0a11e7bf` plus the concise-prompt change in `packages/integrations/src/nova.ts` and its new `tests/unit/voice-delivery.test.ts`. Unrelated local AWS-default configuration/setup changes and generated `next-env` changes were excluded. The publication source retains DynamoDB Local as its default.

| Check                                           | Result                                                          |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Vitest unit suite                               | **145 passed, 15 files**; includes two new prompt/caption tests |
| ESLint                                          | Passed                                                          |
| Root and web TypeScript checks                  | Passed                                                          |
| Next.js 16.4 production web build, webpack mode | Passed                                                          |
| Runtime and worker build, tsup                  | Passed                                                          |
| New inference/synthesis requests                | **None**                                                        |

The final unit run used an authorized ephemeral loopback mock server. An earlier sandbox bind restriction was an execution-environment obstacle, not a product failure. The default Turbopack build is not claimed as passing; the successful web build used webpack.

The new tests inspect the prompt's response policy and preservation of complete error/safety captions. They do not establish that the model now speaks more briefly. The existing AWS session was expired, and no new live inference was performed.

## Older evidence with separate source scope

- **Earlier October 21 voice/backend checkpoint:** 61 integration passes plus one optional Inspector skip; 18 browser journeys passed with zero retries. These are not fresh integration/browser runs of the later concise-prompt publication diff.
- **Selected recorded demo:** one fresh Nova 2 Sonic session, 21 flow assertions, one screen-approved **$9.72** order, one approval and one SandboxPos receipt. The 106.672-second movie predates the concise-prompt change. See [demo provenance](demo.md).
- **Recorded media checks:** decoding, subtitle timing, waveform provenance/synchronization and browser playback passed. No perceptual listening or physical microphone test is claimed.

The recording's working tree includes local changes and explicit local test overrides. A base commit alone does not identify every recorded byte. Raw source fingerprints and recording receipts remain in owner QA artifacts; reviewers do not need private machine paths to use the published setup instructions.

## What still needs verification

A fresh clone should be checked against [reviewer instructions](reviewer-instructions.md) after publication. A clean-machine installation, the concise prompt's actual live reply length, human/noisy speech, intercom acoustics and commercial POS behavior have not been established. No new concise replacement movie exists.

The [machine-readable summary](verification-summary.json) records these same boundaries. [Submission checklist](submission-checklist.md) tracks the remaining license, public video and owner-answer requirements.
