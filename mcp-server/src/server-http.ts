#!/usr/bin/env node
/**
 * Streamable HTTP entry point for remote/networked access.
 *
 * Stateless design: a fresh McpServer + transport is created per request and
 * torn down when the response closes. This sidesteps session bookkeeping and
 * is safe because every tool call is an independent CLI invocation with no
 * server-side state to preserve between requests.
 */
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./mcp.js";

const PORT = Number(process.env.PORT ?? 3335);
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION });
});

app.post(MCP_PATH, async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("request handling failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode does not support the GET (server→client stream) or DELETE
// (session teardown) methods of the spec; answer with a clear 405.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed in stateless mode; POST a single request to " + MCP_PATH },
    id: null,
  });
};
app.get(MCP_PATH, methodNotAllowed);
app.delete(MCP_PATH, methodNotAllowed);

app.listen(PORT, () => {
  console.error(`${SERVER_NAME} ${SERVER_VERSION} listening on http://localhost:${PORT}${MCP_PATH}`);
});
