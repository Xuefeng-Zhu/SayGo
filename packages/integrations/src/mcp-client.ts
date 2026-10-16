import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { config } from "@saygo/db";
import {
  recoveryFor,
  recoverySchema,
  toolOutputSchemas,
  type Recovery,
  type ToolName,
} from "@saygo/contracts";
export class McpCallError extends Error {
  readonly recovery: Recovery;
  constructor(recovery: Recovery | string) {
    const detail =
      typeof recovery === "string"
        ? recoveryFor("INVALID_ARGUMENTS", recovery)
        : recoverySchema.parse(recovery);
    super(detail.message);
    this.recovery = detail;
  }
}
export function decodeToolResult(
  name: ToolName,
  raw: unknown,
  isError = false,
): Record<string, unknown> {
  const parsed = toolOutputSchemas[name].safeParse(raw);
  if (!parsed.success || parsed.data.result.ok === isError)
    throw new McpCallError({
      code: "INVALID_TOOL_RESULT",
      message:
        "The tool returned an invalid result. Check canonical state; do not replay a write blindly.",
      retryable: false,
      next_action: name === "submit_order" ? "reconcile_order" : "refresh_cart",
    });
  if (!parsed.data.result.ok) throw new McpCallError(parsed.data.result.error);
  return parsed.data.result.data;
}
function uncertainResult(name: string): Recovery {
  const readOnly = [
    "find_meal_savings",
    "get_menu",
    "get_item_details",
    "compare_menu_prices",
    "get_cart",
    "get_order_status",
  ].includes(name);
  return {
    code: "TRANSPORT_ERROR",
    message: readOnly
      ? "The read did not complete. Retry the read if the session is still active."
      : "The response was lost; the write may have committed. Reconcile canonical state before retrying with the original request ID or quote ID.",
    retryable: readOnly,
    next_action: readOnly
      ? "retry_read"
      : name === "submit_order"
        ? "reconcile_order"
        : "refresh_cart",
  };
}
function rethrowKnownFailure(error: unknown): void {
  if (error instanceof McpCallError) throw error;
  if (error instanceof McpError && error.code !== ErrorCode.RequestTimeout)
    throw new McpCallError({
      code: "PROTOCOL_ERROR",
      message:
        "The MCP exchange failed validation. Check canonical state and the client/server contracts before retrying.",
      retryable: false,
      next_action: "contact_staff",
    });
}
export async function openMcp(token: string) {
  const client = new Client({
    name: "saygo-conversation-gateway",
    version: "0.5.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${config.SAYGO_RUNTIME_PORT}/mcp`),
    {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (!response.ok) {
          const body = await response
            .clone()
            .json()
            .catch(() => null);
          const recovery = recoverySchema.safeParse(body?.recovery);
          if (recovery.success) throw new McpCallError(recovery.data);
        }
        return response;
      },
    },
  );
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return {
      tools,
      client,
      call: async (
        name: string,
        args: Record<string, unknown>,
      ): Promise<Record<string, unknown>> => {
        if (
          !Object.hasOwn(toolOutputSchemas, name) ||
          !tools.some((t) => t.name === name)
        )
          throw new McpCallError(
            recoveryFor("UNKNOWN_TOOL", "Choose a tool from tools/list."),
          );
        const started = performance.now();
        try {
          const result = await client.callTool({ name, arguments: args });
          return {
            ...decodeToolResult(
              name as ToolName,
              result.structuredContent,
              result.isError === true,
            ),
            timing: { tool_ms: Math.round(performance.now() - started) },
          };
        } catch (error) {
          rethrowKnownFailure(error);
          throw new McpCallError(uncertainResult(name));
        }
      },
      close: () => client.close(),
    };
  } catch (error) {
    await client.close().catch(() => {});
    rethrowKnownFailure(error);
    throw new McpCallError(uncertainResult("get_cart"));
  }
}
