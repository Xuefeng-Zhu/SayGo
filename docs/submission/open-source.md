# Open Source Mini Challenge — standalone companion

SayGo is accompanied by a new, additional MIT-licensed project: [mcp-validation-envelope](https://github.com/Xuefeng-Zhu/mcp-validation-envelope). It was published on October 23, 2026 at [commit `9bb2bda`](https://github.com/Xuefeng-Zhu/mcp-validation-envelope/commit/9bb2bda70521fd074ac95f95461da8c101278db4).

I created mcp-validation-envelope as a new, additional MIT-licensed TypeScript project alongside SayGo, published October 23, 2026. It extracts and generalizes the structured MCP recovery pattern developed while building SayGo; it has no SayGo runtime, database, voice or AWS dependency.

The package uses the official MCP SDK low-level Server with Zod validation inside the tools/call handler. Invalid arguments, declared application failures and successful results share an advertised, validated envelope with matching structuredContent and JSON text; isError distinguishes failure. Unexpected exceptions are sanitized, invalid inputs skip execution and unknown tools remain protocol errors.

It includes a runnable SDK client/server example, generated input/output schemas and 12 passing tests, including JSON-RPC correlation, output validation and thrown-validation-error redaction. The repository documents provenance, reusable installation and its in-memory verification scope. This gives other MCP developers a small, inspectable alternative when they need consistent machine-readable recovery from validation failures.

Run `npm ci`, `npm run check` and `npm run example` in that repository with Node 22.12 or later. The example uses the actual MCP SDK Client/Server over in-memory transport and requires no credentials or paid services. It does not claim HTTP, authentication, live-model or production verification. See the repository README, MIT license and verification receipt for scope.
