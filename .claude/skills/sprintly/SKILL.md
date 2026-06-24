---
name: sprintly
description: Use whenever the user asks you to read, create, update, transition, or list work items in sprintly.cloud — issues, sprints, projects, statuses, custom fields. Covers the full `sprintly` CLI surface so you can act without re-discovering flags every session.
---

# sprintly CLI

`sprintly` is the CLI for sprintly.cloud. Use it for every task-tracking action: searching, opening, creating, updating, transitioning issues, inspecting sprints, and reading reference data (statuses, priorities, types, custom fields).

This file is the single source of truth. `recipes.md` holds end-to-end flows; `skill.json` is the same content in machine-readable form.

## 1. Binary

Prefer `sprintly` from PATH. If missing, fall back to `~/.sprintly/bin/sprintly`. In scripts:

```bash
SPRINTLY="$(command -v sprintly || echo "$HOME/.sprintly/bin/sprintly")"
```

Subsequent examples assume `sprintly` is reachable.

## 2. Authentication

`sprintly` keeps a session file at `~/.sprintly/session` (mode 0600). Every command refreshes the token before calling the backend, so commands "just work" once the user has signed in.

- If a command fails with `no saved session` or `invalid_grant`: ask the user to run `sprintly login --url <identity URL>`. Do not invent the URL — it is environment-specific.
- Headless containers (no `DISPLAY` / `WAYLAND_DISPLAY`) automatically fall back to a code-pairing prompt. You can also force it with `sprintly login --url … --headless`.
- Never run `sprintly logout` unless the user explicitly asks. It revokes the saved session and forces a fresh sign-in.

## 3. Reference lookups

Most write actions need numeric IDs. List them once per session and reuse:

| Command                                          | Returns                              |
| ------------------------------------------------ | ------------------------------------ |
| `sprintly projects`                              | Project IDs + slug + name            |
| `sprintly sprints --project ID`                  | Sprint IDs per project               |
| `sprintly statuses`                              | Status IDs (with `closed` flag)      |
| `sprintly priorities`                            | Priority IDs                         |
| `sprintly types`                                 | Issue type IDs                       |
| `sprintly activities`                            | Work-activity IDs                    |
| `sprintly custom-fields [--project ID] [--type ID]` | Custom field IDs and value sets |

For `--assignee` / `--author` in `issue list`, the literal `me` resolves to the signed-in user. `issue create` and `issue update` also accept `--assignee me`. Other ID flags require numeric IDs.

## 4. Command cheatsheet

One-line purpose + minimal example per subcommand. Run any command with `--help` only if a flag is ambiguous after reading this file.

### Auth

- `login --url URL [--headless]` — sign in and store an offline session.
  `sprintly login --url https://identity.example.com`
- `logout [--local-only]` — revoke and delete the local session.
  `sprintly logout`

### Lookups

- `projects` — list visible projects.
- `statuses` — list issue statuses; column `CLOSED` flags terminal states.
- `priorities` — list priorities.
- `types` — list issue types.
- `activities` — list work-activity types.
- `sprints --project ID` — list sprints for a project.
- `custom-fields [--type ID] [--project ID]` — list custom-field definitions.
- `version` — print CLI version.
- `update` — self-update the CLI binary from `get.sprintly.cloud`. No flags. Refuses when the binary is not at `$SPRINTLY_HOME/bin/sprintly` (default `~/.sprintly/bin/sprintly`). Honours `SPRINTLY_BASE_URL` for symmetry with the installer.

### `issue show ISSUE_ID [--comments]`

Pretty-print one issue with header, dates, and custom fields. Pass
`--comments` to also list the issue comments (journal notes) after the
custom-fields block: each entry shows author, timestamp, an optional
`[private]` marker, and the note body. Pure field-change history entries are
omitted — only entries with an actual comment are shown.

```bash
sprintly issue show 39
sprintly issue show 39 --comments
```

### `issue list`

Search issues. Repeat ID flags for OR semantics across the same field.

```bash
# My open issues, newest update first
sprintly issue list --assignee me --status open --sort updated_on:desc

# Tasks in Sprint 1 of project 8, with priority column visible
sprintly issue list --project 8 --sprint 8 --type 1 \
  --columns id,status,priority,subject

# Walk every page
sprintly issue list --project 8 --all
```

Key flags:

