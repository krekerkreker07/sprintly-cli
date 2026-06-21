# sprintly-cli

A fast, scriptable command-line client for **[sprintly.cloud](https://sprintly.cloud)** — manage projects, sprints and issues from your terminal without leaving the keyboard.

`sprintly-cli` is a single statically-linked binary written in Haskell. It talks to the sprintly.cloud REST API over HTTPS and stores credentials locally so day-to-day commands run with one round-trip.

```text
$ sprintly issue list --project 42 --assignee me --status open
ID     TYPE     STATUS   PRIORITY  ASSIGNEE          SUBJECT
1287   Bug      Open     High      Dmytro Ganzha     Login flow drops state on retry
1304   Task     Open     Normal    Dmytro Ganzha     Add pagination to issue list
1311   Story   In prog   Normal    Dmytro Ganzha     Sprint board export to CSV
```

---

## Features

- **Secure browser login** by default; falls back to a headless device-code mode when no display is available (CI, SSH sessions, containers).
- **Offline session** — sign in once, keep working for weeks; tokens are refreshed automatically before every request.
- **Issues**: create, update, show, list with rich filters (project, sprint, type, priority, status, assignee, watcher, custom fields, date ranges).
- **Reference data**: projects, sprints, statuses, priorities, types, activities and custom fields, all listable in tabular form.
- **Composable**: JSON input via `--json-file` / `--json-stdin`, repeatable flags for OR-filters, deterministic exit codes — pipes cleanly into `jq`, `xargs`, shell loops and CI jobs.
- **Cross-platform** binaries for Linux (amd64, arm64) and macOS (Apple Silicon, Intel).

---

## Install

The recommended install path is the official one-liner. It downloads the binary for your platform, verifies its SHA-256 checksum, installs it to `~/.sprintly/bin` and wires up `PATH` plus shell completions for bash, zsh and fish.

```bash
curl -fsSL https://get.sprintly.cloud/install.sh | sh
```

Pin a specific version:

```bash
curl -fsSL https://get.sprintly.cloud/install.sh | sh -s -- --version 0.2.0
```

Install without editing your shell rc files (the script will print the snippet for you to paste):

```bash
curl -fsSL https://get.sprintly.cloud/install.sh | sh -s -- --no-modify-path
```

Open a new shell (or `source ~/.bashrc` / `~/.zshrc`) and verify:

```bash
sprintly version
```

### Uninstall

```bash
curl -fsSL https://get.sprintly.cloud/uninstall.sh | sh
```

This removes the binary, completions and the managed rc-file block. Your session file (see [Configuration](#configuration)) is left in place; delete it manually if you also want to forget the saved credentials.

---

## Quick start

1. **Sign in.** Point the CLI at your sprintly.cloud identity host:

   ```bash
   sprintly login --url https://{your_name}.sprintly.cloud
   ```

   A browser window opens, you complete the login, and the CLI saves an encrypted session locally. On a headless box (no `DISPLAY`/`WAYLAND_DISPLAY`), the CLI auto-detects this and prints a short code + URL to enter on another device. You can force this mode explicitly with `--headless`.

2. **Discover your workspace.**

   ```bash
   sprintly projects
   sprintly sprints --project 42
   sprintly types
   sprintly statuses
   ```

3. **Find what you own.**

   ```bash
   sprintly issue list --assignee me --status open --sort updated_on:desc
   ```

4. **Create an issue.**

   ```bash
   sprintly issue create \
     --project 42 --type 1 --priority 4 \
     --subject "Login flow drops state on retry" \
     --description "Reproduced on staging, 3/5 attempts." \
     --assignee 17 --sprint 9 \
     --estimated-hours 2.5 --due-date 2026-07-01
   ```

5. **Update an existing one.**

   ```bash
   sprintly issue update --id 1287 --status 3 --done-ratio 60 \
     --notes "Patched in PR #421, awaiting review."
   ```

6. **Sign out** when you're done on a shared machine:

   ```bash
   sprintly logout            # revokes the refresh token server-side and deletes the local session
   sprintly logout --local-only   # offline: just delete the local file
   ```

---

## Commands

Run `sprintly <command> --help` for the full option list. The most useful flags are listed below.

| Command | Purpose |
| --- | --- |
| `login [--url URL] [--headless]` | Authenticate and save an offline session. |
| `logout [--local-only]` | Revoke the saved session and remove local credentials. |
| `projects` | List projects you have access to. |
| `sprints --project ID` | List sprints for a project. |
| `statuses` / `priorities` / `types` / `activities` | List reference data used by issue filters. |
| `custom-fields [--type ID] [--project ID]` | List available custom fields. |
| `issue create` | Create a new issue. |
| `issue update --id ISSUE_ID` | Update an existing issue. |
| `issue show ISSUE_ID` | Print full issue details. |
| `issue list` | List issues with filters, sorting, pagination and column selection. |
| `version` (or `--version` / `-v`) | Print the installed version and build SHA. |

### Filtering issues

`issue list` accepts repeatable flags. Repeating the same flag means OR; combining different flags means AND.

```bash
# All open bugs or stories in projects 42 OR 51, assigned to me, sorted by priority:
sprintly issue list \
  --project 42 --project 51 \
  --type 1 --type 2 \
  --status open \
  --assignee me \
  --sort priority:desc,updated_on:desc
```

Useful extras:

- `--status open` / `--status closed` / `--status '*'` shortcut groups, plus numeric IDs.
- `--created-on '>=2026-01-01'`, `--updated-on '><2026-01-01|2026-06-30'` — date range pass-through.
- `--cf 12=urgent --cf 12=blocker` — custom field filter, repeatable for multi-value.
- `--columns id,subject,status,assignee,cf:12` — pick exactly which columns to render.
- `--all` — fetch every page until the total is reached (otherwise default page size is 25, max 100).

### JSON workflows

Both `issue create` and `issue update` accept a base JSON body that is then overridden by any CLI flags you pass. Handy for templating in CI:

```bash
cat issue-template.json | sprintly issue create --json-stdin --sprint 9
sprintly issue update --id 1287 --json-file payload.json --notes "Re-applied template."
```

### Tristate flags

Flags like `--is-private` are tristate: passing `--is-private` sets it to true, `--no-is-private` sets it to false, and omitting the flag leaves the field untouched on update. This avoids the classic "did the user mean false, or just didn't pass anything?" ambiguity.

---

## Configuration

There is no config file. Two things are read from the environment:

| Variable | Effect |
| --- | --- |
| `DISPLAY` / `WAYLAND_DISPLAY` | When neither is set on Linux, `sprintly login` selects headless mode automatically. |
| `SPRINTLY_HOME` | Used only by the installer (default `~/.sprintly`). The CLI itself does not read it. |

### Session file

After `login`, the CLI writes a session file containing your refresh token, access token and the identity host URL:

| Platform | Path |
| --- | --- |
| Linux / macOS | `$XDG_CONFIG_HOME/sprintly/session.json` (default `~/.config/sprintly/session.json`) |
| Windows | `%APPDATA%\sprintly\session.json` |

On POSIX systems the file is created with mode `0600`. Treat it like any other credential — losing it is equivalent to losing your password until you `logout` (which revokes the token server-side).

---

## License

MIT. See [`LICENSE`](LICENSE).
