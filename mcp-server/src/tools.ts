/**
 * Tool catalogue: one typed MCP tool per sprintly CLI subcommand.
 *
 * Each spec keeps the argv-building (`build`) pure and separate from process
 * execution, so the mapping "tool input → CLI flags" is unit-testable without
 * a live session. `registerTools` wires every spec onto an McpServer.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runSprintly, isAuthError, type RunResult } from "./sprintly.js";

/** What a tool wants the CLI to do: argv plus optional stdin and timeout. */
export interface CommandPlan {
  args: string[];
  stdin?: string;
  timeoutMs?: number;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Pure: maps validated tool input to a CLI invocation plan. */
  build: (input: any) => CommandPlan;
  /** Advertised as read-only (no mutation) to MCP clients. */
  readOnly: boolean;
  /** Advertised as destructive (e.g. logout). */
  destructive?: boolean;
}

/* -------------------------------------------------------------------------- */
/* argv helpers                                                               */
/* -------------------------------------------------------------------------- */

type Scalar = string | number;

/** Push `flag value` once per element — used for repeatable OR-filters. */
export function pushRepeat(args: string[], flag: string, values?: Scalar[]): void {
  for (const v of values ?? []) args.push(flag, String(v));
}

/** Push `flag value` when the value is meaningfully present. */
export function pushFlag(args: string[], flag: string, value?: Scalar): void {
  if (value === undefined || value === null || value === "") return;
  args.push(flag, String(value));
}

/** Push a bare flag only when explicitly true. */
export function pushBool(args: string[], flag: string, value?: boolean): void {
  if (value === true) args.push(flag);
}

/**
 * Tristate flag: true→onFlag, false→offFlag, undefined→omit.
 * Encodes the CLI's `--is-private | --no-is-private` "don't touch" semantics.
 */
export function pushTristate(args: string[], onFlag: string, offFlag: string, value?: boolean): void {
  if (value === true) args.push(onFlag);
  else if (value === false) args.push(offFlag);
}

/* -------------------------------------------------------------------------- */
/* shared schema fragments                                                    */
/* -------------------------------------------------------------------------- */

const idRef = (label: string) => z.number().int().describe(label);
const assignee = z
  .union([z.number().int(), z.literal("me")])
  .describe("Assignee user ID, or 'me' for the signed-in user");

const HTML_NOTE =
  "Body uses primitive HTML tags only (<p>, <h2>, <h3>, <b>, <i>, <ul>/<ol><li>, <code>, <pre>, <br>). " +
  "Markdown (**bold**, # heading, backticks, - list) renders as raw syntax in the web UI — do NOT use it.";

/** Mutable fields shared by `issue create` and `issue update`. */
const issueBodyShape = {
  project: idRef("Project ID").optional(),
  type: idRef("Issue type ID (see sprintly_types)").optional(),
  status: idRef("Status ID (see sprintly_statuses)").optional(),
  priority: idRef("Priority ID (see sprintly_priorities)").optional(),
  subject: z.string().describe("Issue title").optional(),
  description: z.string().describe(`Issue description. ${HTML_NOTE}`).optional(),
  category: idRef("Category ID").optional(),
  sprint: idRef("Sprint ID (see sprintly_sprints)").optional(),
  assignee: assignee.optional(),
  parent: idRef("Parent issue ID").optional(),
  isPrivate: z
    .boolean()
    .describe("Tristate: true→--is-private, false→--no-is-private, omit→leave unchanged")
    .optional(),
  estimatedHours: z.number().describe("Estimated effort in hours (decimal)").optional(),
  startDate: z.string().describe("Start date YYYY-MM-DD").optional(),
  dueDate: z.string().describe("Due date YYYY-MM-DD").optional(),
  doneRatio: z.number().int().min(0).max(100).describe("Completion percent 0..100").optional(),
  watcher: z.array(z.number().int()).describe("Watcher user IDs (repeatable)").optional(),
  cf: z
    .array(z.string())
    .describe("Custom fields as 'FIELD_ID=VALUE'; repeat same id for multi-value (see sprintly_custom_fields)")
    .optional(),
  jsonBody: z
    .record(z.unknown())
    .describe("Base issue body as a JSON object; explicit fields above override its keys")
    .optional(),
  jsonFile: z.string().describe("Path to a JSON file with the base issue body; fields above override it").optional(),
};

