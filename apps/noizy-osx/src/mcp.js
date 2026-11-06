import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { createSdk } from "./sdk.js";
import { schemas, invoke } from "./methods.js";

export function createMcpServer(sdk = createSdk()) {
  const server = new McpServer({ name: "noizy-osx", version: "0.1.0" });
  const descriptions = {
    capabilities:
      "List catalog metadata and explicit v1 boundaries; no runtime execution.",
    discover:
      "Check only catalog executable names in absolute PATH directories; no recursive scanning.",
    probe:
      "Run only the selected FOSS tool's fixed, bounded version command; no caller flags or paths.",
    recommend:
      "Recommend FOSS version probes based only on actual executable discovery.",
  };
  for (const [method, schema] of Object.entries(schemas)) {
    server.registerTool(
      `noizy_${method}`,
      {
        description: descriptions[method],
        inputSchema: schema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const structuredContent = await invoke(sdk, method, input);
          return {
            structuredContent,
            content: [
              { type: "text", text: JSON.stringify(structuredContent) },
            ],
          };
        } catch {
          return {
            isError: true,
            content: [{ type: "text", text: '{"error":"REQUEST_FAILED"}' }],
          };
        }
      },
    );
  }
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await createMcpServer().connect(new StdioServerTransport());
  } catch {
    process.stderr.write('{"error":"MCP_STARTUP_FAILED"}\n');
    process.exitCode = 1;
  }
}
