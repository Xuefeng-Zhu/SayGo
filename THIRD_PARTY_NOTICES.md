# Third-party notices and license scope

The root [MIT License](LICENSE), copyright (c) 2026 Xuefeng Zhu, applies to original SayGo source code and associated documentation authored for this project.

It does not relicense third-party packages, trademarks, hosted services, model weights, voices, recordings or generated media. Those remain subject to their respective rights and terms. The reference design image and recorded application screenshots under documentation are media, outside this MIT grant. No model weights or raw speech/video files are distributed in this repository.

## Bundled Next.js guidance

The generated guidance block in [apps/web/AGENTS.md](apps/web/AGENTS.md) comes from Next.js, as its own comments identify. Next-generated type declarations are also upstream boilerplate. These are not represented as owner-authored material. The original [Next.js MIT notice](third_party/licenses/next-MIT.txt) is retained for that bundled guidance; SayGo's copyright notice does not replace it.

## Runtime dependencies

The following direct runtime dependencies were checked against their installed package metadata and license files. They are installed through pnpm rather than vendored into SayGo source.

| Package | Pinned version | Upstream license |
| --- | --- | --- |
| @aws-sdk/client-bedrock-runtime | 3.1149.0 | Apache-2.0 |
| @aws-sdk/client-dynamodb | 3.1149.0 | Apache-2.0 |
| @aws-sdk/lib-dynamodb | 3.1149.0 | Apache-2.0 |
| @smithy/node-http-handler | 4.12.1 | Apache-2.0 |
| @modelcontextprotocol/sdk | 1.32.1 | MIT |
| dotenv | 16.6.1 | BSD-2-Clause |
| express | 5.3.0 | MIT |
| ws | 8.22.0 | MIT |
| zod | 4.6.5 | MIT |
| next | 16.4.0 | MIT |
| react | 19.3.0 | MIT |
| react-dom | 19.3.0 | MIT |

Retain upstream copyright, license and NOTICE files when redistributing dependencies or built artifacts, as their licenses require. Transitive dependencies and development tools keep their own terms; the table is not a complete transitive-license inventory. No upstream license or notice file was removed or changed by this licensing update.

Amazon Bedrock/Nova, Amazon Polly and AWS are external services. SayGo's MIT license grants no rights to their services, models, stock voices, brands or generated output. Access and use require the applicable provider terms. The demo uses prerecorded Polly Matthew input/narration, fresh Nova Tiffany replies and a local mock POS; this notice does not change that provenance.
