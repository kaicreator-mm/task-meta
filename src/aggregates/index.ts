// Diagnostic aggregates (#17): explicit numerator/denominator/coverage/derivation, never a
// fabricated 0 for unknown, failed/aborted attempts stay in denominators. Private: the
// effective ADS report schema has no field for them (publication_field = null).
import type {
  Coverage,
  DiagnosticAggregate,
  Epistemic,
  Label,
  VerifierAssessment,
  VersionLineage,
} from "../model.ts";

export const PUBLIC_GAP_LIMIT =
  "diagnostic aggregates withheld: no ADS report field (gap ADS #1258)";

export interface AggregateInput {
  summaryAttempts: string[];
  excludedAttempts: string[];
  assessment: VerifierAssessment;
  lineage: VersionLineage;
  labels: Label[];
}

const MAX_REFS = 20;

interface Spec {
  name: string;
  numerator: number | null;
  denominator: number | null;
  unit: string;
  coverage: Coverage;
  epistemic: Epistemic;
  derivation: string;
  source_refs: string[];
  limits?: string[];
}

function mk(s: Spec): DiagnosticAggregate {
  return {
    name: s.name,
    numerator: s.numerator,
    denominator: s.denominator,
    unit: s.unit,
    coverage: s.numerator === null ? "UNKNOWN" : s.coverage,
    epistemic: s.numerator === null ? "UNKNOWN" : s.epistemic,
    derivation: s.derivation,
    source_refs: s.source_refs.slice(0, MAX_REFS),
    comparability: "INSUFFICIENT_COMPARABLE_EVIDENCE",
    limits: ["single attempt, no comparable cohort", ...(s.limits ?? [])],
    publication_field: null,
  };
}

