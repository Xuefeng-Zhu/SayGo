# SayGo — verification record, October 23, 2026

Recording, current publication checks and historical runs have separate source identities. The current packet does not establish final publication or Devpost submission.

## Selected successful take and film

Take **08** uses `2b6dc36ff16b073bfc07b1c3982021373b6a4ac5` plus local changes, identified by the unchanged [217-file recorded manifest](recorded-source-manifest.json). Two fresh Nova 2 Sonic streams received prerecorded Polly Matthew customer audio. Remote DynamoDB held a fresh fictional namespace, which was removed afterward.

All **24** flow assertions passed. Sixteen successful actual **Voice** calls cover ten selected tool types; `request_staff_help` is intentionally omitted from the eleven registered tools. No order exists before sealed spoken capture. Natural provider completion precedes the verified voice approval and actual MCP submission. Exactly one accepted **$9.72** order/receipt and matching kitchen ticket contain one Classic Burger without onions and one medium lemonade without ice. The MCP log remains visible.

The selected film is **179 seconds**, 1920×1080 H.264/AAC, with 34 English caption cues. It contains one continuous 134-second slice of the successful take, plus a problem animation and animated technical flows. Nineteen independent media checks and full 1× sound-enabled browser playback passed. Actual partial/repeated replies remain in the take. Human subjective naturalness/listening acceptance is unverified. [Demo provenance](demo.md).

## Current source checks

The current publication source adds a narrow **Next.js 16.4.1** dependency patch and a route-teardown cleanup in `tests/e2e/voice-lifecycle.spec.ts` after recording. The application/runtime implementation remains the recorded version. The original take ran **16.4.0**; its fingerprints are unchanged and there is no provider retake. The [current manifest](current-source-manifest.json) identifies the patched snapshot and excludes generated `next-env.d.ts` and historical `output/` artifacts.

| Check | Current result and scope |
| --- | --- |
| Unit suite | **359 passed, 22 files**; post-patch rerun |
| Integration suite | **99 passed, one optional Inspector skip, 5 files**; unchanged backend against owned in-memory DynamoDB Local at `127.0.0.1:8000` |
| ESLint | Passed; post-patch rerun |
| Root and web TypeScript | Passed; post-patch rerun |
| Next.js production build | **16.4.1 webpack passed**; default Turbopack not run |
| Runtime and worker | tsup compilation passed |
| Browser suite | Full run: **33 passed, one route-teardown error**; after cleanup, **all 13 affected lifecycle journeys passed**; these are separate runs |
| New provider requests during this preparation | **None** |

The full browser run reached the expected staff-help state but one intercepted `/api/config` request outlived its test, producing `route.fetch: Test ended` during disposal. The test cleanup now awaits active routes before page disposal; the original failed full-run evidence is retained. All 13 lifecycle journeys, including the staff-help case, passed in the focused rerun. A wholly green full-suite rerun is not claimed. This is a test-harness change, with no application behavior or provider retake.

The first sandboxed unit/integration/database startup attempts hit local IPC/port restrictions. An integration retry also started before the database was ready. A final restricted-environment pnpm invocation aborted before lint/typecheck because its dependency-status install required a TTY; the same checks then passed in the authorized execution context. These failed environment attempts remain in owner-only logs; successful offline reruns use authorized local loopback access.

The first 16.4.0 webpack build compiled/generated routes, then stopped with `SecurityFatalError` and a known-vulnerability upgrade recommendation. The version and lockfile were narrowly patched after checking vendor advisories [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) and [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw). The patched webpack and Node builds passed. This does not establish that every dependency is vulnerability-free.

## Historical checkpoints

- **October 21 selected source:** `7cb44f4` plus the concise-prompt implementation/test passed 145 unit tests across 15 files, lint, root/web TypeScript, a webpack web build and runtime/worker builds. It was a different source snapshot.
- **Earlier October 21 voice/backend checkpoint:** 61 integration passes plus one optional Inspector skip; 18 browser journeys passed with zero retries. These remain historical, separate from present checks.
- **October 21 recorded movie:** 106.672 seconds, 21 flow assertions, DynamoDB Local and one screen-approved $9.72 order. It is superseded as the selected submission film.

## Remaining boundaries

Fresh-machine installation, physical microphones/speakers, human/noisy speech, outdoor intercoms, other accounts/regions, commercial POS and native Alexa+ remain unverified. The successful synthetic take does not establish broad reliability, acoustic barge-in or generally shorter replies. Follow [reviewer setup](reviewer-instructions.md) for credential-free fixtures.

[Portable machine-readable summary](verification-summary.json) preserves these scopes. Full raw recording, source snapshots, actual action timing, provider receipts, failed takes/renders and local test logs remain with the owner. The [public video](https://www.youtube.com/watch?v=vc-iBxxVerc) is published; final Devpost submission status is not established by this packet.
