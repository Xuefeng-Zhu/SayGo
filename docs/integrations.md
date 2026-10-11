# What is real, what is simulated

| Component          | Implemented path                                                                                  | Verified boundary                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| MCP                | Official TypeScript SDK 1.32.1; authenticated stateless Streamable HTTP; initialize/discover/call | Protocol 2025-11-25 integration test, nine tools, actual HTTP                          |
| Restaurant backend | PostgreSQL 17, Drizzle schema/seed, SQL migrations/transactions                                   | Local unit/integration and browser workflows                                           |
| POS                | Persistent local SandboxPos adapter, stable keys, rejection/delay/unknown and lookup              | Local reconciliation, leases, receipt uniqueness; not a commercial POS                 |
| Nova 2 Sonic       | AWS SDK 3.1149.0 bidirectional stream + HTTP/2 transport                                          | Implemented/types checked; live credentials, microphone and speech accuracy unverified |
| Web simulator      | SayGo-owned Next.js interface, microphone/text/fixture options                                    | No-key fixture + browser UI verified; not Amazon's official simulator                  |
| Native Alexa+      | Future integration                                                                                | Not registered, deployed, certified or tested                                          |
| Payments/intercom  | Outside MVP                                                                                       | No payment capture/provider or live staff audio connection                             |

## Competition preflight, checked October 10, 2026

The current [Build, Ship, Shape rules](https://amazonappdev2026.devpost.com/rules) support the Alexa+ agent-skill/self-hosted MCP track and specify MCP 2025-11-25 or later. The submission period ends October 23, 2026 at noon Pacific. Source and working integration matter; a README mention is not an SDK integration. The rules include a September 16 repository-requirement update and an October 7 notice that AWS credits are exhausted. Do not assume credits, eligibility, partner access or acceptance. Recheck rules and [FAQ](https://amazonappdev2026.devpost.com/details/faqs) at submission time; no entry was submitted here.

The [official SDK v1 maintenance README](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) explicitly supports the 2025-11-25 specification. Its newer v2 line is a different package split and specification; this MVP intentionally pins the maintained v1 compatibility line used in the tests. [Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Future Food Ordering SPI mapping — NOT implemented native registration

Amazon's public [Category SDK overview](https://developer.amazon.com/docs/alexaplus/add-ons/overview-category-sdk.html) places Food Ordering on the Action path. A custom MCP ordering server is not automatically a native Food Ordering add-on. The public [Food Ordering SPI](https://developer.amazon.com/docs/alexaplus/add-ons/food-ordering-spi.html) defines the following useful operations; this table is a conceptual adapter mapping, not an assertion that the contracts are interchangeable.

| SayGo domain responsibility     | Candidate SPI operation(s)                                     | Unresolved adapter work                                                                          |
| ------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Menu/products/stock             | BatchGetMenuItems, GetMenuItem, GetRestaurantAvailability      | Map menu identifiers, choice model and availability responses exactly                            |
| Initial purchase and cart lines | CreatePurchase, CreateCartItem, UpdateCartItem, DeleteCartItem | Purchase/cart lifecycles, API error semantics, authentication/permission model                   |
| Server quote                    | PreviewPurchase                                                | Required customer permissions/data and canonical price/fulfillment mapping                       |
| Customer-approved submission    | SubmitPurchase                                                 | Native consent/checkout requirements, payment-at-window feasibility and notification permissions |
| Status and cancellation handoff | GetPurchase, SearchOrders, CancelPurchase                      | Supported amendments/cancellation and actual commercial POS acknowledgement                      |

The public SPI's pickup-related capabilities do **not** prove support for drive-through lane identity, vehicle detection, shared commercial devices, intercom routing or external payment at a window. Those questions need partner confirmation, exact fulfillment/payment validation, native authentication and permissions, partner tooling, certification and real-device/shared-history tests. No extra SPI fields, fake registration or presumed certification are introduced.

Also reviewed: [tool/data design](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-tools-schema-data-design.html), [Alexa+ lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html). Our isolation applies to our own web sessions only; it does not clear Alexa's conversation history.
