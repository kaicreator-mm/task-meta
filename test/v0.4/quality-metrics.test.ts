// v0.4 C1 (#70) — six denominator-safe private Capture Quality metrics, T0-fixture only.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeCaptureQuality,
  countPhysicalAttempts,
  type QualityCohortInput,
  unionSpanMs,
} from "../../src/aggregates/quality.ts";
import type { DiagnosticFact } from "../../src/model.ts";

function fact(ref: string, over: Partial<DiagnosticFact> = {}): DiagnosticFact {
  return {
    schema: "task-meta/private-diagnostics/v1",
    source_ref: ref,
    source_revision: 1,
    agent: "zcode",
    plugin_version: "0.3.0",
    host_class: null,
    evidence_level: "SOURCE_ONLY",
    epistemic: "OBSERVED",
    missing_reason: null,
    clock: { domain: "source", precision: "UNKNOWN", synchronized: null },
    ...over,
  };
}

function cohort(over: Partial<QualityCohortInput> = {}): QualityCohortInput {
  return {
    cohort_ref: "private-fixture:cohort-1",
    universe_witnessed: false,
    cohort_facts: [fact("private-fixture:cohort-1")],
    bindings: [],
    tool_calls: [],
    lifecycle: [],
    token_basis: [],
    publication_attempts: [],
    verifier_records: [],
    spans: [],
    ...over,
  };
}

const byName = (metrics: ReturnType<typeof computeCaptureQuality>, name: string) =>
  metrics.find((m) => m.metric_name === name);

test("C1: golden binding 2/3 pairs with CONDITIONAL coverage and no fabricated zero", () => {
  const metrics = computeCaptureQuality(
    cohort({
      bindings: [
        { session_ref: "s1", bound: true, missing_reason: null },
        { session_ref: "s2", bound: true, missing_reason: null },
        { session_ref: "s3", bound: false, missing_reason: null },
      ],
    }),
  );
  const binding = byName(metrics, "binding");
  assert.ok(binding);
  assert.equal(binding.numerator, 2);
  assert.equal(binding.denominator, 3);
  assert.equal(binding.coverage_kind, "CONDITIONAL");
  assert.equal(binding.comparability, "COMPARABLE");
  assert.equal(binding.schema, "task-meta/private-diagnostics/v1");
});

test("C1 R1: two known requests with one pair are 1/2 in a CONDITIONAL cohort, never 1/1", () => {
  const metrics = computeCaptureQuality(
    cohort({
      tool_calls: [
        { call_ref: "c1", response_ref: "r1", missing_reason: null },
        { call_ref: "c2", response_ref: null, missing_reason: "SOURCE_DROPPED" },
      ],
    }),
  );
  const pair = byName(metrics, "tool_pair");
  assert.ok(pair);
  assert.equal(pair.numerator, 1);
  assert.equal(pair.denominator, 2);
  assert.equal(pair.reason, "SOURCE_DROPPED");
  assert.ok(pair.limits.some((l) => l.includes("unpaired requests stay counted")));
});

test("C1: zero/unknown denominators stay null, never a numeric 0 placeholder", () => {
  const empty = computeCaptureQuality(cohort());
  for (const m of empty) {
    assert.equal(m.numerator, null, `${m.metric_name} numerator`);
    assert.equal(m.denominator, null, `${m.metric_name} denominator`);
    assert.equal(m.epistemic, "UNKNOWN");
    assert.ok(m.reason !== null, `${m.metric_name} carries a missing reason`);
  }
  const unboundOnly = computeCaptureQuality(
    cohort({ bindings: [{ session_ref: "s1", bound: null, missing_reason: "UNBOUND" }] }),
  );
  const binding = byName(unboundOnly, "binding");
  assert.ok(binding);
  assert.equal(binding.numerator, null);
  assert.equal(binding.denominator, null);
  assert.equal(binding.reason, "UNBOUND");
});

test("C1: publication reconciliation golden 4 attempts = 3/4 terminal, 1/4 success, 1/4 UNKNOWN", () => {
  const metrics = computeCaptureQuality(
    cohort({
      publication_attempts: [
        { attempt_ref: "a1", status: "PUBLISHED" },
        { attempt_ref: "a2", status: "DENIED" },
        { attempt_ref: "a3", status: "CONFLICT" },
        { attempt_ref: "a4", status: "UNKNOWN" },
      ],
    }),
  );
  const pub = byName(metrics, "publication_reconciliation");
  assert.ok(pub);
  assert.equal(pub.numerator, 3);
  assert.equal(pub.denominator, 4);
  assert.ok(pub.limits.includes("actual_success=1"));
  assert.ok(pub.limits.includes("unresolved_unknown=1"));
});