- `--status open|closed|*` accepts these literals or a numeric ID; repeatable.
- `--assignee me` / `--author me` — `issue list` only. (`issue create`/`update` also accept `--assignee me`; see Section 4 Create/Update.)
- `--cf ID=VALUE` filters by a custom field; repeat for additional fields.
- `--columns` controls output. Available: `id,subject,project,type,status,priority,author,assignee,category,sprint,parent,start-date,due-date,done-ratio,estimated-hours,is-private,created,updated,description`; add a custom field with `cf:<id>`.
- Date filters (`--created-on`, `--updated-on`, `--start-date`, `--due-date`) are pass-through. Examples: `>=2026-01-01`, `><2026-01-01|2026-06-30`, `t` (today), `lw` (last week).
- Pagination: `--limit N` (≤100) + `--offset N`, or `--all` to fetch every page.
- `--sort field[:desc][,field2[:desc]]` — e.g. `priority:desc,updated_on:desc`.

### `issue create`

Minimum required to create something useful: `--project`, `--type`, `--subject`. Body of `--description` must follow the formatting rule below (primitive HTML), regardless of what the CLI `--help` says about Markdown/Textile.

```bash
sprintly issue create \
  --project 8 --type 1 \
  --subject "Investigate flaky build" \
  --sprint 8 --assignee 9 --priority 4 \
  --description "<p>Reproduce, isolate, file follow-up if needed.</p>"
```

Batch / structured payloads via JSON:

```bash
echo '{"subject":"From JSON","description":"…"}' \
  | sprintly issue create --json-stdin \
      --project 8 --type 1 --sprint 8 --assignee 9 --priority 4
```

`--json-stdin` / `--json-file PATH` provide the base body; CLI flags override individual fields.

### `issue update --id ISSUE_ID`

Same body flags as `create`, plus:

- `--notes TEXT` — append a journal comment (the only way to add a comment without otherwise mutating the issue). Body must use primitive HTML, see "Formatting" below.
- `--private-notes` — mark the note as private.

```bash
# Transition to In Progress and leave a note
sprintly issue update --id 39 --status 2 --notes "<p>Picking this up.</p>"

# Add a comment only
sprintly issue update --id 39 --notes "<p>Status update: PR opened.</p>"
```

### Formatting `--description` and `--notes`

Project convention: write the body as human-readable text with **primitive HTML tags**. Plain text (no markup) and Markdown (`**bold**`, `# heading`, backticks, `- list`) both render incorrectly in the web UI — Markdown shows up as literal asterisks/hashes.

Allowed tags only (no CSS, no classes, no scripts):

- `<h2>`, `<h3>` — section headings
- `<p>` — paragraphs
- `<b>`, `<i>` — emphasis
- `<ul><li>…</li></ul>`, `<ol><li>…</li></ol>` — lists
- `<code>` — inline command, ID, path snippets
- `<pre>` — multi-line code blocks
- `<br>` — only when an explicit line break inside a paragraph is needed

Same rule applies to the `description` key inside `--json-stdin` / `--json-file` payloads.

Minimal example:

```bash
sprintly issue update --id 39 --status 6 --notes \
  "<p>Skill shipped. Smoke test green on <code>#53</code>.</p><ul><li>Created</li><li>Transitioned</li><li>Closed</li></ul>"
```

### `--cf ID=VALUE` syntax

Repeat the **same** ID for multi-value list fields. Use `custom-fields` to discover IDs.

```bash
sprintly issue update --id 39 --cf 66=2026.07.0
sprintly issue list --cf 66=2026.07.0 --columns id,subject,cf:66
```

### `users`

List backend users with substring search, status filter, group filter, and selectable columns. Pagination uses the same `--limit`/`--offset`/`--all` shape as `issue list`.

```bash
# Substring search across login/email/full name
sprintly users --name larson

# Hide admins (no-op when the caller isn't admin themselves — caveat below)
sprintly users --hide-admin --columns id,login,name,email,last-login

# Fetch everyone with extra detail
sprintly users --include memberships,groups --all
```

Key flags:

- `--name SUBSTR` — substring match over `login`, `mail`, `firstname`, `lastname`.
- `--status active|locked|registered` — account state filter.
- `--group ID` — restrict to a group membership.
- `--hide-admin` — **client-side** filter on the `admin` field. The backend returns `admin` only when the caller is themselves admin; for regular users the field is absent, so the filter degrades to a no-op without an error. Mention this when reporting results to the user.
- `--include memberships,groups` — pass-through to backend; widens the response payload.
- `--columns` — available: `id,login,name,email,last-login,admin`. Default: `id,login,name,email,last-login`.

