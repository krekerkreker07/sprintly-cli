/**
 * Server factory shared by both transports (stdio and Streamable HTTP).
 * Keeping construction in one place guarantees the two entry points expose an
 * identical tool surface.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "sprintly-mcp";
export const SERVER_VERSION = "0.1.0";

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools wrap the sprintly.cloud CLI. Resolve numeric IDs first via sprintly_projects / _statuses / " +
        "_types / _priorities / _sprints / _custom_fields, then act. Issue descriptions and notes must use " +
        "primitive HTML (<p>, <ul><li>, <code>…), never Markdown. There is no delete: close an issue by setting " +
        "its status to a Done/closed status.",
    },
  );
  registerTools(server);
  return server;
}
