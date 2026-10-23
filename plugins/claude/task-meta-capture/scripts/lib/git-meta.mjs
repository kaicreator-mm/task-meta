// Git metadata for capture plugins. Dependency-free (Node built-ins only).
// Shared source: copied into each plugin's scripts/lib/ by `npm run sync-plugins`.
// Records only: HEAD commit, dirty flag, `owner/name` of the GitHub origin, current branch name.
// Any failure yields nulls. The working directory path is used to run git, never returned.
import { execFileSync } from "node:child_process";

const HEAD_RE = /^[0-9a-f]{40}$/;
const BUDGET_MS = 3500;
const CALL_MS = 2000;

/** `owner/name` from a github.com remote URL (https, ssh, scp-like), else null. */
export function parseGithubRemote(url) {
  if (typeof url !== "string") return null;
  const u = url.trim();
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git:\/\/|[^@/\s]+@)github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
      u,
    );
  return m ? `${m[1]}/${m[2]}` : null;
}

function git(cwd, args, deadline) {
  const left = deadline - Date.now();
  if (left <= 50) throw new RangeError("git budget exhausted");
  return execFileSync("git", args, {
    cwd,
    timeout: Math.min(CALL_MS, left),
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
}

/** @returns {{ git_head: string|null, git_dirty: boolean|null, git_remote_repo: string|null, branch: string|null }} */
export function gitInfo(cwd) {
  const out = { git_head: null, git_dirty: null, git_remote_repo: null, branch: null };
  if (typeof cwd !== "string" || cwd === "") return out;
  const deadline = Date.now() + BUDGET_MS;
  try {
    const head = git(cwd, ["rev-parse", "HEAD"], deadline).trim();
    if (HEAD_RE.test(head)) out.git_head = head;
  } catch {
    return out;
  }
  try {
    out.git_dirty = git(cwd, ["status", "--porcelain"], deadline).trim() !== "";
  } catch {
    out.git_dirty = null;
  }
  // Prefer the push URL: workspace worktrees fetch from a local mirror but push to GitHub.
  for (const args of [
    ["remote", "get-url", "--push", "origin"],
    ["remote", "get-url", "origin"],
  ]) {
    try {
      const repo = parseGithubRemote(git(cwd, args, deadline));
      if (repo !== null) {
        out.git_remote_repo = repo;
        break;
      }
    } catch {
      // try the next form
    }
  }
  try {
    const b = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], deadline).trim();
    if (b !== "" && b !== "HEAD" && b.length <= 200) out.branch = b;
  } catch {
    out.branch = null;
  }
  return out;
}
