import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function inspectMcp(url: string, token: string) {
  const directory = await mkdtemp(join(tmpdir(), "saygo-mcp-inspector-"));
  const path = join(directory, "config.json");
  const storage = join(directory, "storage");
  try {
    await writeFile(
      path,
      JSON.stringify({
        mcpServers: {
          saygo: {
            type: "http",
            url,
            protocolEra: "legacy",
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }),
      { mode: 0o600 },
    );
    const run = async (args: string[]) => {
      try {
        const { stdout } = await promisify(execFile)(
          "pnpm",
          [
            "dlx",
            "@modelcontextprotocol/inspector@2.10.1",
            "--cli",
            "--config",
            path,
            "--server",
            "saygo",
            "--format",
            "json",
            "--stored-auth-only",
            ...args,
          ],
          {
            env: {
              ...process.env,
              MCP_INSPECTOR_SECRET_STORE: "memory",
              MCP_STORAGE_DIR: storage,
              MCP_CLIENT_CONFIG_PATH: join(directory, "client.json"),
            },
            timeout: 30000,
            maxBuffer: 2 * 1024 * 1024,
          },
        );
        return JSON.parse(stdout);
      } catch (error) {
        // Never expose raw child output/config; an auth diagnostic may echo it.
        const code =
          error && typeof error === "object" && "code" in error
            ? error.code
            : "unknown";
        throw new Error(
          `MCP Inspector failed (exit ${code}); temporary credentials withheld.`,
        );
      }
    };
    return {
      initialized: await run(["--method", "initialize"]),
      listed: await run(["--method", "tools/list", "--strict"]),
      called: await run([
        "--method",
        "tools/call",
        "--tool-name",
        "get_cart",
        "--tool-args-json",
        "{}",
      ]),
    };
  } finally {
    await unlink(path).catch(() => {});
    // The read-only config and memory secret store should create no other files.
    await rmdir(storage).catch(() => {});
    await rmdir(directory);
  }
}
