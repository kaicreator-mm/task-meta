import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseGateLog } from "../src/adapters/zcode/parse.ts";
import { findForbiddenContent } from "../src/privacy.ts";
import { assessVerifiers, parseTaskCheckLog, toVerifierOutcome } from "../src/verifier/index.ts";

const fx = (n: string) => readFileSync(join(import.meta.dirname, "fixtures/verifier", n), "utf8");
const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const obs = (
  ref: string,
  sha: string | null = SHA,
  b: "OBSERVED" | "INFERRED" | "UNKNOWN" = "OBSERVED",
) => ({ ref, subject_sha: sha, subject_binding: b });
const ALL = ["task-check:lint", "task-check:typecheck", "task-check:test"];

test("green log parses to checked steps, summed cases, node major, verdict-only exit qualifier", () => {
  const r = parseTaskCheckLog(fx("green.txt"), obs("g1"));
  assert.deepEqual(r.checked, ALL);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.cases, {
    total: 15,
    passed: 14,
    failed: 0,
    skipped: 1,
    epistemic: "OBSERVED",
  });
  assert.deepEqual(r.environment, { node_major: "24" });
  assert.equal(r.exit_code, null);
  assert.equal(r.epistemic, "OBSERVED");
  assert.equal(r.currentness, "UNKNOWN");
  assert.equal(r.verifier_version, null);
  assert.deepEqual(r.unchecked, ["task-acceptance"]);
  const q = r.qualifiers.find((x) => x.kind === "exit_code_capture");
  assert.equal(q?.value, "verdict_line_only");
  assert.deepEqual(findForbiddenContent(r), []);
});

test("green + CURRENT + OBSERVED binding => STRICT_TERMINAL_SUCCESS and PASS", () => {
  const rec = parseTaskCheckLog(fx("green.txt"), obs("g1"));
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "STRICT_TERMINAL_SUCCESS");
  assert.equal(a.records[0]?.currentness, "CURRENT");
  const o = toVerifierOutcome(a, SHA);
  assert.equal(o.status, "PASS");
  assert.equal(o.subject_sha, SHA);
  assert.equal(o.coverage, "PARTIAL");
  assert.equal(o.epistemic, "OBSERVED");
  assert.ok(o.unchecked.includes("task-acceptance"));
});

test("INFERRED binding => PARTIAL_PROGRESS with a limit", () => {
  const rec = parseTaskCheckLog(fx("green.txt"), obs("g1", SHA, "INFERRED"));
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "PARTIAL_PROGRESS");
  assert.ok(a.limits.some((l) => l.includes("binding INFERRED")));
  assert.equal(toVerifierOutcome(a, SHA).status, "PARTIAL");
});

test("green on an older SHA is STALE => PARTIAL_PROGRESS", () => {
  const rec = parseTaskCheckLog(fx("green.txt"), obs("g1", OLD));
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.records[0]?.currentness, "STALE");
  assert.equal(a.outcome_class, "PARTIAL_PROGRESS");
  assert.equal(toVerifierOutcome(a, SHA).subject_sha, OLD);
});

test("unknown attempt sha or null subject => currentness UNKNOWN, never strict", () => {
  const rec = parseTaskCheckLog(fx("green.txt"), obs("g1", SHA));
  const a = assessVerifiers({ records: [rec], attempt_source_sha: null });
  assert.equal(a.records[0]?.currentness, "UNKNOWN");
  assert.equal(a.outcome_class, "PARTIAL_PROGRESS");
  const b = assessVerifiers({
    records: [parseTaskCheckLog(fx("green.txt"), obs("g2", null, "UNKNOWN"))],
    attempt_source_sha: SHA,
  });
  assert.equal(b.outcome_class, "PARTIAL_PROGRESS");
});

