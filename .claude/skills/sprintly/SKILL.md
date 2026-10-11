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

`sprintly` keeps its session in `$XDG_CONFIG_HOME/sprintly/config.json` — in practice `~/.config/sprintly/config.json` (mode 0600, keys `accessToken`, `refreshToken`, `kcBaseUrl`). On Windows it is `%APPDATA%\sprintly\config.json`. Every command refreshes the token before calling the backend, so commands "just work" once the user has signed in.

Do not confuse that with `~/.sprintly/`, which holds only the installed binary and shell completions — no credentials.

- If a command fails with `no saved session` or `invalid_grant`: ask the user to run `sprintly login --url <identity URL>`. Do not invent the URL — it is environment-specific.
- Headless containers (no `DISPLAY` / `WAYLAND_DISPLAY`) automatically fall back to a code-pairing prompt. You can also force it with `sprintly login --url … --headless`.
- Never run `sprintly logout` unless the user explicitly asks. It revokes the saved session and forces a fresh sign-in.
- Need to call the REST API directly (something the CLI does not cover)? Use `sprintly token` — it refreshes the session and prints a valid access token on stdout, one line and nothing else. Do **not** read `accessToken` out of `config.json` by hand: tokens live ~5 minutes, so a value read directly from the file is often already expired, and the resulting `401` surfaces as a confusing parse error rather than an auth error.

```bash
curl -s -H "Authorization: Bearer $(sprintly token)" "$BASE/api/issues/42.json"
```

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
| `sprintly users --project ID`                    | Member IDs + names of one project    |

For `--assignee` / `--author` in `issue list`, the literal `me` resolves to the signed-in user — that command takes `ID|me` only. `issue create` and `issue update` go further and accept `ID|me|NAME`, where `NAME` is matched against the project members (exact case-insensitive match first, then substring; zero or multiple matches are an error that lists the members). Other ID flags require numeric IDs.

The full custom-field dictionary is admin-only. Without admin rights `custom-fields` does not fail: it explains the situation on stderr and falls back to deriving the field list from the values already present on issues, narrowed by `--project`. Treat the `POSSIBLE VALUES` column from that fallback as *values currently in use*, not the full allowed set — and `FORMAT`/`REQ` as unknown. `--json` output stays clean either way.

`users` without `--project` needs admin rights too; `users --project ID` reads project memberships instead and works for any member.

## 3a. Machine-readable output

Every command that prints data accepts `--json`: instead of an ASCII table you get one line of compact JSON on stdout. **Use it by default when you are going to act on the values** — parsing tables is brittle and the `description` column in particular is unusable, because issue bodies are multi-line HTML.

```bash
sprintly issue list --parent 161 --status '*' --json | jq -r '.[].id'
sprintly issue show 244 --json | jq -r .status.name
sprintly custom-fields --project 6 --json | jq -r '.[] | "\(.id) \(.name)"'
```

Shape: **collection → JSON array, single resource → JSON object.** No envelope, so `.[]` iterates. Keys are camelCase and match the CLI's flag vocabulary (`type`, `sprint`, `assignee`, `doneRatio`, `customFields`), not the wire format of the API underneath.

On write commands `--json` is also available: `issue create --json` prints the created issue (read `.id` from it), while `issue update --json` and `wiki edit --json` print a confirmation object, because those calls return no body.

The one exception to "no envelope" is `attachment upload --json`, which reports on a batch rather than a single resource: `{"issue", "count", "uploaded": [{"id", "filename", "filesize", "contentType"}]}`. Read the new attachment ids from `.uploaded[].id`.

### Reading one field: `issue show ID --field NAME [--raw]`

For the read-modify-write loop over a text field, ask for the field alone. There is nothing to strip and no format to agree on:

```bash
# Exact bytes of the description, no labels, no trailing newline:
sprintly issue show 244 --field description --raw > body.html

# Transform and write back:
new=$(sprintly issue show 244 --field description --raw | sed 's/foo/bar/')
sprintly issue update --id 244 --description "$new"
```

`--field` takes the same names as `issue list --columns` (`id`, `subject`, `description`, `project`, `type`, `status`, `priority`, `author`, `assignee`, `category`, `sprint`, `parent`, `start-date`, `due-date`, `done-ratio`, `estimated-hours`, `is-private`, `created`, `updated`, `cf:<id>`) plus `comments` and `attachments`.

- Without `--json`: the value is printed as-is — strings without quotes, an unset field as empty output, objects/arrays as compact JSON.
- `--raw` additionally drops the trailing newline (byte-for-byte). It requires `--field`; on its own it is an error.
- With `--json`: the same single value as a typed JSON value.

Comment bodies are already clean here: the CLI strips the internal `<!--jmeta:{…}-->` metadata prefix that the web client stores inside journal notes, and hides entries that the metadata marks as deleted. You never need to handle that prefix yourself.

## 4. Command cheatsheet

