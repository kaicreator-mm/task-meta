// Rule labeler v1 (#16): deterministic, no LLM. Labels carry labeler provenance, are derived
// only from metadata already in the private store, never override verifier/GitHub truth,
// and treat loop metrics as diagnostic only. Unobserved intent is UNKNOWN, not guessed.
import { canonicalDigest, canonicalize, sha256Hex } from "../canonical.ts";
import type {
  Epistemic,
  Label,
  LabelKind,
  ObservationRecord,
  VerifierAssessment,
  VersionLineage,
} from "../model.ts";

export type ActionCategory =
  | "IMPLEMENTATION"
  | "DIAGNOSIS"
  | "PLANNING"
  | "TEST"
  | "ENVIRONMENT"
  | "VCS"
  | "OTHER"
  | "UNKNOWN";

export type FailureClass =
  | "IMPLEMENTATION"
  | "AGENT_STRATEGY_TOOL"
  | "TASK_CONTRACT"
  | "ENVIRONMENT_CI"
  | "UNRESOLVED";

/** The complete rule table; its canonical digest is the labeler's rules_digest. */
export const RULE_TABLE = {
  tool_name: {
    edit: "IMPLEMENTATION",
    write: "IMPLEMENTATION",
    multiedit: "IMPLEMENTATION",
    apply_patch: "IMPLEMENTATION",
    read: "DIAGNOSIS",
    grep: "DIAGNOSIS",
    glob: "DIAGNOSIS",
    ls: "DIAGNOSIS",
    todowrite: "PLANNING",
    taskoutput: "OTHER",
  },
  bash_input_class: {
    TEST: "TEST",
    TYPECHECK_LINT: "TEST",
    BUILD: "ENVIRONMENT",
    DEPENDENCY: "ENVIRONMENT",
    VCS: "VCS",
    READ_SEARCH: "DIAGNOSIS",
    FILE_WRITE: "IMPLEMENTATION",
    OTHER: "UNKNOWN",
  },
  edit_magnitude: { small_lt: 50, medium_lt: 500 },
  loop_cluster: { min_consecutive_test_calls: 3, reset_on: "IMPLEMENTATION" },
  failure_class: {
    "task-check:deps": "ENVIRONMENT_CI",
    "task-check:lint": "IMPLEMENTATION",
    "task-check:typecheck": "IMPLEMENTATION",
    "task-check:test": "IMPLEMENTATION",
    unverified_with_conflicts: "UNRESOLVED",
    other_failed_check: "UNRESOLVED",
  },
} as const;

export const LABELER = {
  name: "task-meta-rules",
  version: "1.0.0",
  rules_digest: canonicalDigest(RULE_TABLE),
} as const;

export interface LabelInput {
  observations: ObservationRecord[];
  lineage: VersionLineage;
  assessment: VerifierAssessment;
}

const MAX_EVIDENCE = 20;

function mkLabel(
  kind: LabelKind,
  target_ref: string,
  value: string,
  epistemic: Epistemic,
  evidence_refs: string[],
): Label {
  const label_id = sha256Hex(
    canonicalize({ kind, target_ref, value, labeler_version: LABELER.version }),
  ).slice(0, 32);
  return {
    label_id,
    target_ref,
    kind,
    value,
    epistemic: value === "UNKNOWN" ? "UNKNOWN" : epistemic,
    confidence: null,
    labeler: { ...LABELER },
    evidence_refs: evidence_refs.slice(0, MAX_EVIDENCE),
    supersedes: null,
  };
}

/** Pure per-call classification; also used by the golden-set test. */
export function categorizeTool(name: string, inputClass?: string): ActionCategory {
  const n = name.toLowerCase();
  if (n === "bash") {
    const table = RULE_TABLE.bash_input_class as Record<string, ActionCategory>;
    return (inputClass !== undefined ? table[inputClass] : undefined) ?? "UNKNOWN";
  }
  const t = RULE_TABLE.tool_name as Record<string, ActionCategory>;
  return t[n] ?? "UNKNOWN";
}

