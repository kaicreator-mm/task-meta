import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { collectZcodeRun, type ZcodeRunInput } from "../src/adapters/zcode/index.ts";

const dir = join(import.meta.dirname, "fixtures", "zcode");
const fx = (n: string) => readFileSync(join(dir, n), "utf8");
const SID = "sess-synth-0001";

function base(): ZcodeRunInput {
  return {
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor: {
      role: "implementer",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: SID,
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    headless: fx("headless.json.txt"),
    modelIo: fx("model-io.jsonl"),
    runRecord: fx("run.txt"),
    gateLog: fx("gate-pass.log"),
  };
}
const metrics = (i: ZcodeRunInput) => collectZcodeRun(i).summary.metrics;
const byName = (ms: ReturnType<typeof metrics>, n: string) => {
  const m = ms.find((x) => x.name === n);
  assert.ok(m?.identity, `identity of ${n}`);
  return m;
};

test("every metric carries identity, including UNKNOWN ones", () => {
  for (const m of metrics(base())) {
    const id = m.identity;
    assert.ok(id, m.name);
    assert.equal(id.metric_id, `task-meta:${SID}:${m.name}`);
    assert.equal(id.logical_call_ref, `zcode:attempt:${SID}`);
    assert.equal(id.physical_attempt_ref, `zcode:attempt:${SID}`);
    assert.equal(id.adapter_id, "zcode");
    assert.equal(id.provider_run_ref, null);
    assert.ok(id.source_revision >= 1);
  }
});

test("observed metrics point at their stream; UNKNOWN ones at the unobserved ref", () => {
  const ms = metrics(base());
  const req = byName(ms, "model_requests").identity;
  assert.equal(req?.observation_id, `zcode:model-io:${SID}`);
  assert.equal(req?.measurement_kind, "COUNTER_DELTA");
  assert.equal(byName(ms, "run_wall_ms").identity?.observation_id, `zcode:run-record:${SID}`);
  const reasoning = byName(ms, "reasoning_tokens");
  assert.equal(reasoning.value, null);
  assert.equal(reasoning.identity?.observation_id, `zcode:unobserved:${SID}`);
  assert.equal(reasoning.identity?.measurement_kind, "UNKNOWN");
  assert.equal(reasoning.identity?.window_id, `zcode:window:${SID}:unknown`);
});

test("window ids use first start and last end ISO times", () => {
  const ms = metrics(base());
  const w = byName(ms, "model_wall_ms").identity?.window_id ?? "";
  assert.match(
    w,
    new RegExp(
      `^zcode:window:${SID}:\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z/\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z$`,
    ),
  );
  assert.equal(byName(ms, "input_tokens").identity?.window_id, w);
  const rw = byName(ms, "run_wall_ms").identity?.window_id ?? "";
  assert.match(rw, new RegExp(`^zcode:window:${SID}:\\d{4}-.*Z/\\d{4}-.*Z$`));
});

test("headless fallback metrics cite the session ref with an unknown window", () => {
  const i = base();
  const { modelIo: _m, ...noIo } = i;
  const ms = metrics(noIo);
  const req = byName(ms, "model_requests");
  assert.ok(req.value !== null);
  assert.equal(req.identity?.observation_id, `zcode:session:${SID}`);
  assert.equal(req.identity?.window_id, `zcode:window:${SID}:unknown`);
  assert.equal(byName(ms, "tool_calls").identity?.observation_id, `zcode:unobserved:${SID}`);
});

test("no run record: run_wall_ms is UNKNOWN with the unknown window", () => {
  const { runRecord: _r, ...noRun } = base();
  const rw = byName(metrics(noRun), "run_wall_ms");
  assert.equal(rw.value, null);
  assert.equal(rw.identity?.measurement_kind, "UNKNOWN");
  assert.equal(rw.identity?.window_id, `zcode:window:${SID}:unknown`);
});