/** Translate the shared issue body into CLI flags. */
function buildIssueBody(args: string[], i: Record<string, any>): string | undefined {
  pushFlag(args, "--project", i.project);
  pushFlag(args, "--type", i.type);
  pushFlag(args, "--status", i.status);
  pushFlag(args, "--priority", i.priority);
  pushFlag(args, "--subject", i.subject);
  pushFlag(args, "--description", i.description);
  pushFlag(args, "--category", i.category);
  pushFlag(args, "--sprint", i.sprint);
  pushFlag(args, "--assignee", i.assignee);
  pushFlag(args, "--parent", i.parent);
  pushTristate(args, "--is-private", "--no-is-private", i.isPrivate);
  pushFlag(args, "--estimated-hours", i.estimatedHours);
  pushFlag(args, "--start-date", i.startDate);
  pushFlag(args, "--due-date", i.dueDate);
  pushFlag(args, "--done-ratio", i.doneRatio);
  pushRepeat(args, "--watcher", i.watcher);
  pushRepeat(args, "--cf", i.cf);

  // JSON base body: object → stdin via --json-stdin; path → --json-file.
  let stdin: string | undefined;
  if (i.jsonBody !== undefined) {
    stdin = JSON.stringify(i.jsonBody);
    args.push("--json-stdin");
  } else if (i.jsonFile) {
    args.push("--json-file", String(i.jsonFile));
  }
  return stdin;
}

/* -------------------------------------------------------------------------- */
/* tool specs                                                                 */
/* -------------------------------------------------------------------------- */

