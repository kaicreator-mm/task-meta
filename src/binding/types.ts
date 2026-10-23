// Normalized task-binding references (never prompt text). See docs/v0.2/DEFINITION.md section 2.

export type BindingRefKind = "ISSUE" | "PR" | "REPO";

/** A normalized reference: bare repository name (no owner) and number. */
export interface BindingRef {
  kind: BindingRefKind;
  repo: string | null;
  number: number | null;
}

export interface RepoInventory {
  owner: string;
  aliases: Record<string, string>;
  repos: string[];
}

/** What a spool (or any other source) contributes to the resolver. */
export interface BindingSources {
  promptRefs: BindingRef[];
  worktreeRefs: BindingRef[];
  branchRefs: BindingRef[];
  /** `owner/name` of the GitHub origin, or null. */
  gitRemoteRepo: string | null;
}
