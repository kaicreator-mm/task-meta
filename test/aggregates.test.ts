import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAggregates, PUBLIC_GAP_LIMIT } from "../src/aggregates/index.ts";
import { LABELER } from "../src/labels/index.ts";
import type {
  Label,
  Transition,
  VerifierAssessment,
  VerifierRecord,
  VersionLineage,
} from "../src/model.ts";
import { findForbiddenContent } from "../src/privacy.ts";

const NAMES = [
  "eligible_attempts",
  "strict_verified_attempts",
  "partial_or_unknown_attempts",
  "labeled_transitions",
  "unknown_transitions",
  "revisit_candidates",
  "loop_clusters",
  "action_category_unknown",
  "verifier_coverage",
];

function label(kind: Label["kind"], target: string, value: string): Label {
  return {
    label_id: `${kind}${target}${value}`.padEnd(32, "0").slice(0, 32),
    target_ref: target,
    kind,
    value,
    epistemic: "INFERRED",
    confidence: null,
    labeler: { ...LABELER },
    evidence_refs: [],
    supersedes: null,
  };
}
function rec(over: Partial<VerifierRecord> = {}): VerifierRecord {
  return {
    verifier_id: "task-check",
    verifier_version: null,
    contract_ref: null,
    subject_sha: "a".repeat(40),
    environment: {},
    required_scope: ["task-check:lint", "task-check:typecheck", "task-check:test"],
    checked: ["task-check:lint", "task-check:typecheck"],
    failed: ["task-check:test"],
    skipped: [],
    unchecked: [],
    cases: { total: null, passed: null, failed: null, skipped: null, epistemic: "UNKNOWN" },
    exit_code: 1,
    currentness: "CURRENT",
    qualifiers: [],
    source_refs: ["task-check:aaaaaaa"],
    epistemic: "OBSERVED",
    ...over,
  };
}
function tr(id: string, kind: Transition["kind"]): Transition {
  return {
    transition_id: id,
    from_version: null,
    to_version: null,
    run_segment_ref: id,
    started_at: null,
    finished_at: null,
    change: { files_changed: null, insertions: null, deletions: null, diff_digest: null },
    verifier_refs: [],
    kind,
    epistemic: "OBSERVED",
    limits: [],
  };
}
const lineage = (transitions: Transition[]): VersionLineage => ({
  versions: [],
  transitions,
  revisits: [],
  limits: [],
});
const assessment = (over: Partial<VerifierAssessment> = {}): VerifierAssessment => ({
  outcome_class: "TERMINAL_FAILURE",
  records: [rec()],
  conflicts: [],
  limits: [],
  ...over,
});
const get = (aggs: ReturnType<typeof computeAggregates>, n: string) => {
  const a = aggs.find((x) => x.name === n);
  assert.ok(a, n);
  return a;
};

test("all aggregates present with required shape and privacy", () => {
  const aggs = computeAggregates({
    summaryAttempts: ["a1"],
    excludedAttempts: ["a2", "a3"],
    assessment: assessment(),
    lineage: lineage([tr("t1", "ADVANCE"), tr("t2", "INCOMPLETE"), tr("t3", "REVISIT")]),
    labels: [
      label("ACTION_CATEGORY", "o1", "TEST"),
      label("ACTION_CATEGORY", "o2", "UNKNOWN"),
      label("ACTION_CATEGORY", "o3", "TEST"),
      label("LOOP_CLUSTER", "o1", "test-rerun-without-edit:3"),
      label("REVISIT_CANDIDATE", "git:a", "revisit"),
    ],
  });
  assert.deepEqual(
    aggs.map((a) => a.name),
    NAMES,
  );
  for (const a of aggs) {
    assert.equal(a.publication_field, null);
    assert.equal(a.comparability, "INSUFFICIENT_COMPARABLE_EVIDENCE");
    assert.ok(a.unit && a.derivation);
    assert.ok(a.source_refs.length <= 20);
    if (a.numerator === null) {
      assert.equal(a.epistemic, "UNKNOWN");
      assert.equal(a.coverage, "UNKNOWN");
    }
  }
  assert.deepEqual(findForbiddenContent(aggs), []);
  // denominators keep failed/excluded attempts
  const el = get(aggs, "eligible_attempts");
  assert.equal(el.numerator, 1);
  assert.equal(el.denominator, 3);
  assert.equal(get(aggs, "strict_verified_attempts").numerator, 0);
  assert.equal(get(aggs, "strict_verified_attempts").denominator, 3);
  assert.equal(get(aggs, "partial_or_unknown_attempts").numerator, 0);
  assert.equal(get(aggs, "labeled_transitions").numerator, 2);
  assert.equal(get(aggs, "labeled_transitions").denominator, 3);
  assert.equal(get(aggs, "unknown_transitions").numerator, 1);
  assert.equal(get(aggs, "revisit_candidates").numerator, 1);
  assert.equal(get(aggs, "revisit_candidates").denominator, 3);
  assert.equal(get(aggs, "loop_clusters").numerator, 1);
  assert.equal(get(aggs, "loop_clusters").denominator, 2);
  assert.equal(get(aggs, "action_category_unknown").numerator, 1);
  assert.equal(get(aggs, "action_category_unknown").denominator, 3);
  const vc = get(aggs, "verifier_coverage");
  assert.equal(vc.numerator, 2);
  assert.equal(vc.denominator, 3);
  assert.match(PUBLIC_GAP_LIMIT, /ADS #1258/);
});

test("strict success counts 1; partial/unverified flagged", () => {
  const base = { summaryAttempts: ["a"], excludedAttempts: [], lineage: lineage([]), labels: [] };
  const strict = computeAggregates({
    ...base,
    assessment: assessment({ outcome_class: "STRICT_TERMINAL_SUCCESS" }),
  });
  assert.equal(get(strict, "strict_verified_attempts").numerator, 1);
  assert.equal(get(strict, "partial_or_unknown_attempts").numerator, 0);
  const part = computeAggregates({
    ...base,
    assessment: assessment({ outcome_class: "PARTIAL_PROGRESS" }),
  });
  assert.equal(get(part, "partial_or_unknown_attempts").numerator, 1);
});

test("unknown stays null, never 0", () => {
  const aggs = computeAggregates({
    summaryAttempts: [],
    excludedAttempts: [],
    assessment: assessment({ outcome_class: "UNVERIFIED", records: [] }),
    lineage: lineage([]),
    labels: [],
  });
  for (const n of NAMES) {
    const a = get(aggs, n);
    assert.equal(a.numerator, null, n);
    assert.equal(a.coverage, "UNKNOWN", n);
    assert.equal(a.epistemic, "UNKNOWN", n);
  }
  assert.equal(get(aggs, "verifier_coverage").denominator, null);
  assert.deepEqual(findForbiddenContent(aggs), []);
});

test("verifier_coverage: stale-only is 0, unknown currentness is null", () => {
  const base = { summaryAttempts: ["a"], excludedAttempts: [], lineage: lineage([]), labels: [] };
  const stale = computeAggregates({
    ...base,
    assessment: assessment({ records: [rec({ currentness: "STALE" })] }),
  });
  assert.equal(get(stale, "verifier_coverage").numerator, 0);
  assert.equal(get(stale, "verifier_coverage").denominator, 3);
  const unk = computeAggregates({
    ...base,
    assessment: assessment({ records: [rec({ currentness: "UNKNOWN" })] }),
  });
  assert.equal(get(unk, "verifier_coverage").numerator, null);
  assert.equal(get(unk, "verifier_coverage").denominator, 3);
  assert.equal(get(unk, "verifier_coverage").coverage, "UNKNOWN");
});
