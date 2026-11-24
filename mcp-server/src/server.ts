#!/usr/bin/env node
/**
 * stdio entry point — the default transport for Claude Desktop / Claude Code /
 * IDE integrations. Speaks MCP over stdin/stdout; all logging goes to stderr so
 * it never corrupts the protocol stream on stdout.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./mcp.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} ${SERVER_VERSION} ready on stdio`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
