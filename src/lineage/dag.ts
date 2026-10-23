// T17 (#15): multi-attempt branch DAG for one Issue. Combines per-attempt lineages with real git
// ancestry (read-only). Never invents commits; edges only join versions already in the DAG.
// Stores no paths, diff text or branch names.
import type {
  AttemptRelation,
  AttemptRelationKind,
  DagEdge,
  IssueVersionDag,
  Transition,
  VersionLineage,
  VersionState,
} from "../model.ts";
import type { GitExec } from "./index.ts";

export interface BuildIssueDagInput {
  repository: string;
  issue_number: number;
  attempts: Array<{ attempt_ref: string; lineage: VersionLineage; started_at: string | null }>;
  git?: GitExec;
  /** Max commits on an ancestry path before an edge is reported as a gap. Default 200. */
  maxAncestryDepth?: number;
  /** Remote default branch ref used only to detect stale versions; never stored. */
  defaultBranchRef?: string;
}

const SHA_RE = /^[0-9a-fA-F]{7,64}$/;
const short = (s: string): string => s.slice(0, 7);
const RANK = { COMMITTED: 3, INCOMPLETE: 2, UNKNOWN: 1 } as const;
const shaOf = (vid: string): string => vid.replace(/^git:/, "");

type Gap = IssueVersionDag["gaps"][number];

function startOf(ts: Transition[]): string | null {
  for (const t of ts) if (t.from_version) return t.from_version;
  return null;
}
function endOf(ts: Transition[]): string | null {
  for (let i = ts.length - 1; i >= 0; i--) {
    const v = ts[i]?.to_version;
    if (v) return v;
  }
  return null;
}