export function computeAggregates(input: AggregateInput): DiagnosticAggregate[] {
  const { assessment, lineage, labels } = input;
  const included = input.summaryAttempts.length;
  const total = included + input.excludedAttempts.length;
  const attemptRefs = [...input.summaryAttempts, ...input.excludedAttempts];
  const noAttempts = total === 0;
  const hasRecords = assessment.records.length > 0;
  const verifierRefs = assessment.records.flatMap((r) => r.source_refs);
  const out: DiagnosticAggregate[] = [];

  out.push(
    mk({
      name: "eligible_attempts",
      numerator: noAttempts ? null : included,
      denominator: noAttempts ? null : total,
      unit: "attempts",
      coverage: "COMPLETE",
      epistemic: "OBSERVED",
      derivation:
        "attempts aggregated into the summary / all attempts incl. excluded (failed, aborted)",
      source_refs: attemptRefs,
      limits: noAttempts ? ["no attempts observed"] : [],
    }),
  );

  const strictKnown = !noAttempts && hasRecords;
  out.push(
    mk({
      name: "strict_verified_attempts",
      numerator: strictKnown
        ? assessment.outcome_class === "STRICT_TERMINAL_SUCCESS"
          ? 1
          : 0
        : null,
      denominator: noAttempts ? null : total,
      unit: "attempts",
      coverage: "PARTIAL",
      epistemic: "OBSERVED",
      derivation:
        "1 when outcome_class is STRICT_TERMINAL_SUCCESS else 0, over all attempts incl. excluded",
      source_refs: verifierRefs,
      limits: [
        ...(hasRecords ? [] : ["no verifier record; strict verification unknown"]),
        "task acceptance is not checked by the gate",
      ],
    }),
  );

  const partial =
    assessment.outcome_class === "PARTIAL_PROGRESS" || assessment.outcome_class === "UNVERIFIED";
  out.push(
    mk({
      name: "partial_or_unknown_attempts",
      numerator: noAttempts ? null : partial ? 1 : 0,
      denominator: noAttempts ? null : total,
      unit: "attempts",
      coverage: "PARTIAL",
      epistemic: "OBSERVED",
      derivation:
        "1 when outcome_class is PARTIAL_PROGRESS or UNVERIFIED else 0, over all attempts",
      source_refs: verifierRefs,
    }),
  );

  const trs = lineage.transitions;
  const noTr = trs.length === 0;
  const unknownTr = trs.filter((t) => t.kind === "UNKNOWN" || t.kind === "INCOMPLETE");
  const trCoverage: Coverage = noTr ? "UNKNOWN" : unknownTr.length > 0 ? "PARTIAL" : "COMPLETE";
  const trLimits = noTr ? ["no transitions observed"] : [];
  out.push(
    mk({
      name: "labeled_transitions",
      numerator: noTr ? null : trs.length - unknownTr.length,
      denominator: noTr ? null : trs.length,
      unit: "transitions",
      coverage: trCoverage,
      epistemic: "OBSERVED",
      derivation: "transitions whose kind is not UNKNOWN/INCOMPLETE / all transitions",
      source_refs: trs.map((t) => t.transition_id),
      limits: trLimits,
    }),
  );
  out.push(
    mk({
      name: "unknown_transitions",
      numerator: noTr ? null : unknownTr.length,
      denominator: noTr ? null : trs.length,
      unit: "transitions",
      coverage: trCoverage,
      epistemic: "OBSERVED",
      derivation: "transitions whose kind is UNKNOWN/INCOMPLETE / all transitions",
      source_refs: unknownTr.map((t) => t.transition_id),
      limits: trLimits,
    }),
  );
  const revisits = labels.filter((l) => l.kind === "REVISIT_CANDIDATE");
  out.push(
    mk({
      name: "revisit_candidates",
      numerator: noTr ? null : revisits.length,
      denominator: noTr ? null : trs.length,
      unit: "transitions",
      coverage: trCoverage,
      epistemic: "OBSERVED",
      derivation: "REVISIT_CANDIDATE labels / all transitions; a candidate is not a judged mistake",
      source_refs: revisits.map((l) => l.target_ref),
      limits: trLimits,
    }),
  );

  const actions = labels.filter((l) => l.kind === "ACTION_CATEGORY");
  const noActions = actions.length === 0;
  const noToolLimits = noActions ? ["no tool calls observed"] : [];
  const testCalls = actions.filter((l) => l.value === "TEST");
  const loops = labels.filter((l) => l.kind === "LOOP_CLUSTER");
  out.push(
    mk({
      name: "loop_clusters",
      numerator: noActions ? null : loops.length,
      denominator: noActions ? null : testCalls.length,
      unit: "clusters per TEST-category tool call",
      coverage: "PARTIAL",
      epistemic: "INFERRED",
      derivation:
        "LOOP_CLUSTER labels / TEST-category tool calls; diagnostic only, not a quality score",
      source_refs: loops.map((l) => l.target_ref),
      limits:
        noActions || testCalls.length > 0
          ? noToolLimits
          : ["no TEST-category calls; ratio undefined"],
    }),
  );
  const unknownActions = actions.filter((l) => l.value === "UNKNOWN");
  out.push(
    mk({
      name: "action_category_unknown",
      numerator: noActions ? null : unknownActions.length,
      denominator: noActions ? null : actions.length,
      unit: "tool calls",
      coverage: "PARTIAL",
      epistemic: "INFERRED",
      derivation: "ACTION_CATEGORY labels with value UNKNOWN / all tool calls",
      source_refs: unknownActions.map((l) => l.target_ref),
      limits: noToolLimits,
    }),
  );

  const scope = [...new Set(assessment.records.flatMap((r) => r.required_scope))];
  const current = assessment.records.filter((r) => r.currentness === "CURRENT");
  const checkedCurrent = new Set(current.flatMap((r) => r.checked));
  const known =
    hasRecords && (current.length > 0 || assessment.records.some((r) => r.currentness === "STALE"));
  const vcLimits: string[] = [];
  if (!hasRecords) vcLimits.push("no verifier record");
  else if (!known) vcLimits.push("verifier currentness unknown for every record");
  else if (current.length === 0)
    vcLimits.push("no verifier record is current against the attempt source");
  out.push(
    mk({
      name: "verifier_coverage",
      numerator: known ? scope.filter((s) => checkedCurrent.has(s)).length : null,
      denominator: hasRecords ? scope.length : null,
      unit: "required scope items",
      coverage: current.length > 0 ? "COMPLETE" : "PARTIAL",
      epistemic: "OBSERVED",
      derivation: "required scope items checked on a CURRENT verifier record / required scope size",
      source_refs: verifierRefs,
      limits: vcLimits,
    }),
  );
  return out;
}