export const toolSpecs: ToolSpec[] = [
  /* ---- auth ----------------------------------------------------------- */
  {
    name: "sprintly_login",
    title: "Login",
    description:
      "Authenticate and store an offline session. Defaults to headless device-code flow (prints a URL + code to enter " +
      "on another device); this call blocks until you complete pairing or it times out (~5 min).",
    readOnly: false,
    inputSchema: {
      url: z.string().describe("Base identity URL, e.g. https://acme.sprintly.cloud"),
      headless: z
        .boolean()
        .describe("Use device-code flow instead of opening a browser on the server host (default true)")
        .optional(),
    },
    build: (i) => {
      const args = ["login", "--url", String(i.url)];
      // Default to headless: the server process usually has no usable display,
      // and a browser launched on the host is useless to a remote MCP client.
      if (i.headless !== false) args.push("--headless");
      return { args, timeoutMs: 300_000 };
    },
  },
  {
    name: "sprintly_logout",
    title: "Logout",
    description:
      "Revoke the saved session and delete local credentials. DESTRUCTIVE — forces a fresh login afterwards. " +
      "Pass localOnly to skip server-side revocation and only delete the local file.",
    readOnly: false,
    destructive: true,
    inputSchema: {
      localOnly: z.boolean().describe("Only delete the local session file; skip server-side revocation").optional(),
    },
    build: (i) => {
      const args = ["logout"];
      pushBool(args, "--local-only", i.localOnly);
      return { args };
    },
  },

  /* ---- reference lookups --------------------------------------------- */
  {
    name: "sprintly_projects",
    title: "List projects",
    description: "List projects you have access to (ID, slug/identifier, name).",
    readOnly: true,
    inputSchema: {},
    build: () => ({ args: ["projects"] }),
  },
  {
    name: "sprintly_statuses",
    title: "List statuses",
    description: "List issue statuses with their numeric IDs; the CLOSED column flags terminal states.",
    readOnly: true,
    inputSchema: {},
    build: () => ({ args: ["statuses"] }),
  },
  {
    name: "sprintly_priorities",
    title: "List priorities",
    description: "List issue priorities with their numeric IDs.",
    readOnly: true,
    inputSchema: {},
    build: () => ({ args: ["priorities"] }),
  },
  {
    name: "sprintly_types",
    title: "List issue types",
    description: "List issue types with their numeric IDs.",
    readOnly: true,
    inputSchema: {},
    build: () => ({ args: ["types"] }),
  },
  {
    name: "sprintly_activities",
    title: "List activities",
    description: "List work-activity types with their numeric IDs.",
    readOnly: true,
    inputSchema: {},
    build: () => ({ args: ["activities"] }),
  },
  {
    name: "sprintly_sprints",
    title: "List sprints",
    description: "List sprints for one project.",
    readOnly: true,
    inputSchema: {
      project: idRef("Project ID"),
    },
    build: (i) => ({ args: ["sprints", "--project", String(i.project)] }),
  },
  {
    name: "sprintly_custom_fields",
    title: "List custom fields",
    description: "List custom-field definitions and value sets, optionally narrowed by issue type and/or project.",
    readOnly: true,
    inputSchema: {
      type: idRef("Filter by issue type ID").optional(),
      project: idRef("Filter by project ID").optional(),
    },
    build: (i) => {
      const args = ["custom-fields"];
      pushFlag(args, "--type", i.type);
      pushFlag(args, "--project", i.project);
      return { args };
    },
  },
  {
    name: "sprintly_users",
    title: "List users",
    description:
      "List backend users with substring/status/group filters. Use it to look up a numeric user id when 'me' " +
      "does not apply (e.g. setting a watcher or assigning to someone else).",
    readOnly: true,
    inputSchema: {
      name: z.string().describe("Substring search over login, email and full name").optional(),
      status: z.enum(["active", "locked", "registered"]).describe("Filter by account status").optional(),
      group: idRef("Filter by group ID").optional(),
      hideAdmin: z
        .boolean()
        .describe("Hide admin accounts (client-side; a no-op unless the caller is themselves an admin)")
        .optional(),
      include: z.array(z.string()).describe("Extras to fetch, e.g. ['memberships','groups']").optional(),
      limit: z.number().int().describe("Page size (default 25, max 100). Ignored with all=true").optional(),
      offset: z.number().int().describe("Skip first N users. Ignored with all=true").optional(),
      all: z.boolean().describe("Fetch every page until total_count").optional(),
      columns: z
        .array(z.string())
        .describe("Columns to render. Available: id,login,name,email,last-login,admin")
        .optional(),
    },
    build: (i) => {
      const args = ["users"];
      pushFlag(args, "--name", i.name);
      pushFlag(args, "--status", i.status);
      pushFlag(args, "--group", i.group);
      pushBool(args, "--hide-admin", i.hideAdmin);
      if (i.include?.length) pushFlag(args, "--include", i.include.join(","));
      pushFlag(args, "--limit", i.limit);
      pushFlag(args, "--offset", i.offset);
      pushBool(args, "--all", i.all);
      if (i.columns?.length) pushFlag(args, "--columns", i.columns.join(","));
      return { args };
    },
  },

  /* ---- issues --------------------------------------------------------- */
  {
    name: "sprintly_issue_show",
    title: "Show issue",
    description: "Print full detail for one issue. Pass comments=true to also list its journal notes.",
    readOnly: true,
    inputSchema: {
      id: idRef("Issue ID"),
      comments: z.boolean().describe("Also show comments (journal notes)").optional(),
    },
    build: (i) => {
      // NB: issue show takes the id as a POSITIONAL arg, not --id.
      const args = ["issue", "show", String(i.id)];
      pushBool(args, "--comments", i.comments);
      return { args };
    },
  },
  {
    name: "sprintly_issue_list",
    title: "List issues",
    description:
      "Search issues. Array filters are OR within a field and AND across fields. Use sprintly_statuses/_types/etc " +
      "to resolve numeric IDs first.",
    readOnly: true,
    inputSchema: {
      project: z.array(z.number().int()).describe("Project IDs (OR)").optional(),
      sprint: z.array(z.number().int()).describe("Sprint IDs (OR)").optional(),
      status: z
        .array(z.union([z.number().int(), z.enum(["open", "closed", "*"])]))
        .describe("Status IDs or the literals 'open' | 'closed' | '*' (OR)")
        .optional(),
      assignee: z.array(z.union([z.number().int(), z.literal("me")])).describe("Assignee IDs or 'me' (OR)").optional(),
      author: z.array(z.union([z.number().int(), z.literal("me")])).describe("Author IDs or 'me' (OR)").optional(),
      type: z.array(z.number().int()).describe("Issue type IDs (OR)").optional(),
      priority: z.array(z.number().int()).describe("Priority IDs (OR)").optional(),
      category: z.array(z.number().int()).describe("Category IDs (OR)").optional(),
      parent: idRef("Parent issue ID").optional(),
      subject: z.string().describe("Subject contains substring").optional(),
      createdOn: z.string().describe("Created-on query, e.g. '>=2026-01-01', '><2026-01-01|2026-06-30', 't', 'lw'").optional(),
      updatedOn: z.string().describe("Updated-on query (same syntax as createdOn)").optional(),
      startDate: z.string().describe("Start-date query (same syntax)").optional(),
      dueDate: z.string().describe("Due-date query (same syntax)").optional(),
      doneRatio: z.number().int().min(0).max(100).describe("Completion percent filter").optional(),
      isPrivate: z.boolean().describe("Filter by privacy flag (tristate)").optional(),
      cf: z.array(z.string()).describe("Custom-field filters as 'FIELD_ID=VALUE' (repeatable)").optional(),
      sort: z.string().describe("Sort, e.g. 'priority:desc,updated_on:desc'").optional(),
      columns: z
        .array(z.string())
        .describe(
          "Columns to render. Available: id,subject,project,type,status,priority,author,assignee,category,sprint," +
            "parent,start-date,due-date,done-ratio,estimated-hours,is-private,created,updated,description; CF via 'cf:<id>'",
        )
        .optional(),
      limit: z.number().int().describe("Page size (default 25, max 100). Ignored with all=true").optional(),
      offset: z.number().int().describe("Skip first N issues. Ignored with all=true").optional(),
      all: z.boolean().describe("Fetch every page until total_count").optional(),
    },
    build: (i) => {
      const args = ["issue", "list"];
      pushRepeat(args, "--project", i.project);
      pushRepeat(args, "--sprint", i.sprint);
      pushRepeat(args, "--status", i.status);
      pushRepeat(args, "--assignee", i.assignee);
      pushRepeat(args, "--author", i.author);
      pushRepeat(args, "--type", i.type);
      pushRepeat(args, "--priority", i.priority);
      pushRepeat(args, "--category", i.category);
      pushFlag(args, "--parent", i.parent);
      pushFlag(args, "--subject", i.subject);
      pushFlag(args, "--created-on", i.createdOn);
      pushFlag(args, "--updated-on", i.updatedOn);
      pushFlag(args, "--start-date", i.startDate);
      pushFlag(args, "--due-date", i.dueDate);
      pushFlag(args, "--done-ratio", i.doneRatio);
      pushTristate(args, "--is-private", "--no-is-private", i.isPrivate);
      pushRepeat(args, "--cf", i.cf);
      pushFlag(args, "--sort", i.sort);
      if (i.columns?.length) pushFlag(args, "--columns", i.columns.join(","));
      pushFlag(args, "--limit", i.limit);
      pushFlag(args, "--offset", i.offset);
      pushBool(args, "--all", i.all);
      return { args };
    },
  },
  {
    name: "sprintly_issue_create",
    title: "Create issue",
    description:
      "Create a new issue. project, type and subject are required unless supplied via jsonBody/jsonFile. " +
      HTML_NOTE,
    readOnly: false,
    inputSchema: { ...issueBodyShape },
    build: (i) => {
      const args = ["issue", "create"];
      const stdin = buildIssueBody(args, i);
      return { args, stdin };
    },
  },
  {
    name: "sprintly_issue_update",
    title: "Update issue",
    description:
      "Update an existing issue and/or append a journal comment. Provide notes to add a comment (the only way to " +
      `comment without otherwise mutating the issue). ${HTML_NOTE}`,
    readOnly: false,
    inputSchema: {
      id: idRef("Issue ID to update"),
      ...issueBodyShape,
      notes: z.string().describe(`Append a journal comment. ${HTML_NOTE}`).optional(),
      privateNotes: z.boolean().describe("Tristate: mark the appended note private").optional(),
    },
    build: (i) => {
      const args = ["issue", "update", "--id", String(i.id)];
      const stdin = buildIssueBody(args, i);
      pushFlag(args, "--notes", i.notes);
      pushTristate(args, "--private-notes", "--no-private-notes", i.privateNotes);
      return { args, stdin };
    },
  },

  /* ---- wiki ----------------------------------------------------------- */
  {
    name: "sprintly_wiki_list",
    title: "List wiki pages",
    description: "List wiki pages of one project. Pagination is client-side (no total_count, so no fetch-all).",
    readOnly: true,
    inputSchema: {
      project: z.union([z.number().int(), z.string()]).describe("Project numeric ID or identifier (slug)"),
      limit: z.number().int().describe("Page size (default 25)").optional(),
      offset: z.number().int().describe("Skip first N pages").optional(),
    },
    build: (i) => {
      const args = ["wiki", "list", "--project", String(i.project)];
      pushFlag(args, "--limit", i.limit);
      pushFlag(args, "--offset", i.offset);
      return { args };
    },
  },
  {
    name: "sprintly_wiki_show",
    title: "Show wiki page",
    description: "Show a wiki page by title (the backend keys pages by title, not numeric ID).",
    readOnly: true,
    inputSchema: {
      project: z.union([z.number().int(), z.string()]).describe("Project numeric ID or identifier (slug)"),
      title: z.string().describe("Page title"),
      version: z.number().int().describe("Specific historical revision (default: current)").optional(),
      withAttachments: z.boolean().describe("Include an attachment metadata table").optional(),
      format: z.enum(["raw", "rendered"]).describe("Output format ('rendered' currently behaves like 'raw')").optional(),
    },
    build: (i) => {
      const args = ["wiki", "show", "--project", String(i.project), "--title", String(i.title)];
      pushFlag(args, "--version", i.version);
      pushBool(args, "--with-attachments", i.withAttachments);
      pushFlag(args, "--format", i.format);
      return { args };
    },
  },
  {
    name: "sprintly_wiki_edit",
    title: "Upsert wiki page",
    description:
      "Create or update a wiki page by title (upsert). Provide text for the body; omit it to only change parent or " +
      `attach a revision comment. ${HTML_NOTE}`,
    readOnly: false,
    inputSchema: {
      project: z.union([z.number().int(), z.string()]).describe("Project numeric ID or identifier (slug)"),
      title: z.string().describe("Page title (primary key for wiki pages)"),
      text: z.string().describe(`Page body. ${HTML_NOTE}`).optional(),
      textFile: z.string().describe("Read the body from this file path instead of inline text").optional(),
      parent: z.string().describe("Parent page title (sets parent_title)").optional(),
      comments: z.string().describe("Revision note attached to this edit").optional(),
    },
    build: (i) => {
      const args = ["wiki", "edit", "--project", String(i.project), "--title", String(i.title)];
      let stdin: string | undefined;
      if (i.text !== undefined && i.textFile) {
        throw new Error("Provide either text or textFile, not both.");
      }
      if (i.text !== undefined) {
        // Pipe via stdin so large HTML bodies and newlines never hit argv limits.
        stdin = String(i.text);
        args.push("--text-stdin");
      } else if (i.textFile) {
        args.push("--text-file", String(i.textFile));
      }
      pushFlag(args, "--parent", i.parent);
      pushFlag(args, "--comments", i.comments);
      return { args, stdin };
    },
  },

  /* ---- maintenance ---------------------------------------------------- */
  {
    name: "sprintly_version",
    title: "Version",
    description: "Print the installed sprintly CLI version and build SHA.",
    readOnly: true,
    inputSchema: {},
    build: () => ({ args: ["version"] }),
  },
  {
    name: "sprintly_update",
    title: "Self-update CLI",
    description:
      "Update the sprintly CLI binary to the latest release. Mutates the on-disk binary; refuses unless installed " +
      "under $SPRINTLY_HOME/bin.",
    readOnly: false,
    inputSchema: {},
    build: () => ({ args: ["update"], timeoutMs: 300_000 }),
  },
];

