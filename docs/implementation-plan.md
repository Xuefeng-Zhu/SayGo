# Implementation status

SayGo implements the four parts of the original brief: menu and cart, order delivery, voice, and staff controls. It serves one fictional restaurant and lane, with prices in integer USD cents and an 8% fixture tax.

## Implemented

| Area           | Behavior                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Menu and cart  | Persistent menu, versioned cart lines, correction receipts, draft Undo and customer-approved meal savings.                     |
| MCP            | Streamable HTTP, scoped sessions, eleven tools under [contract 0.5](mcp-contracts.md), strict schemas and retry guidance.      |
| Order delivery | Expiring quotes, separate customer approval, atomic order/outbox creation, POS sandbox reconciliation and kitchen tickets.     |
| Voice          | Server-side Nova 2 Sonic adapter, browser audio capture/playback and interruption handling. Customer approval uses the screen. |
| Staff controls | Takeover, draft editing, stock and price administration, staff access and retention controls.                                  |

The scripted examples use the same MCP and ordering logic as the voice path. They require no Bedrock calls. Storage uses AWS DynamoDB by default, with DynamoDB Local available for offline use and isolated tests.

## Verification

Each saved run names its tested source. The [evaluation history](evaluation.md) retains local checks, earlier failures, provider usage and source manifests. [Submission verification](submission/verification.md) describes the October 21 selected-source checks and their limits.

The October 14 text-model suites each passed **10/10** on the same [preserved source](evidence/model-fix-source-manifest-20261014.json), before contract 0.5. The October 20 combined-source checks passed **124 unit and 61 integration tests**, plus lint and typecheck; browser, build and provider checks were not rerun for that checkpoint. [Receipt](evidence/model-fix-prepush-20261020.json).

A separate [AWS DynamoDB check](evidence/aws-dynamodb-smoke.json) covered persistence, duplicate submissions, competing workers, recovery and isolation. The [recorded October 21 demo](submission/demo.md) used prerecorded customer speech, fresh Sonic replies and screen confirmation. Those recordings do not establish physical microphone or speaker behavior.

## Remaining work

1. Verify the current voice and approval flow with physical microphones and speakers. Cover ordering, interruption, correction, spoken prices, screen approval, permission denial, reconnect and staff takeover. Expand browser and noise coverage separately.
2. Check a fresh clone against the [reviewer instructions](submission/reviewer-instructions.md), review current competition requirements and final claims, and complete the publication and participant steps in the [submission checklist](submission/submission-checklist.md).
3. Before shared hosting, configure and test routing, HTTPS/WSS, private credentials and the operational checks in [security and privacy](security-privacy.md). Native Alexa+, commercial POS/intercom hardware and payments need separate integrations.

Further provider trials require an approved scope and spending limit. The October 14 text follow-up recorded **$0.79827264** against **$1.50** approved; the [prior approval](evidence/provider-budget-close-20261014.json) retains a separate **$0.25** reservation for an unknown voice outcome. [Accounting receipt](evidence/model-fix-verification-20261014.json).