Use this to look up a numeric user id when `me` does not apply (e.g. for `--watcher`).

### `wiki list`

List wiki pages of one project. `--project` accepts a numeric ID **or** the project identifier (slug from `sprintly projects`).

```bash
sprintly wiki list --project spr
sprintly wiki list --project 8 --limit 50 --offset 50
```

Pagination is **client-side** — the wiki index endpoint returns no `total_count`, so `--limit`/`--offset` slice the in-memory list. There is no `--all` flag (you already have everything after one round-trip).

### `wiki show`

Print a wiki page by **title** (the backend addresses wiki pages by name; numeric IDs are not supported, and that constraint is repeated in `--help`).

```bash
sprintly wiki show --project spr --title "Release notes"
sprintly wiki show --project spr --title "Release notes" --version 3
sprintly wiki show --project spr --title "Release notes" --with-attachments
```

- `--version N` fetches a historical revision instead of the current one.
- `--with-attachments` adds an attachment metadata table to the output.
- `--format raw|rendered` — `raw` is the default and prints the body as stored. `rendered` is a forward-compatibility placeholder and currently behaves identically to `raw`.
- A missing title returns a clear "not found" error via `describeBackendError`; spaces in the title are URL-encoded automatically (`"Release notes"` → `Release%20notes`).

### `wiki edit`

Upsert a wiki page by title — one command for both create and update. The text source is exactly one of `--text` / `--text-file PATH` / `--text-stdin` (mutually exclusive). A PUT with no text is valid when you only want to change `--parent` or attach a `--comments` revision note to an existing page.

```bash
# One-liner
sprintly wiki edit --project spr --title "Release notes" \
  --text "<p>2026-07-01: shipped #54.</p>" --comments "ship note"

# From a file
sprintly wiki edit --project spr --title "Runbook" --text-file ./runbook.html

# Piped body, set a parent page
some-generator | sprintly wiki edit --project spr --title "Daily report" \
  --text-stdin --parent "Reports"
```

Body follows the same primitive-HTML rule as `--description`/`--notes` (see Formatting above) — Markdown renders raw.

## 5. Working a story: keep the tracker in sync

**Rule (non-negotiable):** when implementing a story that has sub-tasks, treat the sprintly tracker as the source of truth for progress, not just your in-session task list. Every sub-task must reflect reality at all times.

For each sub-task you touch:

1. **Before starting**, transition it to `in progress` (status ID 2 in this project — verify with `sprintly statuses`).
2. **While working**, if you discover a blocker, scope change, or sub-task split, leave a journal note explaining it. Don't rely on memory or the in-session task list — those are invisible to the user reading the ticket later.
3. **On completion**, transition to `Done` (status ID 3) **and** post a `--notes` comment summarising what was actually done: files/functions touched, decisions made, verification results. One short paragraph or a `<ul>` is enough — don't paste diffs, the code is already in git.
4. **If you finish the parent story**, leave a summary note on the parent issue and let the user decide on its final transition (review/testing/done). Do not auto-close the parent unless explicitly asked.

Why this matters: the in-session task list disappears when the session ends. The sprintly journal is the only artefact the user (and future you) can read tomorrow to understand what shipped and why. Skipping this leaves the board lying — sub-tasks stuck in `to do` while their code is already merged.

How to find sub-tasks of a story:

```bash
sprintly issue list --parent N --status '*' --columns id,status,subject --limit 100
```

Minimal pattern per sub-task:

```bash
# Starting
sprintly issue update --id 41 --status 2

# Finishing
sprintly issue update --id 41 --status 3 --notes \
  "<p>Added <code>User</code> in <code>Cli.Backend</code>; <code>admin</code> is <code>Maybe Bool</code> so the client-side filter degrades cleanly.</p>"
```

This rule applies even when the user has not asked for status updates — they expect the board to be honest by default.

## 6. Known gaps & workarounds

- No `issue delete`. To close, set `--status` to the `Done` ID (`sprintly statuses` to find it).
- No standalone comment command. Use `issue update --id N --notes "…"`.

## 7. When NOT to use this skill

- Reading sprintly source code — open files normally.
- Anything outside sprintly.cloud (Jira, Linear, GitHub Issues, etc.).
- Long-running interactive logins from a sandboxed agent — ask the user to run `sprintly login` themselves.

See [`recipes.md`](recipes.md) for end-to-end flows and [`README.md`](README.md) for consuming this skill outside Claude Code.
