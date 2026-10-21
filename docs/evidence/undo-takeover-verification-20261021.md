# Undo and human takeover verification

Verified locally on 21 October 2026, against this change based on `7ea2c375f0d47681d24a67bc5408ac1355c8cdc8`.

| Check                                       | Result                                           |
| ------------------------------------------- | ------------------------------------------------ |
| Deterministic unit tests                    | 152 passed across 15 files                       |
| DynamoDB Local / HTTP MCP integration tests | 67 passed; 1 optional MCP Inspector test skipped |
| Chromium browser tests                      | 22 passed across all 4 specs                     |
| ESLint and root/web TypeScript              | Passed                                           |
| Next.js webpack frontend build              | Passed                                           |
| Runtime and worker bundle build             | Passed                                           |

Coverage includes one-step draft Undo and quote invalidation, staff takeover/edit/resolve/release, explicit customer screen approval, accepted-ticket persistence, repeated and stale ownership requests, stale staff editors, pending audio capture, late socket events and failed-save input retention. Browser audio is generated in software and its voice WebSockets are intercepted; these are not speech-recognition results.

| Reproduction                                                                    | Fix and regression evidence                                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Repeat an ownership action, then deliver an old release or takeover retry       | Durable request identity and expected control fence preserve the current owner and resumed voice.     |
| Take control while voice is starting or tools are still finishing               | AI writes are fenced first; cleanup drains before completion, and old upgrades cannot register later. |
| Keep an editor or audio permission request open across control/customer changes | Scoped UI callbacks and editors reject the stale work; voice needs a fresh start after release.       |
| Ask for help repeatedly, then add a distinct allergy concern                    | Exact duplicate handoffs are deduplicated; the new concern remains available to staff.                |

The browser harness prewarms local development routes, keeps one operator login in memory per worker, and lets the existing write-rate window reset between specs. Product limits and business assertions remain unchanged. Early development-server reload/rate-limit failures and a missing fixture-completion wait were diagnosed before the final full run.

No live Nova call or physical microphone/speaker trial was performed for these changes. Fresh provider verification needs the existing AWS login renewed. The POS is the local fictional sandbox; no commercial restaurant order or payment was sent. The previously recorded live demo has not been replaced by this change.

See the [local walkthrough](../undo-and-takeover.md) for a demo that exercises these controls without provider calls. Passing these checks does not establish that every possible failure has been ruled out.
