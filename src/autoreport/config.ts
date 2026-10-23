import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface AutoReportConfig {
  enabled: boolean;
  clearance_ref: string;
  store: string;
  outbox: string;
  zcode: { spool_dir: string; rollout_dir: string };
  codex: { spool_dir: string; sessions_dir: string };
  claude: { spool_dir: string; projects_dir: string };
  /** Stop-triggered runs wait this long without new spool activity before publishing. */
  settle_seconds: number;
  /** Revisions per session beyond which new data is HELD (REVISION_CAP) until session-end/retry. */
  max_revisions_per_session: number;
  gate_log_root: string | null;
  /** "auto" or 40 lowercase hex. */
  publisher_source_sha: string;
  /**
   * Required verifier scope per repository (`owner/name` → step names, e.g. ["test"]). A repo
   * whose gate runs fewer steps than the task-check default declares them here; the scope is
   * never inferred from what a gate happened to run.
   */
  verifier_scope: Record<string, string[]>;
}

export const DEFAULT_CONFIG_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "config",
  "auto-report.json",
);

/** Expand a leading `~` to the home directory. */
export function expandHome(p: string, home: string = homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return resolve(home, p.slice(2));
  return p;
}

const num = (v: unknown, d: number, min: number): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min ? v : d;
const str = (v: unknown, d: string): string => (typeof v === "string" && v !== "" ? v : d);

/** Read the config; an explicit unreadable path throws, the default path falls back to defaults. */
export function loadAutoReportConfig(path?: string, home: string = homedir()): AutoReportConfig {
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(readFileSync(path ?? DEFAULT_CONFIG_PATH, "utf8")) as Record<string, unknown>;
  } catch (e) {
    if (path !== undefined) throw new Error(`cannot read auto-report config: ${(e as Error).name}`);
  }
  const z = (j.zcode ?? {}) as Record<string, unknown>;
  const c = (j.codex ?? {}) as Record<string, unknown>;
  const cl = (j.claude ?? {}) as Record<string, unknown>;
  const gate =
    typeof j.gate_log_root === "string" && j.gate_log_root !== "" ? j.gate_log_root : null;
  return {
    enabled: j.enabled !== false,
    clearance_ref: str(j.clearance_ref, ""),
    store: expandHome(str(j.store, "~/.task-meta/store"), home),
    outbox: expandHome(str(j.outbox, "~/.task-meta/outbox"), home),
    zcode: {
      spool_dir: expandHome(str(z.spool_dir, "~/.task-meta/zcode-spool"), home),
      rollout_dir: expandHome(str(z.rollout_dir, "~/.zcode/cli/rollout"), home),
    },
    codex: {
      spool_dir: expandHome(str(c.spool_dir, "~/.task-meta/codex-spool"), home),
      sessions_dir: expandHome(str(c.sessions_dir, "~/.codex/sessions"), home),
    },
    claude: {
      spool_dir: expandHome(str(cl.spool_dir, "~/.task-meta/claude-spool"), home),
      projects_dir: expandHome(str(cl.projects_dir, "~/.claude/projects"), home),
    },
    settle_seconds: num(j.settle_seconds, 180, 0),
    max_revisions_per_session: Math.floor(num(j.max_revisions_per_session, 3, 1)),
    gate_log_root: gate === null ? null : expandHome(gate, home),
    publisher_source_sha: str(j.publisher_source_sha, "auto"),
    verifier_scope: verifierScope(j.verifier_scope),
  };
}

/** Keep only `owner/name` keys with a non-empty list of step names. */
function verifierScope(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (v === null || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [repo, steps] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !Array.isArray(steps)) continue;
    const list = steps.filter((s): s is string => typeof s === "string" && s.trim() !== "");
    if (list.length > 0) out[repo] = list.map((s) => s.trim());
  }
  return out;
}

const SHA_RE = /^[0-9a-f]{40}$/;

/** `auto` = `git rev-parse HEAD` of the task-meta install; null when unavailable or malformed. */
export function resolvePublisherSha(
  cfg: AutoReportConfig,
  installDir?: string,
): Promise<string | null> {
  if (cfg.publisher_source_sha !== "auto") {
    return Promise.resolve(SHA_RE.test(cfg.publisher_source_sha) ? cfg.publisher_source_sha : null);
  }
  const cwd = installDir ?? join(import.meta.dirname, "..", "..");
  return new Promise((res) => {
    execFile(
      "git",
      ["rev-parse", "HEAD"],
      { cwd, timeout: 5000, windowsHide: true },
      (err, out) => {
        const sha = String(out ?? "").trim();
        res(err || !SHA_RE.test(sha) ? null : sha);
      },
    );
  });
}