One-line purpose + minimal example per subcommand. Run any command with `--help` only if a flag is ambiguous after reading this file.

### Auth

- `login --url URL [--headless]` — sign in and store an offline session.
  `sprintly login --url https://identity.example.com`
- `logout [--local-only]` — revoke and delete the local session.
  `sprintly logout`
- `token` — print a valid access token on stdout (one line, nothing else); diagnostics go to stderr.
  `curl -H "Authorization: Bearer $(sprintly token)" …`

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

### `issue show ISSUE_ID [--comments] [--field NAME] [--raw] [--json]`

Pretty-print one issue with header, dates, and custom fields. When the issue
has attachments (screenshots, logs), an `Attachments` block is printed after
the custom-fields block, listing each attachment's ID, filename, size, type,
author and creation date. Use that ID with `attachment download` to fetch the
file itself. Pass `--comments` to also list the issue comments (journal notes):
each entry shows author, timestamp, an optional `[private]` marker, and the
note body. Pure field-change history entries are omitted — only entries with an
actual comment are shown.

```bash
sprintly issue show 39
sprintly issue show 39 --comments
sprintly issue show 39 --json
sprintly issue show 39 --field description --raw
```

See [Machine-readable output](#3a-machine-readable-output) for `--json` / `--field` / `--raw`.

### `attachment upload --id ISSUE_ID --file PATH [...]`

Attach one or more local files to an issue. This is the only supported way to
get a file **into** the tracker — the REST two-step (`POST /api/uploads`, then
`PUT /api/issues/<id>` with an `uploads` array) is handled inside the command.

All `--file` arguments land in **one** journal entry, so attaching three files
plus a comment produces a single history record rather than four. The stored
filename is computed once and reused for both REST steps, which matters: the
backend checks the filename on download, and a mismatch turns into a `404`
later rather than an error at upload time.

```bash
# One file, with a comment, in a single journal entry:
sprintly attachment upload --id 257 --file ./leads.csv \
  --notes "<p>Final list, 66 rows.</p>"

# Several files at once — still one journal entry:
sprintly attachment upload --id 257 --file ./leads.csv --file ./brief.md

# Override the stored name (single --file only):
sprintly attachment upload --id 257 --file ./tmp.html --filename "report Q3.html"
```

- `--file PATH` — repeatable. A missing path is reported before any network call.
- `--content-type TYPE` — applies to every `--file`; by default it is guessed
  from the extension.
- `--notes TEXT` — comment posted together with the files. Primitive HTML, same
  rule as `--description` (see Formatting below).
- `--filename NAME` — store under a different name; an error when combined with
  more than one `--file`, rather than silently reusing one name.
- After the upload the command re-reads the issue and prints the new attachment
  IDs — those are the IDs `attachment download` expects. `--json` returns
  `{"issue", "count", "uploaded":[{"id","filename","filesize","contentType"}]}`.

### `attachment download --id ATTACHMENT_ID [--output PATH]`

Download the bytes of an issue attachment (e.g. a screenshot). The ID comes
from the `Attachments` block of `issue show`. The command fetches the
attachment metadata first, so it works from just the ID — no need to run
`issue show` beforehand. With no `--output`, the file is written to the
attachment's original filename in the current directory; `--output PATH`
(or `-o PATH`) chooses the destination, and `-o -` streams the bytes to stdout
for piping.

```bash
# Save under the original filename:
sprintly attachment download --id 512

# Explicit path:
sprintly attachment download --id 512 --output ./bug-repro.png

# Pipe to stdout:
sprintly attachment download --id 512 -o - | wc -c
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
- Table cells are collapsed to a single line (line breaks inside a value become spaces) so columns stay aligned, and the free-text columns (`description`, `cf:<id>`) are cut at 120 characters with a trailing `…`. Both are display-only concessions: for a value you intend to *use*, take `--json` or `issue show --field` instead of a column.
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

- `--project ID` — list the members of one project instead of every account. Works **without** administrator rights (it reads project memberships), and returns IDs and names only; `--status`, `--group` and `--include` do not apply. This is the way to resolve a person to a numeric id when plain `users` answers `403`.
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
- No standalone comment command. Use `issue update --id N --notes "…"`, or `attachment upload --notes "…"` when a file goes with it.
- No attachment **delete**. Removing a stale attachment still needs `DELETE /api/attachments/<id>.json` with `Authorization: Bearer $(sprintly token)`.
- The full custom-field dictionary and the global user list are admin-only; `custom-fields` and `users --project ID` degrade gracefully instead of failing (see Section 3).

## 7. When NOT to use this skill

- Reading sprintly source code — open files normally.
- Anything outside sprintly.cloud (Jira, Linear, GitHub Issues, etc.).
- Long-running interactive logins from a sandboxed agent — ask the user to run `sprintly login` themselves.

See [`recipes.md`](recipes.md) for end-to-end flows and [`README.md`](README.md) for consuming this skill outside Claude Code.
