# sprintly skill

LLM-agnostic skill describing how to drive the `sprintly` CLI for sprintly.cloud task tracking. Same content, multiple delivery formats.

## Files

- `SKILL.md` — main content. Loads as a Claude Code skill directly.
- `recipes.md` — end-to-end flows referenced from `SKILL.md`.
- `skill.json` — structured descriptor (commands, flags, gaps) for tooling that prefers JSON over Markdown.

## Use with Claude Code

This directory already lives under `.claude/skills/sprintly/`. Claude Code auto-discovers it; the agent invokes it via the `Skill` tool whenever it has to read or modify a sprintly issue.

The project rule at `.claude/CLAUDE.md` declares sprintly as the canonical tracker, so the skill is the path of least resistance.

## Use with Cursor

Copy `SKILL.md` to `.cursor/rules/sprintly.mdc` and **replace** the existing frontmatter with:

```yaml
---
description: Use the sprintly CLI for any sprintly.cloud task-tracking action.
globs:
alwaysApply: false
---
```

Cursor's "Agent Requested" mode will pick the rule when the user mentions sprintly. Concatenate `recipes.md` after the body if you want examples inline.

## Use with Aider

Pass both files as read-only context:

```bash
aider --read .claude/skills/sprintly/SKILL.md \
      --read .claude/skills/sprintly/recipes.md
```

Strip the YAML frontmatter from `SKILL.md` if Aider complains about it.

## Use as a system-prompt snippet

For any other agent (custom OpenAI-style tool, Continue, etc.) concatenate the bodies of `SKILL.md` (without frontmatter) and `recipes.md` into the system prompt. ~2 KB compressed; fits comfortably in any modern context window.

## Use programmatically

Parse `skill.json` to render commands, flags, and known gaps into whatever format your agent needs (function-calling tool definitions, OpenAI tools, MCP, etc.). The JSON is the canonical machine-readable mirror of `SKILL.md`.

## Updating

When the `sprintly` CLI gains or changes a flag:

1. Edit the cheatsheet in `SKILL.md` and the affected recipe in `recipes.md`.
2. Mirror the change in `skill.json` (commands, flags, gaps).
3. Re-run the smoke test from `recipes.md` § 7 (create → update → list → close). If it still passes, the skill is good to ship.