function magnitude(
  insertions: number | null,
  deletions: number | null,
): "NONE" | "SMALL" | "MEDIUM" | "LARGE" | "UNKNOWN" {
  if (insertions === null || deletions === null) return "UNKNOWN";
  const lines = insertions + deletions;
  if (lines === 0) return "NONE";
  if (lines < RULE_TABLE.edit_magnitude.small_lt) return "SMALL";
  if (lines < RULE_TABLE.edit_magnitude.medium_lt) return "MEDIUM";
  return "LARGE";
}

/** Tool-call observations ordered by their parent model request start time (stable). */
export function orderedToolCalls(observations: ObservationRecord[]): ObservationRecord[] {
  const startOf = new Map<string, string | null>();
  for (const o of observations) {
    if (o.kind === "MODEL_REQUEST") startOf.set(o.observation_id, o.started_at);
  }
  const calls = observations
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.kind === "TOOL_CALL" && o.tool !== null);
  const key = (o: ObservationRecord): number => {
    const s = o.parent_ref ? startOf.get(o.parent_ref) : null;
    const t = s ? Date.parse(s) : Number.NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  calls.sort((a, b) => {
    const ka = key(a.o);
    const kb = key(b.o);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.i - b.i;
  });
  return calls.map((c) => c.o);
}

export function labelAttempt(input: LabelInput): Label[] {
  const out: Label[] = [];
  const calls = orderedToolCalls(input.observations);

  const cats: { obs: ObservationRecord; cat: ActionCategory }[] = [];
  for (const o of calls) {
    const tool = o.tool;
    if (!tool) continue;
    const cat = categorizeTool(tool.name, tool.input_class);
    cats.push({ obs: o, cat });
    out.push(mkLabel("ACTION_CATEGORY", o.observation_id, cat, "INFERRED", [o.observation_id]));
  }

  for (const t of input.lineage.transitions) {
    if (t.kind !== "ADVANCE" && t.kind !== "REVISIT" && t.kind !== "NO_CHANGE") continue;
    const m = magnitude(t.change.insertions, t.change.deletions);
    out.push(mkLabel("EDIT_MAGNITUDE", t.transition_id, m, "OBSERVED", [t.transition_id]));
  }

  // LOOP_CLUSTER: TEST calls in order; an IMPLEMENTATION call ends the current run.
  let run: ObservationRecord[] = [];
  const flush = (): void => {
    const first = run[0];
    if (first && run.length >= RULE_TABLE.loop_cluster.min_consecutive_test_calls) {
      out.push(
        mkLabel(
          "LOOP_CLUSTER",
          first.observation_id,
          `test-rerun-without-edit:${run.length}`,
          "INFERRED",
          run.map((r) => r.observation_id),
        ),
      );
    }
    run = [];
  };
  for (const { obs, cat } of cats) {
    if (cat === "IMPLEMENTATION") flush();
    else if (cat === "TEST") run.push(obs);
  }
  flush();

  for (const r of input.lineage.revisits) {
    out.push(mkLabel("REVISIT_CANDIDATE", r.version_id, "revisit", "OBSERVED", r.transition_ids));
  }

  const { assessment } = input;
  const fc = RULE_TABLE.failure_class as Record<string, FailureClass>;
  if (assessment.outcome_class === "TERMINAL_FAILURE") {
    for (const rec of assessment.records) {
      if (rec.currentness !== "CURRENT") continue;
      for (const f of rec.failed) {
        const cls = fc[f] ?? fc.other_failed_check ?? "UNRESOLVED";
        const target = rec.source_refs[0] ?? rec.verifier_id;
        out.push(
          mkLabel("FAILURE_CLASS_CANDIDATE", target, cls, "INFERRED", [f, ...rec.source_refs]),
        );
      }
    }
  } else if (assessment.outcome_class === "UNVERIFIED" && assessment.conflicts.length > 0) {
    const attempt = input.observations.find((o) => o.attempt_ref)?.attempt_ref ?? "attempt";
    const refs = assessment.records.flatMap((r) => r.source_refs);
    out.push(
      mkLabel(
        "FAILURE_CLASS_CANDIDATE",
        attempt,
        fc.unverified_with_conflicts ?? "UNRESOLVED",
        "INFERRED",
        refs,
      ),
    );
  }

  const seen = new Set<string>();
  return out.filter((l) => {
    if (seen.has(l.label_id)) return false;
    seen.add(l.label_id);
    return true;
  });
}
