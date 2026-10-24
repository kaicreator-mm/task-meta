// T04: private C08 source-qualified strategy trajectories.
// A Git SHA/rollback, classifier label or timestamp is never an owner strategy witness.
// Input must be supplied by a separate source-authority verifier, NOT derived from a Git diff.
export type EvidenceLane = "OBSERVED" | "INFERRED";
export type OwnerComparison = "CHANGED" | "SAME" | "UNKNOWN";

export interface GovernedSelection {
  /** Source-owned unique selection opportunity within one causal lineage. */
  selectionId: string;
  /** Null only for the initial selection, which is not a Pivot/Revisit opportunity. */
  previousSelectionId: string | null;
  strategyOwnerRef: string;
  scopeRef: string;
  cohortRef: string;
  lane: EvidenceLane | "SELF_REPORTED" | "UNKNOWN";
  /** Required for INFERRED only. Does not qualify any OBSERVED conclusion. */
  labelerRevision: string | null;
  featureCoverage: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  /** Authoritative native source verifiers must independently establish this. */
  authority: "VERIFIED_SOURCE" | "UNVERIFIED" | "SELF_REPORTED";
  /** Verification of the causal prior→selected edge, NOT timestamp ordering. */
  causalWitnessRefs: string[];
  /** Verification of the current and prior owner-governed strategy semantics. */
  ownerWitnessRefs: string[];
  /** Owner-accepted comparison between this and the previous selection. */
  comparison: OwnerComparison;
  /** Prior departed strategy selection actually owner-equivalent to current; null for non-return. */
  equivalentDepartedSelectionId: string | null;
  /** Actual owner evidence resolving non-return against EVERY eligible departed strategy. */
  nonmatchDepartedSelectionIds: string[];
  equivalenceWitnessRefs: string[];
}

export interface TrajectoryRatio {
  lane: EvidenceLane;
  scope: "PIVOT" | "REVISIT";
  cohortRef: string;
  strategyScope: string;
  labelerRevision: string | null;
  numerator: number | null;
  denominator: number;
  excluded: number;
  comparability: "COMPARABLE" | "NOT_COMPARABLE";
  limits: string[];
  /** Optional private interpretation; no new public v4/v5 wire fields. */
  publicationField: null;
}
export interface TrajectoryResult {
  pivot: TrajectoryRatio;
  revisit: TrajectoryRatio;
  inputSelections: number;
}

const valid = (v: string): boolean => v.trim().length > 0;
function ratio(
  lane: EvidenceLane, scope: "PIVOT" | "REVISIT", cohortRef: string,
  strategyScope: string, labelerRevision: string | null,
  numerator: number, denominator: number, excluded: number, limits: string[],
): TrajectoryRatio {
  return {
    lane, scope, cohortRef, strategyScope, labelerRevision,
    numerator: denominator === 0 ? null : numerator, denominator, excluded,
    comparability: denominator === 0 ? "NOT_COMPARABLE" : "COMPARABLE",
    limits: [...new Set(limits)], publicationField: null,
  };
}

/**
 * Evaluate a caller-supplied, CAUSALLY ORDERED single-owner lineage. No sorting by
 * wall clock, no concatenation of parallel branches or incomparable revisions.
 * A failed witness excludes the opportunity and makes later causal history unknown.
 * A->B is never a Revisit denominator: A is only departed at B's selection.
 * A->B->A' (owner-qualified A' ~= A) => Pivot 2/2, Revisit 1/1.
 */
export function evaluateGovernedTrajectory(
  selections: readonly GovernedSelection[],
  lane: EvidenceLane,
  cohortRef: string,
  strategyScope: string,
  labelerRevision: string | null,
): TrajectoryResult {
  let pn = 0;
  let pd = 0;
  let pe = 0;
  let rn = 0;
  let rd = 0;
  let re = 0;
  const limits: string[] = [];
  const visited = new Map<string, GovernedSelection>();
  const departed = new Set<string>();
  let previous: GovernedSelection | null = null;
  let historyValid = true;

  for (const current of selections) {
    const qualified = historyValid &&
      valid(current.selectionId) &&
      !visited.has(current.selectionId) &&
      current.lane === lane &&
      current.cohortRef === cohortRef &&
      current.scopeRef === strategyScope &&
      valid(current.strategyOwnerRef) &&
      current.authority === "VERIFIED_SOURCE" &&
      current.featureCoverage === "COMPLETE" &&
      current.ownerWitnessRefs.length > 0 &&
      (lane !== "INFERRED" ||
        (valid(labelerRevision ?? "") && current.labelerRevision === labelerRevision));
    if (!qualified) {
      if (previous !== null) { pe++; re++; }
      limits.push("unqualified strategy owner, source, cohort, lane or classifier features");
      historyValid = false;
      continue;
    }

    if (previous === null) {
      // An initial selected strategy is a visited state, not a transition.
      if (current.previousSelectionId !== null) {
        limits.push("missing initial source-qualified selection");
        historyValid = false;
        continue;
      }
      visited.set(current.selectionId, current);
      previous = current;
      continue;
    }

    if (
      current.previousSelectionId !== previous.selectionId ||
      current.causalWitnessRefs.length === 0 ||
      current.comparison === "UNKNOWN"
    ) {
      pe++;
      re++;
      limits.push("missing causal transition or owner material comparison");
      historyValid = false;
      continue;
    }

    pd++;
    if (current.comparison === "CHANGED") pn++;

    // The current departure is not yet a previously completed departure,
    // so the first A->B cannot contribute an artificial Revisit-negative.
    if (departed.size > 0) {
      const target = current.equivalentDepartedSelectionId;
      const hasOwnerEvidence = current.equivalenceWitnessRefs.length > 0;
      if (!hasOwnerEvidence) {
        re++;
        limits.push("owner strategy equivalence/nonmatch not independently witnessed");
      } else if (target !== null && departed.has(target)) {
        rd++;
        rn++;
      } else if (
        target === null &&
        [...departed].every((id) => current.nonmatchDepartedSelectionIds.includes(id))
      ) {
        rd++;
      } else {
        re++;
        limits.push("incomplete owner comparison to departed strategy history");
      }
    } else {
      re++;
      limits.push("no previously witnessed strategy visit-and-departure before this selection");
    }

    if (current.comparison === "CHANGED") {
      departed.add(previous.selectionId);
    }
    visited.set(current.selectionId, current);
    previous = current;
  }

  return {
    pivot: ratio(lane, "PIVOT", cohortRef, strategyScope, labelerRevision, pn, pd, pe, limits),
    revisit: ratio(lane, "REVISIT", cohortRef, strategyScope, labelerRevision, rn, rd, re, limits),
    inputSelections: selections.length,
  };
}
