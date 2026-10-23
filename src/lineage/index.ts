// Version lineage (#15): reconstruct VersionState / Transition from run segments + read-only git.
// Never synthesizes a commit for uncommitted work. Diff text and file names are hashed or
// counted in memory and never stored or returned.
import { execFile } from "node:child_process";
import type { RunRecord } from "../adapters/zcode/parse.ts";
import { sha256Hex } from "../canonical.ts";
import { sortRunSegments } from "../correlate.ts";
import type { Transition, TransitionKind, VersionLineage, VersionState } from "../model.ts";

export type GitExec = (args: string[]) => Promise<{ stdout: string; code: number }>;

/** Runs `git --git-dir <gitDir> ...args` without a shell; never throws on non-zero exit. */
export function makeGitExec(gitDir: string): GitExec {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        "git",
        ["--git-dir", gitDir, ...args],
        { maxBuffer: 512 * 1024 * 1024, encoding: "utf8", windowsHide: true },
        (err, stdout) => {
          if (!err) return resolve({ stdout: String(stdout), code: 0 });
          const code = (err as { code?: unknown }).code;
          resolve({ stdout: String(stdout ?? ""), code: typeof code === "number" ? code : -1 });
        },
      );
    });
}

export interface LineageInput {
  attempt_ref: string;
  runs: RunRecord[];
  git?: GitExec;
  segmentRefs?: string[];
}

const SHA_RE = /^[0-9a-fA-F]{7,64}$/;

function short(sha: string): string {
  return sha.slice(0, 7);
}

function utcIso(s: string): string | null {
  const t = Date.parse(s.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function parseShortstat(out: string): {
  files_changed: number;
  insertions: number;
  deletions: number;
} {
  const n = (re: RegExp): number => {
    const m = re.exec(out);
    return m ? Number(m[1]) : 0;
  };
  return {
    files_changed: n(/(\d+) files? changed/),
    insertions: n(/(\d+) insertions?\(\+\)/),
    deletions: n(/(\d+) deletions?\(-\)/),
  };
}

interface Seg {
  run: RunRecord;
  ref: string;
}

function orderSegments(runs: RunRecord[], segmentRefs?: string[]): Seg[] {
  const sorted = sortRunSegments(runs);
  const used = new Set<number>();
  return sorted.map((run, i) => {
    let idx = -1;
    for (let j = 0; j < runs.length; j++) {
      if (runs[j] === run && !used.has(j)) {
        idx = j;
        break;
      }
    }
    if (idx >= 0) used.add(idx);
    const given = idx >= 0 ? segmentRefs?.[idx] : undefined;
    return { run, ref: given ?? `run-segment:${i + 1}` };
  });
}

export async function buildLineage(input: LineageInput): Promise<VersionLineage> {
  const { attempt_ref, git } = input;
  const segs = orderSegments(input.runs, input.segmentRefs);
  const limits: string[] = [];

  // Distinct versions in first-appearance order.
  const observed = new Map<string, string[]>();
  const touch = (sha: string | null, ref: string): void => {
    if (!sha) return;
    const list = observed.get(sha);
    if (!list) observed.set(sha, [ref]);
    else if (!list.includes(ref)) list.push(ref);
  };
  for (const s of segs) {
    touch(s.run.head_before, s.ref);
    touch(s.run.head_after, s.ref);
  }

  const committed = new Set<string>();
  const versions: VersionState[] = [];
  for (const [sha, refs] of observed) {
    const v: VersionState = {
      version_id: `git:${sha}`,
      sha,
      parents: null,
      first_seen_at: null,
      observed_in: refs,
      observability: "UNKNOWN",
      epistemic: "OBSERVED",
    };
    if (git) {
      let isCommit = false;
      if (SHA_RE.test(sha)) {
        const t = await git(["cat-file", "-t", sha]);
        isCommit = t.code === 0 && t.stdout.trim() === "commit";
      }
      if (isCommit) {
        v.observability = "COMMITTED";
        const rl = await git(["rev-list", "--parents", "-n", "1", sha]);
        if (rl.code === 0) v.parents = rl.stdout.trim().split(/\s+/).slice(1);
        const d = await git(["show", "-s", "--format=%cI", sha]);
        if (d.code === 0) v.first_seen_at = utcIso(d.stdout);
        committed.add(sha);
      } else {
        limits.push(`sha ${short(sha)} not found in git`);
      }
    }
    versions.push(v);
  }
  if (!git && versions.length > 0) limits.push("git not available; parents unknown");

  const transitions: Transition[] = [];
  const seen = new Set<string>();
  let prevAfter: string | null = null;
  for (const { run, ref } of segs) {
    const before = run.head_before;
    const after = run.head_after;
    const finished = run.finished_at !== null && after !== null;
    const tLimits: string[] = [];
    let kind: TransitionKind;
    if (!finished) {
      kind = "INCOMPLETE";
      tLimits.push(
        run.finished_at === null ? "segment not finished" : "segment finished without head_after",
      );
    } else if (!before) {
      kind = "UNKNOWN";
      tLimits.push("head_before missing");
    } else if (before === after) {
      kind = "NO_CHANGE";
    } else if (seen.has(after as string)) {
      kind = "REVISIT";
    } else {
      kind = "ADVANCE";
    }

    if (before && prevAfter && before !== prevAfter) {
      limits.push(`head chain broken before ${ref}`);
    }

    const change: Transition["change"] = {
      files_changed: null,
      insertions: null,
      deletions: null,
      diff_digest: null,
    };
    if (kind === "NO_CHANGE" && before && committed.has(before)) {
      change.files_changed = 0;
      change.insertions = 0;
      change.deletions = 0;
    } else if ((kind === "ADVANCE" || kind === "REVISIT") && before && after) {
      if (!git) {
        tLimits.push("change unavailable: git not available");
      } else if (committed.has(before) && committed.has(after)) {
        const ss = await git(["diff", "--shortstat", before, after]);
        const df = await git(["diff", "--no-color", "--no-ext-diff", before, after]);
        if (ss.code === 0) Object.assign(change, parseShortstat(ss.stdout));
        else tLimits.push("shortstat unavailable");
        if (df.code === 0) change.diff_digest = sha256Hex(df.stdout);
        else tLimits.push("diff digest unavailable");
      } else {
        tLimits.push("change unavailable: commit not found in git");
      }
    }

    transitions.push({
      transition_id: `${attempt_ref}#${ref}`,
      from_version: before ? `git:${before}` : null,
      to_version: finished && after ? `git:${after}` : null,
      run_segment_ref: ref,
      started_at: run.started_at,
      finished_at: run.finished_at,
      change,
      verifier_refs: [],
      kind,
      epistemic: kind === "UNKNOWN" || kind === "INCOMPLETE" ? "UNKNOWN" : "OBSERVED",
      limits: tLimits,
    });

    if (before) seen.add(before);
    if (after) seen.add(after);
    if (after) prevAfter = after;
  }

  const revisitMap = new Map<string, string[]>();
  for (const t of transitions) {
    if (t.kind !== "REVISIT" || !t.to_version) continue;
    const l = revisitMap.get(t.to_version) ?? [];
    l.push(t.transition_id);
    revisitMap.set(t.to_version, l);
  }
  const revisits = [...revisitMap].map(([version_id, transition_ids]) => ({
    version_id,
    transition_ids,
  }));

  return { versions, transitions, revisits, limits: [...new Set(limits)] };
}
