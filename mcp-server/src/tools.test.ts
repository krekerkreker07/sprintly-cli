import { describe, it, expect } from "vitest";
import { toolSpecs, toToolResult, type ToolSpec } from "./tools.js";
import type { RunResult } from "./sprintly.js";

const byName = new Map<string, ToolSpec>(toolSpecs.map((s) => [s.name, s]));
function spec(name: string): ToolSpec {
  const s = byName.get(name);
  if (!s) throw new Error(`no such tool: ${name}`);
  return s;
}
const build = (name: string, input: Record<string, unknown> = {}) => spec(name).build(input);

describe("catalogue", () => {
  it("registers a tool per CLI subcommand with unique names", () => {
    const names = toolSpecs.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    // Spot-check the full surface is present.
    for (const n of [
      "sprintly_login",
      "sprintly_logout",
      "sprintly_projects",
      "sprintly_statuses",
      "sprintly_priorities",
      "sprintly_types",
      "sprintly_activities",
      "sprintly_sprints",
      "sprintly_custom_fields",
      "sprintly_users",
      "sprintly_issue_show",
      "sprintly_issue_list",
      "sprintly_issue_create",
      "sprintly_issue_update",
      "sprintly_wiki_list",
      "sprintly_wiki_show",
      "sprintly_wiki_edit",
      "sprintly_version",
      "sprintly_update",
    ]) {
      expect(byName.has(n), n).toBe(true);
    }
  });

  it("marks read vs write tools correctly", () => {
    expect(spec("sprintly_issue_list").readOnly).toBe(true);
    expect(spec("sprintly_issue_create").readOnly).toBe(false);
    expect(spec("sprintly_logout").destructive).toBe(true);
  });
});

describe("lookups", () => {
  it("emits bare subcommands", () => {
    expect(build("sprintly_projects").args).toEqual(["projects"]);
    expect(build("sprintly_statuses").args).toEqual(["statuses"]);
    expect(build("sprintly_version").args).toEqual(["version"]);
  });

  it("sprints requires --project", () => {
    expect(build("sprintly_sprints", { project: 8 }).args).toEqual(["sprints", "--project", "8"]);
  });

  it("custom-fields passes optional filters", () => {
    expect(build("sprintly_custom_fields", { type: 1, project: 8 }).args).toEqual([
      "custom-fields",
      "--type",
      "1",
      "--project",
      "8",
    ]);
    expect(build("sprintly_custom_fields").args).toEqual(["custom-fields"]);
  });
});

describe("users", () => {
  it("joins array flags and emits bare booleans", () => {
    const { args } = build("sprintly_users", {
      name: "larson",
      status: "active",
      hideAdmin: true,
      include: ["memberships", "groups"],
      all: true,
      columns: ["id", "login", "name"],
    });
    expect(args).toEqual([
      "users",
      "--name",
      "larson",
      "--status",
      "active",
      "--hide-admin",
      "--include",
      "memberships,groups",
      "--all",
      "--columns",
      "id,login,name",
    ]);
  });
});

describe("issue show", () => {
  it("passes the id positionally, not as --id", () => {
    expect(build("sprintly_issue_show", { id: 39 }).args).toEqual(["issue", "show", "39"]);
    expect(build("sprintly_issue_show", { id: 39, comments: true }).args).toEqual([
      "issue",
      "show",
      "39",
      "--comments",
    ]);
  });
});

describe("issue list", () => {
  it("repeats array filters for OR semantics", () => {
    const { args } = build("sprintly_issue_list", {
      project: [8, 9],
      status: ["open"],
      assignee: ["me", 17],
      type: [1],
      sort: "priority:desc,updated_on:desc",
      columns: ["id", "subject"],
      all: true,
    });
    expect(args).toEqual([
      "issue",
      "list",
      "--project",
      "8",
      "--project",
      "9",
      "--status",
      "open",
      "--assignee",
      "me",
      "--assignee",
      "17",
      "--type",
      "1",
      "--sort",
      "priority:desc,updated_on:desc",
      "--columns",
      "id,subject",
      "--all",
    ]);
  });

  it("encodes the privacy tristate", () => {
    expect(build("sprintly_issue_list", { isPrivate: true }).args).toContain("--is-private");
    expect(build("sprintly_issue_list", { isPrivate: false }).args).toContain("--no-is-private");
    const none = build("sprintly_issue_list", {}).args;
    expect(none).not.toContain("--is-private");
    expect(none).not.toContain("--no-is-private");
  });

  it("passes date queries through verbatim", () => {
    const { args } = build("sprintly_issue_list", { createdOn: ">=2026-01-01", updatedOn: "lw" });
    expect(args).toEqual(["issue", "list", "--created-on", ">=2026-01-01", "--updated-on", "lw"]);
  });
});