test("C1: A12 overlapping/nested span union is not a simple sum; cache/child never double count", () => {
  // Two overlapping roots 0-100 and 50-150 union to 150, not 250.
  assert.equal(
    unionSpanMs([
      { ref: "r1", parent_ref: null, kind: "ATTEMPT", start_ms: 0, end_ms: 100 },
      { ref: "r2", parent_ref: null, kind: "ATTEMPT", start_ms: 50, end_ms: 150 },
    ]),
    150,
  );
  // A nested child span (parent_ref set) and a CACHE_HIT span add nothing.
  assert.equal(
    unionSpanMs([
      { ref: "r1", parent_ref: null, kind: "ATTEMPT", start_ms: 0, end_ms: 100 },
      { ref: "child", parent_ref: "r1", kind: "WITNESS", start_ms: 10, end_ms: 90 },
      { ref: "cache", parent_ref: null, kind: "CACHE_HIT", start_ms: 0, end_ms: 100 },
    ]),
    100,
  );
  // An unclosed span contributes no duration; retries stay independent attempts.
  assert.equal(
    unionSpanMs([
      { ref: "r1", parent_ref: null, kind: "ATTEMPT", start_ms: 0, end_ms: 50 },
      { ref: "retry", parent_ref: "r1", kind: "PHYSICAL_RETRY", start_ms: 60, end_ms: null },
    ]),
    50,
  );
  assert.equal(
    countPhysicalAttempts([
      { ref: "r1", parent_ref: null, kind: "ATTEMPT", start_ms: 0, end_ms: 50 },
      { ref: "child", parent_ref: "r1", kind: "WITNESS", start_ms: 0, end_ms: 50 },
      { ref: "retry", parent_ref: "r1", kind: "PHYSICAL_RETRY", start_ms: 60, end_ms: 90 },
      { ref: "cache", parent_ref: null, kind: "CACHE_HIT", start_ms: 0, end_ms: 50 },
    ]),
    2,
  );
});

test("C1: missing pricing universe or price revision => NOT_COMPARABLE, never 0", () => {
  const noUniverse = computeCaptureQuality(
    cohort({
      token_basis: [
        { call_ref: "c1", counted_basis: true, pricing_basis: null, missing_reason: "UNKNOWN" },
      ],
    }),
  );
  const noBasis = byName(noUniverse, "token_cost_basis");
  assert.ok(noBasis);
  assert.equal(noBasis.comparability, "NOT_COMPARABLE");
  // R1: no witnessed pricing revision => no comparable rate is expressible at all.
  assert.equal(noBasis.numerator, null);
  assert.equal(noBasis.denominator, null);
  assert.ok(noBasis.limits.some((l) => l.includes("counted_without_pricing_basis=1")));
  assert.ok(noBasis.limits.some((l) => l.includes("no comparable rate")));

  const mixed = computeCaptureQuality(
    cohort({
      token_basis: [
        { call_ref: "c1", counted_basis: true, pricing_basis: "price@rev1", missing_reason: null },
        { call_ref: "c2", counted_basis: true, pricing_basis: "price@rev2", missing_reason: null },
      ],
    }),
  );
  const token = byName(mixed, "token_cost_basis");
  assert.ok(token);
  assert.equal(token.comparability, "NOT_COMPARABLE");
  assert.ok(token.limits.includes("pricing_basis=price@rev1|price@rev2"));
});

test("C1: ABSOLUTE only when the full eligible universe is witnessed", () => {
  const metrics = computeCaptureQuality(
    cohort({
      universe_witnessed: true,
      tool_calls: [
        { call_ref: "c1", response_ref: "r1", missing_reason: null },
        { call_ref: "c2", response_ref: null, missing_reason: "SOURCE_DROPPED" },
      ],
    }),
  );
  const pair = byName(metrics, "tool_pair");
  assert.ok(pair);
  assert.equal(pair.coverage_kind, "ABSOLUTE");
  assert.equal(pair.numerator, 1);
  assert.equal(pair.denominator, 2);
});

test("C1: lifecycle needs witnessed STOP and SESSION_END; NOT_INSTRUMENTED never fabricates", () => {
  const metrics = computeCaptureQuality(
    cohort({
      lifecycle: [
        {
          session_ref: "s1",
          step: "STOP",
          fact: fact("private-fixture:s1-stop"),
        },
        {
          session_ref: "s1",
          step: "SESSION_END",
          fact: fact("private-fixture:s1-end", { missing_reason: "NOT_INSTRUMENTED" }),
        },
        {
          session_ref: "s2",
          step: "STOP",
          fact: fact("private-fixture:s2-stop"),
        },
        {
          session_ref: "s2",
          step: "SESSION_END",
          fact: fact("private-fixture:s2-end"),
        },
        {
          session_ref: "s3",
          step: "STOP",
          fact: fact("private-fixture:s3-stop", { epistemic: "SELF_REPORTED" }),
        },
        {
          session_ref: "s3",
          step: "SESSION_END",
          fact: fact("private-fixture:s3-end", { epistemic: "SELF_REPORTED" }),
        },
      ],
    }),
  );
  const lifecycle = byName(metrics, "lifecycle");
  assert.ok(lifecycle);
  assert.equal(lifecycle.numerator, 1); // only s2 has both steps OBSERVED
  assert.equal(lifecycle.denominator, 2); // s3's SELF_REPORTED facts prove nothing
  assert.equal(lifecycle.reason, "NOT_INSTRUMENTED");
});

test("C1: verifier_source counts only proven-current records", () => {
  const metrics = computeCaptureQuality(
    cohort({
      verifier_records: [
        { record_ref: "v1", current: true, required_scope: ["src/**"], missing_reason: null },
        { record_ref: "v2", current: false, required_scope: ["src/**"], missing_reason: null },
        { record_ref: "v3", current: null, required_scope: ["src/**"], missing_reason: "UNKNOWN" },
      ],
    }),
  );
  const verifier = byName(metrics, "verifier_source");
  assert.ok(verifier);
  assert.equal(verifier.numerator, 1);
  assert.equal(verifier.denominator, 2);
});
