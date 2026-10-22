import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { collectZcodeRun, type ZcodeRunInput } from "../src/adapters/zcode/index.ts";
import {
  parseGateLog,
  parseHeadlessResult,
  parseModelIo,
  parseRunRecord,
} from "../src/adapters/zcode/parse.ts";
import { findForbiddenContent } from "../src/privacy.ts";

const dir = join(import.meta.dirname, "fixtures", "zcode");
const fx = (n: string) => readFileSync(join(dir, n), "utf8");
const HEAD_AFTER = "0123456789abcdef0123456789abcdef01234567";

const SENTINELS = [
  "SENTINEL_PROMPT_7f3a",
  "SENTINEL_SYSTEM_91bc",
  "SENTINEL_RESPONSE_c0de",
  "SENTINEL_TOOLARG_3d2e",
  "SENTINEL_PROVMETA_8812",
  "SENTINEL_COOKIE_55aa",
  "SENTINEL_PROJECTION_77ee",
  "ghp_SENTINELSENTINEL1234",
  "C:\\Users\\someone",
];

function base(over: Partial<ZcodeRunInput> = {}): ZcodeRunInput {
  return {
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor: {
      role: "implementer",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: "sess",
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    headless: fx("headless.json.txt"),
    modelIo: fx("model-io.jsonl"),
    runRecord: fx("run.txt"),
    gateLog: fx("gate-pass.log"),
    ...over,
  };
}
// exactOptionalPropertyTypes: explicitly-undefined optionals need removal, not assignment.
function without(over: Partial<Record<keyof ZcodeRunInput, null>>): ZcodeRunInput {
  const b: Record<string, unknown> = { ...base() };
  for (const k of Object.keys(over)) delete b[k];
  return b as unknown as ZcodeRunInput;
}
const metric = (r: ReturnType<typeof collectZcodeRun>, n: string) => {
  const m = r.summary.metrics.find((x) => x.name === n);
  assert.ok(m, `metric ${n}`);
  return m;
};
const headlessJson = () => JSON.parse(fx("headless.json.txt").split("\n").slice(1).join("\n"));

test("headless result with warning prefix parses and drops response/projection", () => {
  const h = parseHeadlessResult(fx("headless.json.txt"));
  assert.ok(h);
  assert.equal(h.sessionId, "sess-synth-0001");
  assert.equal(h.usage.modelRequestCount, 3);
  assert.equal(h.eventCount, 42);
  assert.deepEqual(findForbiddenContent(h, SENTINELS), []);
  assert.equal(parseHeadlessResult("no json here"), null);
  assert.equal(parseHeadlessResult("{ broken"), null);
});

test("parseModelIo allowlists fields and rejects malformed lines without throwing", () => {
  const text = `${fx("model-io.jsonl")}{not json\n{"type":"other"}\n[1]\n`;
  const { records, rejected } = parseModelIo(text);
  assert.equal(records.length, 3);
  assert.equal(rejected.length, 3);
  assert.deepEqual(rejected.map((r) => r.line).sort(), [4, 5, 6]);
  assert.deepEqual(findForbiddenContent(records, SENTINELS), []);
  assert.deepEqual(records[0]?.toolCalls, [
    { id: "tool-1", name: "Read" },
    { id: "tool-2", name: "Bash" },
  ]);
});

test("parseRunRecord extracts boundaries in UTC and keeps no paths", () => {
  const r = parseRunRecord(fx("run.txt"));
  assert.equal(r.started_at, "2026-10-22T13:10:00.000Z");
  assert.equal(r.finished_at, "2026-10-22T13:12:00.000Z");
  assert.equal(r.exit_code, 0);
  assert.equal(r.head_after, HEAD_AFTER);
  assert.deepEqual(findForbiddenContent(r, SENTINELS), []);
  assert.deepEqual(parseRunRecord(""), {
    started_at: null,
    finished_at: null,
    exit_code: null,
    head_before: null,
    head_after: null,
  });
  assert.equal(parseRunRecord("head_after=nothex\n").head_after, null);
});

test("gate log: EXIT=0, EXIT=2, no EXIT, unbound sha", () => {
  const pass = parseGateLog(fx("gate-pass.log"), HEAD_AFTER);
  assert.equal(pass.outcome.status, "PASS");
  assert.equal(pass.greenMarker, true);
  assert.deepEqual(pass.outcome.unchecked, ["task-acceptance"]);
  assert.equal(pass.outcome.coverage, "PARTIAL");
  assert.equal(pass.outcome.epistemic, "OBSERVED");
  assert.deepEqual(pass.outcome.checked, [
    "task-check:lint",
    "task-check:typecheck",
    "task-check:test",
  ]);

  const fail = parseGateLog(fx("gate-fail.log"), HEAD_AFTER);
  assert.equal(fail.outcome.status, "FAIL");
  assert.deepEqual(fail.outcome.failed, ["task-check"]);

  const none = parseGateLog("lint ok\n", HEAD_AFTER);
  assert.equal(none.outcome.status, "NOT_RUN");
  assert.equal(none.outcome.epistemic, "UNKNOWN");
  assert.equal(none.outcome.coverage, "UNKNOWN");

  assert.equal(parseGateLog(fx("gate-pass.log"), null).outcome.status, "UNKNOWN");
  // last EXIT line wins
  assert.equal(parseGateLog("EXIT=0\nEXIT=3\n", HEAD_AFTER).outcome.status, "FAIL");
});

test("full collection is COMPLETE with expected metrics and identities", () => {
  const r = collectZcodeRun(base());
  const s = r.summary;
  assert.equal(s.capture_coverage, "COMPLETE");
  assert.equal(s.attempt_binding, "COLLECTOR_ONLY");
  assert.equal(s.source_sha, HEAD_AFTER);
  assert.equal(s.task_ref, "kaicreator-mm/task-meta#7");
  assert.deepEqual(s.attempt_refs, ["sess-synth-0001"]);
  assert.deepEqual(
    s.metrics.map((m) => m.name),
    [
      "model_requests",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "reasoning_tokens",
      "tool_calls",
      "model_wall_ms",
      "run_wall_ms",
    ],
  );
  assert.equal(metric(r, "model_requests").value, 3); // retry attempt counted
  assert.equal(metric(r, "input_tokens").value, 4000); // not inflated by cache
  assert.equal(metric(r, "output_tokens").value, 270);
  assert.equal(metric(r, "cache_read_tokens").value, 2300);
  assert.equal(metric(r, "cache_write_tokens").value, 200);
  assert.equal(metric(r, "tool_calls").value, 3);
  assert.equal(metric(r, "model_wall_ms").value, 25000); // [0,10]+[5,15] union=15s, +10s
  assert.equal(metric(r, "run_wall_ms").value, 120000);
  assert.equal(metric(r, "model_requests").unit, "count");
  assert.equal(metric(r, "input_tokens").unit, "tokens");
  assert.equal(metric(r, "model_wall_ms").unit, "ms");
  assert.equal(s.verifier.status, "PASS");
  assert.equal(s.verifier.subject_sha, HEAD_AFTER);
  assert.equal(s.cost.basis, "UNKNOWN");
  assert.ok(s.observation_refs.length <= 10);

  const ids = r.observations.map((o) => o.observation_id);
  assert.ok(ids.includes("zcode:req-1#1"));
  assert.ok(ids.includes("zcode:req-1#2"));
  const req1 = r.observations.find((o) => o.observation_id === "zcode:req-1#2");
  assert.equal(req1?.logical_call_ref, "req-1");
  assert.equal(req1?.physical_attempt_ref, "req-1#2");
  const tool = r.observations.find((o) => o.kind === "TOOL_CALL" && o.tool?.call_id === "tool-1");
  assert.equal(tool?.parent_ref, "zcode:req-1#1");
  assert.equal(tool?.started_at, null);
  assert.ok(r.observations.some((o) => o.kind === "SESSION_SUMMARY"));
  assert.ok(r.observations.some((o) => o.kind === "RUN_BOUNDARY"));
  assert.ok(r.observations.some((o) => o.kind === "VERIFIER_RESULT"));
});

test("reasoning_tokens is never 0 (headless reported 0)", () => {
  for (const r of [collectZcodeRun(base()), collectZcodeRun(without({ modelIo: null }))]) {
    const m = metric(r, "reasoning_tokens");
    assert.equal(m.value, null);
    assert.equal(m.epistemic, "UNKNOWN");
    for (const o of r.observations) {
      if (o.usage) assert.equal(o.usage.reasoning_tokens, null);
    }
  }
});

test("duplicate delivery of a model_io line is counted once", () => {
  const first = fx("model-io.jsonl").split("\n")[0] ?? "";
  const r = collectZcodeRun(base({ modelIo: `${first}\n${fx("model-io.jsonl")}` }));
  assert.equal(metric(r, "model_requests").value, 3);
  assert.equal(metric(r, "input_tokens").value, 4000);
  assert.ok(r.summary.limits.some((l) => l.includes("1 duplicate")));
});

test("conflicting revision of same requestId#attempt keeps both, latest counted", () => {
  const lines = fx("model-io.jsonl").split("\n");
  const changed = JSON.parse(lines[2] ?? "{}");
  changed.response.usage.outputTokens = 999;
  changed.response.usage.totalTokens = 2999;
  const text = `${fx("model-io.jsonl")}${JSON.stringify(changed)}\n`;
  const r = collectZcodeRun(base({ modelIo: text }));
  const revs = r.observations.filter((o) => o.observation_id === "zcode:req-2#1");
  assert.equal(revs.length, 2);
  assert.deepEqual(revs.map((o) => o.source_revision).sort(), [1, 2]);
  assert.equal(metric(r, "model_requests").value, 3);
  assert.equal(metric(r, "output_tokens").value, 100 + 120 + 999);
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.ok(r.summary.limits.some((l) => l.includes("conflicting revisions")));
});

test("malformed model_io line is rejected, not thrown, and degrades coverage", () => {
  const r = collectZcodeRun(base({ modelIo: `${fx("model-io.jsonl")}{garbage\n` }));
  assert.equal(r.rejected.length, 1);
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.equal(metric(r, "model_requests").value, 3);
});

test("headless-only fallback is SELF_REPORTED / PARTIAL", () => {
  const r = collectZcodeRun(without({ modelIo: null }));
  const m = metric(r, "input_tokens");
  assert.equal(m.value, 4000);
  assert.equal(m.epistemic, "SELF_REPORTED");
  assert.equal(m.coverage, "PARTIAL");
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.equal(metric(r, "tool_calls").value, null);
  assert.equal(metric(r, "model_wall_ms").value, null);
});

test("headless/rollout count mismatch keeps rollout numbers, PARTIAL with limit", () => {
  const h = headlessJson();
  h.usage.modelRequestCount = 5;
  const r = collectZcodeRun(base({ headless: JSON.stringify(h) }));
  assert.equal(metric(r, "model_requests").value, 3);
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.ok(r.summary.limits.some((l) => l.includes("modelRequestCount=5") && l.includes("=3")));
});

test("model-io only (no headless) works and is PARTIAL", () => {
  const r = collectZcodeRun(without({ headless: null }));
  assert.equal(r.summary.attempt_ref, "sess-synth-0001");
  assert.equal(r.summary.capture_coverage, "PARTIAL");
});

test("missing run.txt: run_wall_ms null/UNKNOWN, source_sha null, verifier UNKNOWN", () => {
  const r = collectZcodeRun(without({ runRecord: null }));
  const m = metric(r, "run_wall_ms");
  assert.equal(m.value, null);
  assert.equal(m.epistemic, "UNKNOWN");
  assert.equal(r.summary.source_sha, null);
  assert.equal(r.summary.verifier.status, "UNKNOWN");
  assert.equal(r.summary.capture_coverage, "PARTIAL");
});

test("gate EXIT=2 and absent gate log flow into the summary verifier", () => {
  const f = collectZcodeRun(base({ gateLog: fx("gate-fail.log") }));
  assert.equal(f.summary.verifier.status, "FAIL");
  const n = collectZcodeRun(without({ gateLog: null }));
  assert.equal(n.summary.verifier.status, "NOT_RUN");
  assert.ok(!n.observations.some((o) => o.kind === "VERIFIER_RESULT"));
});

test("neither headless nor usable model-io: throws", () => {
  assert.throws(() => collectZcodeRun(without({ headless: null, modelIo: null })), /session/);
  assert.throws(
    () => collectZcodeRun({ ...without({ headless: null, modelIo: null }), modelIo: "{bad\n" }),
    /session/,
  );
});

test("headless without usage yields UNKNOWN token metrics, never 0", () => {
  const r = collectZcodeRun({
    ...without({ headless: null, modelIo: null, runRecord: null, gateLog: null }),
    headless: '{"sessionId":"s9"}',
  });
  assert.equal(metric(r, "input_tokens").value, null);
  assert.equal(metric(r, "input_tokens").epistemic, "UNKNOWN");
});

test("privacy: collected output contains no forbidden content; raw fixtures do", () => {
  const out = collectZcodeRun(base());
  assert.deepEqual(findForbiddenContent(out, SENTINELS), []);
  // Mutation check: the guard really flags the raw inputs.
  const rawIo = fx("model-io.jsonl")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const violations = findForbiddenContent(rawIo, SENTINELS);
  assert.ok(violations.length > 0);
  assert.ok(violations.some((v) => v.includes("SENTINEL_PROMPT_7f3a")));
  assert.ok(violations.some((v) => v.includes("forbidden key")));
  assert.ok(findForbiddenContent(headlessJson(), SENTINELS).length > 0);
  // and the raw run.txt text carries an absolute path the guard flags
  assert.ok(findForbiddenContent({ line: "C:\\Users\\someone\\wt" }).length > 0);
});