export async function buildIssueDag(input: BuildIssueDagInput): Promise<IssueVersionDag> {
  const { git } = input;
  const depth = input.maxAncestryDepth ?? 200;
  const gaps: Gap[] = [];

  const ordered = [...input.attempts].sort((a, b) => {
    const ta = a.started_at ? Date.parse(a.started_at) : Number.POSITIVE_INFINITY;
    const tb = b.started_at ? Date.parse(b.started_at) : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.attempt_ref < b.attempt_ref ? -1 : a.attempt_ref > b.attempt_ref ? 1 : 0;
  });

  // Duplicate attempts (identical transition signature): dedup note, no new versions/edges.
  const sigs = new Map<string, string>();
  const kept: typeof ordered = [];
  for (const a of ordered) {
    const sig = a.lineage.transitions
      .map((t) => `${t.from_version ?? "-"}>${t.to_version ?? "-"}:${t.kind}`)
      .join("|");
    const first = sig === "" ? undefined : sigs.get(sig);
    if (first !== undefined) {
      gaps.push({
        kind: "DUPLICATE_ATTEMPT",
        ref: a.attempt_ref,
        detail: `identical transitions to ${first}; merged, no new versions`,
      });
      continue;
    }
    if (sig !== "") sigs.set(sig, a.attempt_ref);
    kept.push(a);
  }

  // Versions: union by SHA.
  const vmap = new Map<string, VersionState>();
  for (const a of kept) {
    for (const v of a.lineage.versions) {
      const refs = v.observed_in.map((r) => `${a.attempt_ref}#${r}`);
      const cur = vmap.get(v.version_id);
      if (!cur) {
        vmap.set(v.version_id, {
          ...v,
          observed_in: refs,
          parents: v.parents ? [...v.parents] : null,
        });
        continue;
      }
      for (const r of refs) if (!cur.observed_in.includes(r)) cur.observed_in.push(r);
      if (RANK[v.observability] > RANK[cur.observability]) cur.observability = v.observability;
      if (!cur.parents && v.parents) cur.parents = [...v.parents];
      if (v.first_seen_at && (!cur.first_seen_at || v.first_seen_at < cur.first_seen_at)) {
        cur.first_seen_at = v.first_seen_at;
      }
    }
  }

  // Probe against git (lineages may have been built without it).
  const committed = new Set<string>();
  if (!git) {
    if (vmap.size > 0) {
      gaps.push({
        kind: "NO_GIT",
        ref: input.repository,
        detail: "git unavailable; ancestry unknown",
      });
    }
  } else {
    for (const v of vmap.values()) {
      const sha = v.sha;
      let ok = false;
      if (sha && SHA_RE.test(sha)) {
        const t = await git(["cat-file", "-t", sha]);
        ok = t.code === 0 && t.stdout.trim() === "commit";
      }
      if (ok && sha) {
        v.observability = "COMMITTED";
        committed.add(v.version_id);
        if (!v.parents) {
          const rl = await git(["rev-list", "--parents", "-n", "1", sha]);
          if (rl.code === 0) v.parents = rl.stdout.trim().split(/\s+/).slice(1);
        }
      } else {
        if (v.observability === "COMMITTED") v.observability = "UNKNOWN";
        gaps.push({
          kind: "SHA_NOT_IN_REPO",
          ref: v.version_id,
          detail: `commit ${short(shaOf(v.version_id))} not found in repository`,
        });
      }
    }
  }

  for (const a of kept) {
    const n = a.lineage.transitions.filter((t) => t.kind === "INCOMPLETE").length;
    if (n > 0) {
      gaps.push({
        kind: "UNFINISHED_ATTEMPT",
        ref: a.attempt_ref,
        detail: `${n} incomplete transition(s); uncommitted work is not a version`,
      });
    }
  }

  const edges: DagEdge[] = [];
  for (const a of kept) {
    for (const t of a.lineage.transitions) {
      if (!t.from_version || !t.to_version || t.from_version === t.to_version) continue;
      edges.push({
        kind: "TRANSITION",
        from_version: t.from_version,
        to_version: t.to_version,
        attempt_ref: a.attempt_ref,
        transition_id: t.transition_id,
        transition_kind: t.kind,
        intermediate_commits: null,
      });
    }
  }

  // Real git ancestry between committed versions in the DAG.
  const ids = [...committed];
  const anc = new Set<string>();
  const isAnc = (a: string, b: string): boolean => anc.has(`${a}>${b}`);
  if (git) {
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const r = await git(["merge-base", "--is-ancestor", shaOf(a), shaOf(b)]);
        if (r.code === 0) anc.add(`${a}>${b}`);
      }
    }
    for (const a of ids) {
      for (const b of ids) {
        if (!isAnc(a, b)) continue;
        if (ids.some((c) => c !== a && c !== b && isAnc(a, c) && isAnc(c, b))) continue;
        const range = `${shaOf(a)}..${shaOf(b)}`;
        const cnt = await git(["rev-list", "--ancestry-path", "--count", range]);
        const n = cnt.code === 0 ? Number(cnt.stdout.trim()) : Number.NaN;
        if (!Number.isFinite(n)) {
          gaps.push({
            kind: "ANCESTRY_UNAVAILABLE",
            ref: b,
            detail: `ancestry count failed for ${short(shaOf(a))}..${short(shaOf(b))}`,
          });
          continue;
        }
        if (n > depth) {
          gaps.push({
            kind: "ANCESTRY_DEPTH_EXCEEDED",
            ref: b,
            detail: `${short(shaOf(a))}..${short(shaOf(b))} spans ${n} commits (bound ${depth})`,
          });
          continue;
        }
        edges.push({
          kind: "GIT_PARENT",
          from_version: a,
          to_version: b,
          attempt_ref: null,
          transition_id: null,
          transition_kind: null,
          intermediate_commits: Math.max(0, n - 1),
        });
      }
    }
    if (input.defaultBranchRef) {
      for (const v of ids) {
        const r = await git(["merge-base", "--is-ancestor", shaOf(v), input.defaultBranchRef]);
        if (r.code === 1) {
          gaps.push({
            kind: "STALE_VERSION",
            ref: v,
            detail: `commit ${short(shaOf(v))} is not an ancestor of the default branch head`,
          });
        }
      }
    }
  }

  // Heads: no outgoing edge (revisit edges point backwards and do not count).
  const outgoing = new Set<string>();
  for (const e of edges) {
    if (e.transition_kind === "REVISIT") continue;
    outgoing.add(e.from_version);
  }
  const heads = [...vmap.keys()].filter((id) => !outgoing.has(id));
  const branches = [...heads];
  if (branches.length >= 2) {
    gaps.push({
      kind: "CONCURRENT_BRANCHES",
      ref: input.repository,
      detail: `${branches.length} distinct heads; divergent attempts`,
    });
  }

  // Attempt relations.
  const info = kept.map((a) => ({
    ref: a.attempt_ref,
    start: startOf(a.lineage.transitions),
    end: endOf(a.lineage.transitions),
  }));
  const attempt_relations: AttemptRelation[] = [];
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const e = info[i];
      const l = info[j];
      if (!e || !l) continue;
      const mk = (relation: AttemptRelationKind, evidence: string[]): void => {
        attempt_relations.push({
          earlier_attempt: e.ref,
          later_attempt: l.ref,
          relation,
          evidence,
        });
      };
      if (!l.start || !e.end || !e.start) {
        mk("UNKNOWN", ["start or end SHA missing"]);
        continue;
      }
      if (l.start === e.end) {
        mk("CONTINUES", [`later starts at ${short(shaOf(l.start))}, the earlier end`]);
        continue;
      }
      if (l.start === e.start) {
        mk("RESTARTS_FROM_BASE", [`both start at ${short(shaOf(l.start))}`]);
        continue;
      }
      if (!git || !committed.has(l.start) || !committed.has(e.end)) {
        mk("UNKNOWN", ["ancestry not determinable (no git or commit missing)"]);
        continue;
      }
      if (isAnc(l.start, e.end)) {
        mk("BRANCHES_FROM", [
          `later start ${short(shaOf(l.start))} is an ancestor of earlier end ${short(shaOf(e.end))}`,
        ]);
      } else if (isAnc(e.end, l.start)) {
        mk("UNKNOWN", ["later starts from a descendant of earlier end (commits unobserved)"]);
      } else {
        const mb = await git(["merge-base", shaOf(l.start), shaOf(e.end)]);
        mk("UNRELATED", [
          mb.code === 0 ? "no linear ancestry; common ancestor exists" : "no common ancestor",
        ]);
      }
    }
  }

  // Cross-attempt revisits: reaching a state the DAG had already left.
  const passed = new Set<string>();
  const rv = new Map<string, string[]>();
  for (const a of kept) {
    for (const t of a.lineage.transitions) {
      if (!t.from_version || !t.to_version || t.from_version === t.to_version) continue;
      if (passed.has(t.to_version)) {
        const l = rv.get(t.to_version) ?? [];
        l.push(t.transition_id);
        rv.set(t.to_version, l);
      }
      passed.add(t.from_version);
    }
  }
  const revisits = [...rv].map(([version_id, transition_ids]) => ({ version_id, transition_ids }));

  return {
    repository: input.repository,
    issue_number: input.issue_number,
    attempts: kept.map((a) => a.attempt_ref),
    versions: [...vmap.values()],
    edges,
    heads,
    branches,
    attempt_relations,
    revisits,
    gaps,
  };
}
