// Task-binding resolver: which repository / Issue (/ PR) a session worked on.
// Inputs are normalized refs only (prompt text is never stored). docs/v0.2/DEFINITION.md section 2.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BindingEvidence, TaskBinding } from "../model.ts";
import type { BindingRef, RepoInventory } from "./types.ts";

export { extractRefs, parseWorktreeName } from "../../plugins/shared/binding-extract.mjs";
export type { BindingRef, BindingRefKind, BindingSources, RepoInventory } from "./types.ts";

export interface ResolveInput {
  promptRefs: BindingRef[];
  worktreeRefs: BindingRef[];
  branchRefs: BindingRef[];
  gitRemoteRepo: string | null;
  knownRepos: string[];
  aliases: Record<string, string>;
  /** Defaults to "kaicreator-mm". */
  owner?: string;
}

const DEFAULT_OWNER = "kaicreator-mm";

/** Read `config/repo-aliases.json` (static inventory cached from `gh`). */
export function loadRepoInventory(path?: string): RepoInventory {
  const file = path ?? join(import.meta.dirname, "..", "..", "config", "repo-aliases.json");
  const j = JSON.parse(readFileSync(file, "utf8")) as Partial<RepoInventory>;
  return {
    owner: typeof j.owner === "string" ? j.owner : DEFAULT_OWNER,
    aliases: j.aliases ?? {},
    repos: j.repos ?? [],
  };
}

type Source = "PROMPT_REF" | "WORKTREE_NAME" | "BRANCH_NAME";

interface Tagged {
  source: Source;
  ref: BindingRef;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
const byNumber = (a: number, b: number) => a - b;

export function resolveBinding(input: ResolveInput): TaskBinding {
  const owner = input.owner ?? DEFAULT_OWNER;
  const canon = new Map<string, string>();
  for (const r of input.knownRepos) canon.set(r.toLowerCase(), r);
  for (const [a, r] of Object.entries(input.aliases)) {
    const target = canon.get(r.toLowerCase()) ?? r;
    canon.set(a.toLowerCase(), target);
  }
  const norm = (repo: string | null): string | null =>
    repo === null ? null : (canon.get(repo.toLowerCase()) ?? null);

  const tagged: Tagged[] = [
    ...input.promptRefs.map((ref) => ({ source: "PROMPT_REF" as const, ref })),
    ...input.worktreeRefs.map((ref) => ({ source: "WORKTREE_NAME" as const, ref })),
    ...input.branchRefs.map((ref) => ({ source: "BRANCH_NAME" as const, ref })),
  ];
  const reasons: string[] = [];
  const evidence: BindingEvidence[] = [];
  const addEvidence = (
    kind: BindingEvidence["kind"],
    value: string,
    e: BindingEvidence["epistemic"],
  ) => {
    if (!evidence.some((x) => x.kind === kind && x.value === value)) {
      evidence.push({ kind, value, epistemic: e });
    }
  };
  const label = (repo: string | null, n: number | null): string =>
    repo === null ? `#${n}` : `${owner}/${repo}${n === null ? "" : `#${n}`}`;

  // ---- repository ----
  const strongRepos = new Set<string>();
  const weakRepos = new Set<string>();
  for (const t of tagged) {
    const repo = norm(t.ref.repo);
    if (t.ref.repo !== null && repo === null) {
      reasons.push(`unknown repository in ${t.source.toLowerCase()} ref`);
      continue;
    }
    if (repo === null) continue;
    if (t.ref.kind === "REPO" && t.source === "PROMPT_REF") weakRepos.add(repo);
    else strongRepos.add(repo);
  }
  if (input.gitRemoteRepo !== null) {
    const [o, name] = input.gitRemoteRepo.split("/");
    const repo = o === owner && name !== undefined ? norm(name) : null;
    if (repo === null) reasons.push("git remote is not a known repository");
    else {
      strongRepos.add(repo);
      addEvidence("GIT_REMOTE", `${owner}/${repo}`, "OBSERVED");
    }
  }
  let repository: string | null = null;
  let repoConflict = false;
  if (strongRepos.size > 1) {
    repoConflict = true;
    reasons.push(`conflicting repositories: ${[...strongRepos].sort().join(", ")}`);
  } else if (strongRepos.size === 1) {
    repository = [...strongRepos][0] as string;
  } else if (weakRepos.size === 1) {
    repository = [...weakRepos][0] as string;
  } else if (weakRepos.size > 1) {
    repoConflict = true;
    reasons.push(`several repositories mentioned: ${[...weakRepos].sort().join(", ")}`);
  }

  // ---- evidence ----
  for (const t of tagged) {
    const repo = norm(t.ref.repo);
    const epistemic = t.source === "PROMPT_REF" ? "SELF_REPORTED" : "INFERRED";
    if (t.ref.kind === "REPO") {
      if (repo !== null) addEvidence(t.source, `${owner}/${repo}`, epistemic);
    } else if (t.ref.number !== null) {
      const eRepo = repo ?? (t.ref.repo === null ? repository : null);
      const base = label(eRepo, t.ref.number);
      addEvidence(t.source, t.ref.kind === "PR" ? `${base} (PR)` : base, epistemic);
    }
  }

  if (repoConflict) {
    return {
      repository: null,
      issue_number: null,
      pr_number: null,
      state: "AMBIGUOUS",
      evidence,
      reasons,
    };
  }

  // ---- issue / PR (only refs of the resolved repository, or repo-less ones) ----
  const issues: number[] = [];
  const prs: number[] = [];
  for (const t of tagged) {
    if (t.ref.number === null || t.ref.kind === "REPO") continue;
    const repo = norm(t.ref.repo);
    if (t.ref.repo !== null && repo !== repository) continue;
    (t.ref.kind === "ISSUE" ? issues : prs).push(t.ref.number);
  }
  const issueSet = uniq(issues).sort(byNumber);
  const prSet = uniq(prs).sort(byNumber);
  let prNumber: number | null = null;
  if (prSet.length === 1) prNumber = prSet[0] as number;
  else if (prSet.length > 1) reasons.push(`several PRs: ${prSet.map((n) => `#${n}`).join(", ")}`);

  if (repository === null) {
    reasons.push("no repository evidence");
    const only = issueSet.length === 1 ? (issueSet[0] as number) : null;
    return {
      repository: null,
      issue_number: only,
      pr_number: prNumber,
      state: "UNRESOLVED",
      evidence,
      reasons,
    };
  }
  const full = `${owner}/${repository}`;
  if (issueSet.length === 1) {
    return {
      repository: full,
      issue_number: issueSet[0] as number,
      pr_number: prNumber,
      state: "RESOLVED",
      evidence,
      reasons,
    };
  }
  if (issueSet.length > 1) {
    reasons.push(`several issues: ${issueSet.map((n) => `#${n}`).join(", ")}`);
    return {
      repository: full,
      issue_number: null,
      pr_number: prNumber,
      state: "AMBIGUOUS",
      evidence,
      reasons,
    };
  }
  reasons.push(prSet.length > 0 ? "pr-only: resolve linked issue" : "no issue reference");
  return {
    repository: full,
    issue_number: null,
    pr_number: prNumber,
    state: "UNRESOLVED",
    evidence,
    reasons,
  };
}
