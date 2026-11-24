# sprintly-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes the full
[`sprintly`](../README.md) CLI surface as typed tools, so any MCP-capable agent
(Claude Desktop, Claude Code, IDE extensions, custom clients) can drive
sprintly.cloud directly.

## How it works

This server is a **thin wrapper** around the installed `sprintly` binary. Each
tool call spawns the CLI as a subprocess and returns its output — it does **not**
re-implement the sprintly.cloud REST API. That means authentication, token
refresh, session storage and output formatting are all reused from the CLI you
already trust. One typed MCP tool maps to one CLI subcommand.

```
MCP client ──JSON-RPC──▶ sprintly-mcp ──spawn──▶ sprintly CLI ──HTTPS──▶ sprintly.cloud
```

## Prerequisites

- **Node.js ≥ 20** (developed on v24).
- The **`sprintly` CLI installed and on `PATH`** (or at `~/.sprintly/bin/sprintly`).
  Install via `curl -fsSL https://get.sprintly.cloud/install.sh | sh`.
- **An active session.** Run `sprintly login --url https://<you>.sprintly.cloud`
  in a terminal once. The `sprintly_login` tool can also do this, but interactive
  device-code login is usually smoother from a real shell.

## Build & test

```bash
cd mcp-server
npm install
npm run build      # tsc → dist/
npm test           # vitest: pure argv-builder + result-mapping tests
```

## Run

**stdio** (default; for Claude Desktop / Claude Code / IDEs):

```bash
npm run start              # node dist/server.js
# or, without building, in dev:
npm run dev                # tsx src/server.ts
```

**Streamable HTTP** (for remote/networked clients):

```bash
npm run start:http         # listens on http://localhost:3335/mcp
PORT=4000 npm run start:http
```

`GET /healthz` returns a small JSON status object. The HTTP transport is
stateless: each request gets a fresh server instance, which is safe because
every tool call is an independent CLI invocation.

## Register with an MCP client

> Two different concepts share the word "plugin". In Copilot/Cursor/VS Code,
> "adding an MCP server" *is* the unit of extension — there is no separate
> plugin. In Claude Code there are two layers: (1) simply **registering an MCP
> server** (shown below — works immediately), and (2) a **plugin**, a bundle
> (commands + agents + skills + MCP) installed from a *marketplace* via
> `claude plugin install`. A plugin just carries the same MCP server inside.

Build first so `dist/server.js` exists:

```bash
cd mcp-server && npm install && npm run build
```

### 1. Claude Code (CLI)

**Fastest path** — register the built server with a single command:

```bash
claude mcp add sprintly -- node /home/ubi24/Documents/projects/arij/sprintly-cli/mcp-server/dist/server.js
```

The `--` separates `claude`'s own flags from the server command; everything
after it is passed verbatim to the server. Verify with `claude mcp list`, then
inspect the live connection inside a session with `/mcp`.

Choose where the registration is stored with `--scope`:

| Scope | Flag | Stored in | Visible to |
| --- | --- | --- | --- |
| Local (default) | *(none)* | project-local user settings | only you, only this project |
| Project | `--scope project` | `.mcp.json` at the repo root | the whole team (committed to git) |
| User | `--scope user` | your global Claude Code config | you, in every project |

HTTP transport instead of stdio (requires `npm run start:http` to be running):

```bash
claude mcp add --transport http sprintly http://localhost:3335/mcp
```

**Alternatively**, drop a `.mcp.json` at the repo root — Claude Code
auto-detects it and prompts for approval on next launch. A ready template lives
at `mcp-server/.mcp.json.example`; copy it up one level and set the absolute
path:

```json
{
  "mcpServers": {
    "sprintly": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/server.js"]
    }
  }
}
```

### 2. GitHub Copilot (VS Code)

Copilot reads `.vscode/mcp.json`. Note the top-level key is `servers` (not
`mcpServers`) and each entry declares its `type`:

```json
{
  "servers": {
    "sprintly": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/server.js"]
    }
  }
}
```

For the HTTP transport, use `"type": "http"` with a `"url"` field instead of
`command`/`args`. After saving, enable the server from the Command Palette
(**MCP: List Servers** → start `sprintly`), then pick its tools in Copilot Chat
(Agent mode → the tools picker).

### Claude Desktop

Add an `mcpServers` block (same shape as the Claude Code `.mcp.json` above) to
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the
equivalent on your OS, then restart the app.

## Configuration

| Variable      | Effect                                                                 |
| ------------- | ---------------------------------------------------------------------- |
| `SPRINTLY_BIN`| Override the CLI path. Otherwise: `sprintly` on `PATH`, then `~/.sprintly/bin/sprintly`. |
| `PORT`        | HTTP transport port (default `3335`).                                  |
| `MCP_PATH`    | HTTP transport route (default `/mcp`).                                 |

## Tools

19 tools, one per CLI subcommand. Read-only tools are annotated
`readOnlyHint`; `sprintly_logout` is annotated `destructiveHint`.

| Tool | Wraps | Notes |
| --- | --- | --- |
| `sprintly_login` | `login` | Defaults to headless device-code; **blocks** until pairing completes (~5 min timeout). |
| `sprintly_logout` | `logout` | Destructive: revokes the session. |
| `sprintly_projects` | `projects` | |
| `sprintly_statuses` | `statuses` | `CLOSED` column flags terminal states. |
| `sprintly_priorities` | `priorities` | |
| `sprintly_types` | `types` | |
| `sprintly_activities` | `activities` | |
| `sprintly_sprints` | `sprints --project` | |
| `sprintly_custom_fields` | `custom-fields` | Optional `type` / `project` filters. |
| `sprintly_users` | `users` | Look up numeric user ids (e.g. for watchers). |
| `sprintly_issue_show` | `issue show` | `id` is positional; `comments` adds journal notes. |
| `sprintly_issue_list` | `issue list` | Array filters are OR within a field, AND across fields. |
| `sprintly_issue_create` | `issue create` | `jsonBody` / `jsonFile` for templated payloads. |
| `sprintly_issue_update` | `issue update` | `notes` appends a journal comment. |
| `sprintly_wiki_list` | `wiki list` | Project by numeric id or slug. |
| `sprintly_wiki_show` | `wiki show` | Pages are keyed by title. |
| `sprintly_wiki_edit` | `wiki edit` | Upsert by title; `text` piped via stdin. |
| `sprintly_version` | `version` | |
| `sprintly_update` | `update` | Self-updates the CLI binary. |

### Formatting rule (important)

`description`, `notes` and wiki `text` render as HTML in the web UI. Use
**primitive HTML** only — `<p>`, `<h2>`/`<h3>`, `<b>`/`<i>`, `<ul>`/`<ol><li>`,
`<code>`, `<pre>`, `<br>`. **Markdown is not interpreted** and shows up as raw
`**asterisks**` / `#` in the UI.

### Known gaps (inherited from the CLI)

- **No delete.** Close an issue by setting its status to a Done/closed status
  (see `sprintly_statuses`).
- **No standalone comment tool.** Use `sprintly_issue_update` with `notes`.

## Project layout

```
mcp-server/
├── src/
│   ├── sprintly.ts      # binary resolution + subprocess runner
│   ├── tools.ts         # tool catalogue: pure argv builders + registration
│   ├── mcp.ts           # McpServer factory shared by both transports
│   ├── server.ts        # stdio entry point
│   ├── server-http.ts   # Streamable HTTP entry point
│   └── tools.test.ts    # vitest: argv mapping + result mapping
├── .mcp.json.example
├── tsconfig.json
└── package.json
```

The argv-building in `tools.ts` is kept pure and separate from process
execution, so the "tool input → CLI flags" mapping is unit-tested without a
live session.