test("many passing cases but failed test step => TERMINAL_FAILURE", () => {
  const rec = parseTaskCheckLog(fx("failed-test.txt"), obs("f1"));
  assert.deepEqual(rec.failed, ["task-check:test"]);
  assert.deepEqual(rec.checked, ["task-check:lint", "task-check:typecheck"]);
  assert.equal(rec.cases.passed, 19);
  assert.ok(rec.unchecked.includes("task-check:test"));
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "TERMINAL_FAILURE");
  const o = toVerifierOutcome(a, SHA);
  assert.equal(o.status, "FAIL");
  assert.deepEqual(o.failed, ["task-check:test"]);
});

test("PASS and FAIL records on the same current SHA => conflict + UNVERIFIED (no latest-wins)", () => {
  const pass = parseTaskCheckLog(fx("green.txt"), obs("g1"));
  const fail = parseTaskCheckLog(fx("failed-test.txt"), obs("f1"));
  for (const records of [
    [pass, fail],
    [fail, pass],
  ]) {
    const a = assessVerifiers({ records, attempt_source_sha: SHA });
    assert.equal(a.outcome_class, "UNVERIFIED");
    assert.equal(a.conflicts.length, 1);
    assert.ok(a.conflicts[0]?.includes("g1") && a.conflicts[0]?.includes("f1"));
    const o = toVerifierOutcome(a, SHA);
    assert.equal(o.status, "UNKNOWN");
    assert.equal(o.subject_sha, null);
    assert.deepEqual(o.checked, []);
    assert.equal(o.epistemic, "UNKNOWN");
  }
});

test("current failure plus stale pass is a failure, not a conflict", () => {
  const pass = parseTaskCheckLog(fx("green.txt"), obs("g1", OLD));
  const fail = parseTaskCheckLog(fx("failed-test.txt"), obs("f1"));
  const a = assessVerifiers({ records: [pass, fail], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "TERMINAL_FAILURE");
  assert.deepEqual(a.conflicts, []);
});

test("DOCS_ONLY => PARTIAL_PROGRESS with docs_only qualifier", () => {
  const rec = parseTaskCheckLog(fx("docs-only.txt"), obs("d1"));
  assert.deepEqual(rec.checked, []);
  assert.deepEqual(rec.skipped, ALL);
  assert.ok(rec.qualifiers.some((q) => q.kind === "docs_only_fast_lane"));
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "PARTIAL_PROGRESS");
  assert.equal(toVerifierOutcome(a, SHA).status, "PARTIAL");
});

test("truncated log (no verdict, no EXIT) => UNKNOWN epistemic => UNVERIFIED", () => {
  const rec = parseTaskCheckLog(fx("truncated.txt"), obs("t1"));
  assert.equal(rec.epistemic, "UNKNOWN");
  assert.deepEqual(rec.checked, ["task-check:lint", "task-check:typecheck"]);
  assert.equal(rec.exit_code, null);
  assert.deepEqual(rec.environment, { node_major: "22" });
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "UNVERIFIED");
  assert.equal(toVerifierOutcome(a, SHA).status, "UNKNOWN");
});

test("EXIT=2 without a verdict line is a failure", () => {
  const rec = parseTaskCheckLog(fx("exit2-no-verdict.txt"), obs("e1"));
  assert.equal(rec.exit_code, 2);
  assert.equal(rec.epistemic, "OBSERVED");
  assert.deepEqual(rec.failed, ["task-check:test"]);
  assert.equal(
    rec.qualifiers.some((q) => q.kind === "exit_code_capture"),
    false,
  );
  assert.equal(rec.cases.total, 4);
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "TERMINAL_FAILURE");
});

test("non-zero EXIT with no step header still fails closed", () => {
  const rec = parseTaskCheckLog("EXIT=1\n", obs("e2"));
  assert.deepEqual(rec.failed, ["task-check"]);
});

