/**
 * Thin wrapper around the `sprintly` CLI binary.
 *
 * The MCP server does not re-implement the sprintly.cloud REST API: it shells
 * out to the installed CLI for every tool call, reusing its auth/session,
 * token refresh and output formatting. This module owns binary resolution and
 * process spawning; everything else stays pure and testable.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Outcome of one CLI invocation. */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the process was killed because it exceeded its timeout. */
  timedOut: boolean;
}

export interface RunOptions {
  /** Written to the child's stdin (for `--json-stdin` / `--text-stdin`). */
  stdin?: string;
  /** Kill the process after this many milliseconds. Default 60_000. */
  timeoutMs?: number;
}

/**
 * Resolve the sprintly binary, mirroring the skill's resolver:
 *   $SPRINTLY_BIN  >  `sprintly` on PATH  >  ~/.sprintly/bin/sprintly
 * Resolution is cached after the first lookup.
 */
let cachedBinary: string | undefined;
export function resolveBinary(): string {
  if (cachedBinary) return cachedBinary;

  const override = process.env.SPRINTLY_BIN?.trim();
  if (override) {
    cachedBinary = override;
    return cachedBinary;
  }

  // If `sprintly` is on PATH, spawn() will find it by bare name. We can't run
  // `command -v` portably here without another spawn, so prefer the bare name
  // and fall back to the well-known install path only when PATH lookup would
  // obviously fail (the home-dir binary exists and nothing else is set).
  const homeBinary = join(homedir(), ".sprintly", "bin", "sprintly");
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  const onPath = pathDirs.some((dir) => existsSync(join(dir, "sprintly")));
  cachedBinary = onPath ? "sprintly" : existsSync(homeBinary) ? homeBinary : "sprintly";
  return cachedBinary;
}

/** Reset cached binary resolution. Test-only seam. */
export function resetBinaryCache(): void {
  cachedBinary = undefined;
}

/** Spawn the sprintly CLI with the given args and collect its output. */
export function runSprintly(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const binary = resolveBinary();
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return new Promise<RunResult>((resolve) => {
    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      // No shell: args are passed verbatim, so values with spaces, quotes or
      // newlines (HTML descriptions, notes) need no escaping and cannot inject.
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout,
        stderr: stderr || `failed to spawn '${binary}': ${(err as Error).message}`,
        timedOut,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}

/** Heuristic: does this stderr indicate a missing/expired session? */
export function isAuthError(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return s.includes("no saved session") || s.includes("invalid_grant") || s.includes("not authenticated");
}