/* -------------------------------------------------------------------------- */
/* result mapping + registration                                              */
/* -------------------------------------------------------------------------- */

/** Map a CLI result to an MCP tool result, surfacing errors and auth hints. */
export function toToolResult(res: RunResult): CallToolResult {
  if (res.timedOut) {
    return {
      content: [{ type: "text", text: `sprintly timed out.\n${res.stdout}${res.stderr}`.trim() }],
      isError: true,
    };
  }
  if (res.code !== 0) {
    let text = (res.stderr || res.stdout || `sprintly exited with code ${res.code}`).trim();
    if (isAuthError(res.stderr)) {
      text += "\n\nHint: no valid session. Run sprintly_login with your identity URL, " +
        "or `sprintly login --url <identity URL>` in a terminal.";
    }
    return { content: [{ type: "text", text }], isError: true };
  }
  const text = res.stdout.trim() || res.stderr.trim() || "(no output)";
  return { content: [{ type: "text", text }] };
}

/** Register every sprintly tool onto an McpServer. */
export function registerTools(server: McpServer): void {
  for (const spec of toolSpecs) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: {
          title: spec.title,
          readOnlyHint: spec.readOnly,
          destructiveHint: spec.destructive ?? false,
          openWorldHint: true,
        },
      },
      async (input: Record<string, unknown>): Promise<CallToolResult> => {
        let plan: CommandPlan;
        try {
          plan = spec.build(input ?? {});
        } catch (err) {
          return {
            content: [{ type: "text", text: `Invalid arguments: ${(err as Error).message}` }],
            isError: true,
          };
        }
        const res = await runSprintly(plan.args, { stdin: plan.stdin, timeoutMs: plan.timeoutMs });
        return toToolResult(res);
      },
    );
  }
}