describe("issue create / update", () => {
  it("builds a create with assignee 'me' and repeatable cf/watcher", () => {
    const { args, stdin } = build("sprintly_issue_create", {
      project: 8,
      type: 1,
      subject: "Smoke test",
      assignee: "me",
      cf: ["66=2026.07.0", "66=2026.07.1"],
      watcher: [9, 10],
      isPrivate: false,
    });
    expect(args).toEqual([
      "issue",
      "create",
      "--project",
      "8",
      "--type",
      "1",
      "--subject",
      "Smoke test",
      "--assignee",
      "me",
      "--no-is-private",
      "--watcher",
      "9",
      "--watcher",
      "10",
      "--cf",
      "66=2026.07.0",
      "--cf",
      "66=2026.07.1",
    ]);
    expect(stdin).toBeUndefined();
  });

  it("update puts --id first and supports notes + private tristate", () => {
    const { args } = build("sprintly_issue_update", {
      id: 39,
      status: 6,
      notes: "<p>Ready for review.</p>",
      privateNotes: true,
    });
    expect(args.slice(0, 4)).toEqual(["issue", "update", "--id", "39"]);
    expect(args).toContain("--status");
    expect(args).toContain("--notes");
    expect(args).toContain("<p>Ready for review.</p>");
    expect(args).toContain("--private-notes");
  });

  it("routes a JSON body through stdin via --json-stdin", () => {
    const { args, stdin } = build("sprintly_issue_create", {
      project: 8,
      type: 1,
      jsonBody: { subject: "From JSON", description: "<p>x</p>" },
    });
    expect(args).toContain("--json-stdin");
    expect(args).not.toContain("--json-file");
    expect(stdin).toBe(JSON.stringify({ subject: "From JSON", description: "<p>x</p>" }));
  });

  it("routes a JSON file via --json-file without stdin", () => {
    const { args, stdin } = build("sprintly_issue_create", { jsonFile: "/tmp/body.json" });
    expect(args).toEqual(["issue", "create", "--json-file", "/tmp/body.json"]);
    expect(stdin).toBeUndefined();
  });
});

describe("wiki", () => {
  it("lists by slug or numeric id", () => {
    expect(build("sprintly_wiki_list", { project: "spr" }).args).toEqual(["wiki", "list", "--project", "spr"]);
    expect(build("sprintly_wiki_list", { project: 8, limit: 50, offset: 50 }).args).toEqual([
      "wiki",
      "list",
      "--project",
      "8",
      "--limit",
      "50",
      "--offset",
      "50",
    ]);
  });

  it("shows a pinned version with attachments", () => {
    const { args } = build("sprintly_wiki_show", {
      project: "spr",
      title: "Release notes",
      version: 3,
      withAttachments: true,
    });
    expect(args).toEqual([
      "wiki",
      "show",
      "--project",
      "spr",
      "--title",
      "Release notes",
      "--version",
      "3",
      "--with-attachments",
    ]);
  });

  it("edit pipes inline text through stdin via --text-stdin", () => {
    const { args, stdin } = build("sprintly_wiki_edit", {
      project: "spr",
      title: "Release notes",
      text: "<p>Shipped #54.</p>",
      comments: "ship note",
    });
    expect(args).toEqual([
      "wiki",
      "edit",
      "--project",
      "spr",
      "--title",
      "Release notes",
      "--text-stdin",
      "--comments",
      "ship note",
    ]);
    expect(stdin).toBe("<p>Shipped #54.</p>");
  });

  it("edit rejects text and textFile together", () => {
    expect(() =>
      build("sprintly_wiki_edit", { project: "spr", title: "x", text: "a", textFile: "/tmp/b.html" }),
    ).toThrow(/not both/);
  });
});

describe("auth", () => {
  it("login defaults to headless and a long timeout", () => {
    const plan = build("sprintly_login", { url: "https://acme.sprintly.cloud" });
    expect(plan.args).toEqual(["login", "--url", "https://acme.sprintly.cloud", "--headless"]);
    expect(plan.timeoutMs).toBe(300_000);
  });

  it("login can opt out of headless", () => {
    expect(build("sprintly_login", { url: "https://x", headless: false }).args).toEqual([
      "login",
      "--url",
      "https://x",
    ]);
  });

  it("logout supports --local-only", () => {
    expect(build("sprintly_logout", { localOnly: true }).args).toEqual(["logout", "--local-only"]);
    expect(build("sprintly_logout").args).toEqual(["logout"]);
  });
});

describe("toToolResult", () => {
  const base: RunResult = { code: 0, stdout: "", stderr: "", timedOut: false };

  it("returns stdout text on success", () => {
    const r = toToolResult({ ...base, stdout: "ID  SUBJECT\n39  hi\n" });
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toMatchObject({ type: "text", text: "ID  SUBJECT\n39  hi" });
  });

  it("flags non-zero exit as an error", () => {
    const r = toToolResult({ ...base, code: 1, stderr: "boom" });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("boom");
  });

  it("appends a login hint on auth errors", () => {
    const r = toToolResult({ ...base, code: 1, stderr: "no saved session" });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text.toLowerCase()).toContain("login");
  });

  it("marks timeouts as errors", () => {
    const r = toToolResult({ ...base, code: null, timedOut: true });
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("timed out");
  });
});
