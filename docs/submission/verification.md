# SayGo — verification record, October 21, 2026

Each checkpoint below identifies the tested source and what it covers. Later source changes need their own verification record.

## Source selected for publication — October 21, 2026

The isolated test copy contained base commit `7cb44f47fc40bbe9e43945c83a6238dc0a11e7bf` plus the concise-prompt change in `packages/integrations/src/nova.ts` and its new `tests/unit/voice-delivery.test.ts`. Unrelated local AWS-default configuration/setup changes and generated `next-env` changes were excluded. That snapshot used DynamoDB Local by default. The current checkout defaults to AWS; [reviewer setup](reviewer-instructions.md) explicitly selects local storage.

| Check                                           | Result                                                          |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Vitest unit suite                               | **145 passed, 15 files**; includes two new prompt/caption tests |
| ESLint                                          | Passed                                                          |
| Root and web TypeScript checks                  | Passed                                                          |
| Next.js 16.4 production web build, webpack mode | Passed                                                          |
| Runtime and worker build, tsup                  | Passed                                                          |
| New inference/synthesis requests                | **None**                                                        |

The final unit run used an ephemeral loopback mock server after an earlier sandbox port-binding restriction. The successful web build used webpack; the default Turbopack build did not pass in that environment.

The two new tests inspect the prompt's response policy and preservation of complete error/safety captions. They do not establish that the model now speaks more briefly. The existing AWS session was expired, and no new live inference was performed.

## Older evidence with separate source scope

- **Earlier October 21 voice/backend checkpoint:** 61 integration passes plus one optional Inspector skip; 18 browser journeys passed with zero retries. These are not fresh integration/browser runs of the later concise-prompt publication diff.
- **Selected recorded demo:** one fresh Nova 2 Sonic session, 21 flow assertions, one screen-approved **$9.72** order, one approval and one SandboxPos receipt. The 106.672-second movie predates the concise-prompt change. See [demo provenance](demo.md).
- **Recorded media checks:** decoding, subtitle timing, waveform provenance/synchronization and browser playback passed. No perceptual listening or physical microphone test is claimed.

The recording used local changes and explicit test settings in addition to its base commit. Saved source hashes identify those changes. Full recording receipts remain with the owner; the repository includes a portable [summary](verification-summary.json).

## What still needs verification

Remaining checks include a fresh-clone installation, the concise prompt's effect on live reply length, human speech, noisy intercoms and commercial POS behavior. Follow the [reviewer instructions](reviewer-instructions.md) for local setup. The saved video predates the prompt change.

The [machine-readable summary](verification-summary.json) records the same checkpoints. [Submission checklist](submission-checklist.md) tracks published-license verification, the public video and owner-answer requirements.
