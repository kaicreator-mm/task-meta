import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseWorktreeName } from "../binding/index.ts";
import type { BindingRef, RepoInventory } from "../binding/types.ts";
import type { GateInput } from "../collect-core.ts";

const MAX_GATE_LOG_BYTES = 4 * 1024 * 1024;
const MAX_DIRS = 2;

/**
 * Gate logs by convention (DEFINITION section 4): `<root>/<worktree>/gate*.log` where the worktree
 * directory name parses (workspace convention `<repo>-i<issue>-<agent>`) to an Issue ref the session
 * also carries as a worktree ref, and the log records `GATE_SUBJECT_SHA` or `EXIT=`. At most one
 * log (the newest) per matching directory. Subject binding is left to the gate record / mtime.
 */
export async function findConventionGateLogs(
  root: string | null,
  worktreeRefs: BindingRef[],
  inv: RepoInventory,
): Promise<GateInput[]> {
  if (root === null) return [];
  const wanted = new Set(
    worktreeRefs
      .filter((r) => r.kind === "ISSUE" && r.repo !== null && r.number !== null)
      .map((r) => `${(r.repo as string).toLowerCase()}#${r.number}`),
  );
  if (wanted.size === 0) return [];
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const out: GateInput[] = [];
  for (const name of dirs) {
    if (out.length >= MAX_DIRS) break;
    const { refs } = parseWorktreeName(name, { aliases: inv.aliases, knownRepos: inv.repos });
    const hit = refs.some(
      (r) =>
        r.kind === "ISSUE" &&
        r.repo !== null &&
        r.number !== null &&
        wanted.has(`${r.repo.toLowerCase()}#${r.number}`),
    );
    if (!hit) continue;
    let files: string[];
    try {
      files = (await readdir(join(root, name))).filter((f) => /^gate.*\.log$/i.test(f));
    } catch {
      continue;
    }
    let best: GateInput | null = null;
    for (const f of files) {
      const path = join(root, name, f);
      try {
        const st = await stat(path);
        if (!st.isFile() || st.size > MAX_GATE_LOG_BYTES) continue;
        if (best !== null && st.mtimeMs <= (best.mtimeMs ?? 0)) continue;
        const text = await readFile(path, "utf8");
        if (!text.includes("GATE_SUBJECT_SHA") && !text.includes("EXIT=")) continue;
        best = { text, sha: null, mtimeMs: st.mtimeMs };
      } catch {
        // unreadable log: ignored
      }
    }
    if (best !== null) out.push(best);
  }
  return out;
}
