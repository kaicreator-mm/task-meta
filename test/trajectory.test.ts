import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateGovernedTrajectory, type GovernedSelection,
} from "../src/trajectory/index.ts";

const root = (): GovernedSelection => ({
  selectionId: "A", previousSelectionId: null,
  strategyOwnerRef: "owner-strategy:A", scopeRef: "product:x", cohortRef: "task:1",
  lane: "OBSERVED", labelerRevision: null, featureCoverage: "COMPLETE",
  authority: "VERIFIED_SOURCE",
  causalWitnessRefs: [], ownerWitnessRefs: ["github:owner:strategy:A"],
  comparison: "UNKNOWN", equivalentDepartedSelectionId: null,
  nonmatchDepartedSelectionIds: [], equivalenceWitnessRefs: [],
});
const next = (
  selectionId: string, previousSelectionId: string, strategyOwnerRef: string,
  equivalentDepartedSelectionId: string | null, nonmatchDepartedSelectionIds: string[] = [],
): GovernedSelection => ({
  ...root(), selectionId, previousSelectionId, strategyOwnerRef,
  causalWitnessRefs: [`github:owner:transition:${selectionId}`],
  ownerWitnessRefs: [`github:owner:strategy:${selectionId}`],
  comparison: "CHANGED", equivalentDepartedSelectionId, nonmatchDepartedSelectionIds,
  equivalenceWitnessRefs: [`github:owner:equivalence:${selectionId}`],
});

const evalObs = (v: GovernedSelection[]) =>
  evaluateGovernedTrajectory(v, "OBSERVED", "task:1", "product:x", null);

test("C08 owner A->B->A' witnessed yields Pivot 2/2, Revisit 1/1", () => {
  const result = evalObs([
    root(), next("B", "A", "owner-strategy:B", null),
    next("A-prime", "B", "owner-strategy:A-prime", "A"),
  ]);
  assert.equal(result.pivot.numerator, 2);
  assert.equal(result.pivot.denominator, 2);
  assert.equal(result.revisit.numerator, 1);
  assert.equal(result.revisit.denominator, 1);
  assert.equal(result.revisit.excluded, 1, "first A->B never produces negative Revisit denominator");
  assert.equal(result.pivot.publicationField, null);
});

test("C08 witnessed eligible non-return after real prior departure counts 0/1", () => {
  const r = evalObs([
    root(), next("B", "A", "owner-strategy:B", null),
    next("C", "B", "owner-strategy:C", null, ["A"]),
  ]);
  assert.equal(r.pivot.denominator, 2);
  assert.equal(r.revisit.numerator, 0);
  assert.equal(r.revisit.denominator, 1);
});

test("C08 incomplete nonmatch evidence cannot be silently treated as 0/1", () => {
  const r = evalObs([
    root(), next("B", "A", "owner-strategy:B", null),
    next("C", "B", "owner-strategy:C", null),
  ]);
  assert.equal(r.revisit.denominator, 0);
  assert.equal(r.revisit.numerator, null);
  assert.equal(r.revisit.comparability, "NOT_COMPARABLE");
});

test("C08 Git rollback or classifier inference alone cannot become OBSERVED owner strategy", () => {
  const inferred = next("B", "A", "owner-strategy:B", null);
  inferred.lane = "INFERRED";
  inferred.authority = "UNVERIFIED";
  const r = evalObs([root(), inferred]);
  assert.equal(r.pivot.denominator, 0);
  assert.equal(r.pivot.numerator, null);
  assert.equal(r.pivot.excluded, 1);
  assert.equal(r.revisit.comparability, "NOT_COMPARABLE");
});

test("C08 incomparable inferred labeler revision and missing features are excluded", () => {
  const a = { ...root(), lane: "INFERRED" as const, labelerRevision: "classifier:1" };
  const b = { ...next("B", "A", "owner-strategy:B", null),
    lane: "INFERRED" as const, labelerRevision: "classifier:2", featureCoverage: "PARTIAL" as const };
  const r = evaluateGovernedTrajectory([a, b], "INFERRED", "task:1", "product:x", "classifier:1");
  assert.equal(r.pivot.denominator, 0);
  assert.equal(r.pivot.excluded, 1);
  assert.equal(r.pivot.comparability, "NOT_COMPARABLE");
});

test("C08 a parallel or missing causal predecessor cannot be timestamp-sorted into a decision", () => {
  const r = evalObs([
    root(), next("B", "different-branch", "owner-strategy:B", null),
    next("A-prime", "B", "owner-strategy:A-prime", "A"),
  ]);
  assert.equal(r.pivot.denominator, 0);
  assert.equal(r.pivot.numerator, null);
  assert.ok(r.pivot.excluded >= 2);
  assert.equal(r.revisit.denominator, 0);
});

test("C08 witnessed owner unchanged decision can count Pivot 0/1, distinct from unknown", () => {
  const same = next("A-still", "A", "owner-strategy:A", null);
  same.comparison = "SAME";
  const r = evalObs([root(), same]);
  assert.equal(r.pivot.numerator, 0);
  assert.equal(r.pivot.denominator, 1);
  assert.equal(r.revisit.denominator, 0);
});