test("skipped step lines are announced skips, not checked", () => {
  const rec = parseTaskCheckLog(fx("skips.txt"), obs("s1"));
  assert.deepEqual(rec.checked, ["task-check:lint", "task-check:test"]);
  assert.deepEqual(rec.skipped, ["task-check:typecheck"]);
  assert.equal(rec.exit_code, 0);
  assert.ok(rec.unchecked.includes("task-check:typecheck"));
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "PARTIAL_PROGRESS");
  // ...unless the declared required scope excludes the skipped step.
  const b = assessVerifiers({
    records: [rec],
    attempt_source_sha: SHA,
    required_scope: ["task-check:lint", "task-check:test"],
  });
  assert.equal(b.outcome_class, "STRICT_TERMINAL_SUCCESS");
});

test("required scope wider than the gate is never strict", () => {
  const rec = parseTaskCheckLog(fx("green.txt"), obs("g1"));
  const a = assessVerifiers({
    records: [rec],
    attempt_source_sha: SHA,
    required_scope: [...ALL, "e2e"],
  });
  assert.equal(a.outcome_class, "PARTIAL_PROGRESS");
  assert.ok(a.records[0]?.unchecked.includes("e2e"));
});

test("no cases found => all null + UNKNOWN; partial steps with exit 0 are not strict", () => {
  const rec = parseTaskCheckLog("== lint ==\nEXIT=0\n", obs("x1"));
  assert.deepEqual(rec.cases, {
    total: null,
    passed: null,
    failed: null,
    skipped: null,
    epistemic: "UNKNOWN",
  });
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "PARTIAL_PROGRESS");
});

test("run exit 1 while gate green: conflict recorded, outcome from the gate", () => {
  const rec = parseTaskCheckLog(fx("green.txt"), obs("g1"));
  const a = assessVerifiers({ records: [rec], attempt_source_sha: SHA, run_exit_codes: [1] });
  assert.equal(a.outcome_class, "STRICT_TERMINAL_SUCCESS");
  assert.equal(a.conflicts.length, 1);
  const f = parseTaskCheckLog(fx("failed-test.txt"), obs("f1"));
  const b = assessVerifiers({ records: [f], attempt_source_sha: SHA, run_exit_codes: [0, null] });
  assert.equal(b.outcome_class, "TERMINAL_FAILURE");
  assert.equal(b.conflicts.length, 1);
});

test("no records => UNVERIFIED / NOT_RUN / UNKNOWN coverage", () => {
  const a = assessVerifiers({ records: [], attempt_source_sha: SHA });
  assert.equal(a.outcome_class, "UNVERIFIED");
  const o = toVerifierOutcome(a, SHA);
  assert.equal(o.status, "NOT_RUN");
  assert.equal(o.coverage, "UNKNOWN");
  assert.equal(o.subject_sha, null);
});

test("toVerifierOutcome never reports COMPLETE coverage", () => {
  for (const f of ["green.txt", "failed-test.txt", "docs-only.txt", "truncated.txt"]) {
    const a = assessVerifiers({
      records: [parseTaskCheckLog(fx(f), obs(f))],
      attempt_source_sha: SHA,
    });
    assert.notEqual(toVerifierOutcome(a, SHA).coverage, "COMPLETE", f);
  }
});

test("no paths or forbidden content in records, assessments or outcomes", () => {
  const recs = ["green.txt", "failed-test.txt", "docs-only.txt", "truncated.txt", "skips.txt"].map(
    (f) => parseTaskCheckLog(fx(f), obs(f)),
  );
  const a = assessVerifiers({ records: recs, attempt_source_sha: SHA, run_exit_codes: [1] });
  assert.deepEqual(findForbiddenContent(a), []);
  assert.deepEqual(findForbiddenContent(toVerifierOutcome(a, SHA)), []);
});

test("existing parseGateLog still works", () => {
  const g = parseGateLog("task-check: 全绿\nEXIT=0\n", SHA);
  assert.equal(g.exitCode, 0);
  assert.equal(g.greenMarker, true);
});
