import assert from "node:assert/strict";
import { test } from "node:test";
import { CODEX_CAPABILITY, collectCodexRun } from "../src/adapters/codex/index.ts";
import { parseCodexRollout, repoNameFromRemote } from "../src/adapters/codex/parse.ts";
import { assertNoForbiddenContent, findForbiddenContent } from "../src/privacy.ts";
import {
  add,
  basicSession,
  COMMIT,
  join,
  request,
  resetOrdinal,
  SENTINELS,
  SID,
  sessionMeta,
  T,
  toolCall,
  turnEnd,
  turnStart,
  usage,
  ZERO,
} from "./fixtures/codex/build.ts";

type Input = Parameters<typeof collectCodexRun>[0];

function base(rollout: string | string[], over: Partial<Input> = {}): Input {
  return {
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor: {
      role: "builder",
      operator_kind: "agent",
      operator_id: "codex",
      session_ref: SID,
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    rollout,
    ...over,
  };
}
const metric = (r: ReturnType<typeof collectCodexRun>, n: string) => {
  const m = r.summary.metrics.find((x) => x.name === n);
  assert.ok(m, `metric ${n}`);
  return m;
};

test("allowlist: sentinels in every content-bearing field never reach the collection", () => {
  const { text } = basicSession();
  for (const s of SENTINELS)
    assert.ok(text.includes(s) || s.startsWith("ghp_") || s.startsWith("C:"), s);
  const r = collectCodexRun(base(text));
  const blob = JSON.stringify(r);
  for (const s of SENTINELS) assert.ok(!blob.includes(s), `leaks ${s}`);
  for (const s of ["someone", "SENTINEL", "kaicreator-mm/task-meta.git", "github.com"]) {
    assert.ok(!blob.includes(s), `leaks ${s}`);
  }
  assert.deepEqual(findForbiddenContent(r.observations, SENTINELS), []);
  assert.deepEqual(findForbiddenContent(r.summary, SENTINELS), []);
  assert.deepEqual(findForbiddenContent(r.profile, SENTINELS), []);
  assert.deepEqual(findForbiddenContent(r.run, SENTINELS), []);
  assertNoForbiddenContent({ o: r.observations, s: r.summary, p: r.profile });
  const parsed = parseCodexRollout(text);
  assert.deepEqual(findForbiddenContent(parsed.session, SENTINELS), []);
  assert.deepEqual(findForbiddenContent(parsed.items, SENTINELS), []);
  assert.deepEqual(findForbiddenContent(parsed.calls, SENTINELS), []);
  // cwd is reduced to a digest, the remote to owner/name, the branch is dropped.
  assert.match(String(parsed.session?.cwdDigest), /^[0-9a-f]{64}$/);
  assert.equal(parsed.session?.gitRepo, "kaicreator-mm/task-meta");
  assert.equal(parsed.session?.gitCommit, COMMIT);
});

test("per-response usage deltas sum exactly; input includes cached, reasoning is observed", () => {
  const { text, total } = basicSession();
  const r = collectCodexRun(base(text));
  assert.equal(metric(r, "model_requests").value, 5);
  assert.equal(metric(r, "input_tokens").value, total.input_tokens);
  assert.equal(metric(r, "input_tokens").value, 10000);
  assert.equal(metric(r, "output_tokens").value, 500);
  assert.equal(metric(r, "cache_read_tokens").value, 9200);
  assert.equal(metric(r, "cache_write_tokens").value, 0);
  assert.equal(metric(r, "reasoning_tokens").value, 70);
  assert.equal(metric(r, "reasoning_tokens").epistemic, "OBSERVED");
  assert.equal(metric(r, "input_tokens").identity?.measurement_kind, "COUNTER_DELTA");
  // never summed with the running totals: input + output equals the final thread total
  assert.equal(
    (metric(r, "input_tokens").value as number) + (metric(r, "output_tokens").value as number),
    total.total_tokens,
  );
  assert.equal(r.summary.capture_coverage, "COMPLETE");
  assert.equal(metric(r, "input_tokens").coverage, "COMPLETE");
  assert.equal(metric(r, "model_wall_ms").value, null);
  assert.equal(metric(r, "model_wall_ms").epistemic, "UNKNOWN");
  const req = r.observations.filter((o) => o.kind === "MODEL_REQUEST");
  assert.equal(req.length, 5);
  assert.equal(req[0]?.model?.model_id, "gpt-test-1");
  assert.equal(req[0]?.model?.provider_id, "openai");
  assert.equal(req[0]?.usage?.reasoning_tokens, 20);
});

test("every metric carries a v5 identity; unknown ones are UNKNOWN, never 0", () => {
  const r = collectCodexRun(base(basicSession().text));
  for (const m of r.summary.metrics) {
    assert.ok(m.identity, m.name);
    assert.equal(m.identity.adapter_id, "codex");
    assert.equal(m.identity.metric_id, `task-meta:${SID}:${m.name}`);
    if (m.value === null) {
      assert.equal(m.identity.measurement_kind, "UNKNOWN");
      assert.equal(m.epistemic, "UNKNOWN");
    } else {
      assert.match(m.identity.window_id, /^codex:window:/);
      assert.ok(!m.identity.window_id.endsWith(":unknown"), m.name);
    }
  }
  assert.equal(r.summary.attempt_ref, SID);
  assert.equal(r.summary.cost.basis, "UNKNOWN");
});

test("cumulative-only token_count (no last_token_usage) is differenced into deltas", () => {
  resetOrdinal();
  const d = [usage(1000, 500, 100, 10), usage(1800, 1500, 50, 5), usage(2500, 2400, 90, 0)];
  let run = ZERO;
  const th = d.map((x) => {
    run = add(run, x);
    return run;
  });
  const text = join(
    sessionMeta(),
    turnStart("t1", 10),
    ...d.map((x, i) =>
      request({
        responseId: `r${i}`,
        turn: "t1",
        s: 12 + i,
        delta: x,
        thread: th[i] as typeof run,
        onlyTokenCount: { withLast: false },
      }),
    ),
    turnEnd("t1", 10, 20),
  );
  const r = collectCodexRun(base(text));
  assert.equal(metric(r, "model_requests").value, 3);
  assert.equal(metric(r, "input_tokens").value, 5300);
  assert.equal(metric(r, "output_tokens").value, 240);
  assert.equal(metric(r, "cache_read_tokens").value, 4400);
  assert.equal(metric(r, "reasoning_tokens").value, 15);
  // derived from cumulative readings => CUMULATIVE_SNAPSHOT, and the limit says so
  assert.equal(metric(r, "input_tokens").identity?.measurement_kind, "CUMULATIVE_SNAPSHOT");
  assert.ok(r.limits.some((l) => /differencing cumulative totals/.test(l)));
  assert.ok(r.limits.some((l) => /no token_usage_record/.test(l)));
  // request count is a plain counter either way
  assert.equal(metric(r, "model_requests").identity?.measurement_kind, "COUNTER_DELTA");
});

test("token_count with last_token_usage is a COUNTER_DELTA; repeated cumulative lines add nothing", () => {
  resetOrdinal();
  const d = [usage(1000, 500, 100), usage(1800, 1500, 50)];
  const th = [
    d[0] as ReturnType<typeof usage>,
    add(d[0] as ReturnType<typeof usage>, d[1] as ReturnType<typeof usage>),
  ];
  const first = request({
    responseId: "a",
    turn: "t1",
    s: 12,
    delta: d[0] as ReturnType<typeof usage>,
    thread: th[0] as ReturnType<typeof usage>,
    onlyTokenCount: { withLast: true },
  });
  const second = request({
    responseId: "b",
    turn: "t1",
    s: 14,
    delta: d[1] as ReturnType<typeof usage>,
    thread: th[1] as ReturnType<typeof usage>,
    onlyTokenCount: { withLast: true },
  });
  // the same cumulative reading delivered again later (e.g. a re-emitted status line)
  const repeat = request({
    responseId: "b2",
    turn: "t1",
    s: 15,
    delta: d[1] as ReturnType<typeof usage>,
    thread: th[1] as ReturnType<typeof usage>,
    onlyTokenCount: { withLast: true },
  });
  const text = join(
    sessionMeta(),
    turnStart("t1", 10),
    first,
    second,
    repeat,
    turnEnd("t1", 10, 20),
  );
  const r = collectCodexRun(base(text));
  assert.equal(metric(r, "model_requests").value, 2);
  assert.equal(metric(r, "input_tokens").value, 2800);
  assert.equal(metric(r, "input_tokens").identity?.measurement_kind, "COUNTER_DELTA");
  assert.ok(r.limits.some((l) => /1 repeated cumulative token_count/.test(l)));
});

test("token_count with null info and no usage anywhere => UNKNOWN, not 0", () => {
  resetOrdinal();
  const nullInfo = JSON.stringify({
    timestamp: T(12),
    ordinal: 99,
    type: "event_msg",
    payload: { type: "token_count", info: null, rate_limits: { plan_type: "SENTINEL_PLAN_9e9e" } },
  });
  const text = join(sessionMeta(), turnStart("t1", 10), nullInfo, turnEnd("t1", 10, 20));
  const r = collectCodexRun(base(text));
  for (const n of [
    "model_requests",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "reasoning_tokens",
  ]) {
    assert.equal(metric(r, n).value, null, n);
    assert.equal(metric(r, n).epistemic, "UNKNOWN", n);
    assert.equal(metric(r, n).coverage, "UNKNOWN", n);
  }
  assert.ok(r.limits.some((l) => /without usage info/.test(l)));
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.ok(!JSON.stringify(r).includes("SENTINEL_PLAN"));
});

test("a usage line without counters is rejected, other fields stay null (UNKNOWN per field)", () => {
  resetOrdinal();
  const partial = JSON.stringify({
    timestamp: T(12),
    ordinal: 5,
    type: "token_usage_record",
    payload: {
      response_id: "r-partial",
      turn_id: "t1",
      usage: { input_tokens: 700, output_tokens: 30 },
    },
  });
  const empty = JSON.stringify({
    timestamp: T(13),
    ordinal: 6,
    type: "token_usage_record",
    payload: { response_id: "r-empty", turn_id: "t1", usage: {} },
  });
  const r = collectCodexRun(
    base(join(sessionMeta(), turnStart("t1", 10), partial, empty, turnEnd("t1", 10, 20))),
  );
  assert.equal(metric(r, "model_requests").value, 1);
  assert.equal(metric(r, "input_tokens").value, 700);
  assert.equal(metric(r, "cache_read_tokens").value, null);
  assert.equal(metric(r, "reasoning_tokens").value, null);
  assert.equal(r.rejected.length, 1);
  assert.equal(metric(r, "model_requests").coverage, "PARTIAL");
});

test("duplicate delivery (same file twice, repeated lines) never double counts", () => {
  const { text } = basicSession();
  const once = collectCodexRun(base(text));
  const twice = collectCodexRun(base([text, text]));
  for (const n of [
    "model_requests",
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "tool_calls",
    "tool_executions",
  ]) {
    assert.equal(metric(twice, n).value, metric(once, n).value, n);
  }
  assert.ok(twice.limits.some((l) => /duplicate delivery record/.test(l)));
  // repeated lines inside one file
  const lines = text.split("\n").filter(Boolean);
  const dupLine = lines.filter((l) => l.includes('"token_usage_record"'));
  const r = collectCodexRun(base(`${text}${dupLine.join("\n")}\n`));
  assert.equal(metric(r, "model_requests").value, 5);
  assert.equal(metric(r, "input_tokens").value, 10000);
});

test("same response id with different counters is a flagged revision, latest counted once", () => {
  resetOrdinal();
  const a = request({
    responseId: "r1",
    turn: "t1",
    s: 12,
    delta: usage(100, 50, 10),
    thread: usage(100, 50, 10),
  });
  const b = request({
    responseId: "r1",
    turn: "t1",
    s: 12,
    delta: usage(120, 50, 10),
    thread: usage(120, 50, 10),
  });
  const r = collectCodexRun(
    base(join(sessionMeta(), turnStart("t1", 10), a, b, turnEnd("t1", 10, 20))),
  );
  assert.equal(metric(r, "model_requests").value, 1);
  assert.equal(metric(r, "input_tokens").value, 120);
  assert.equal(metric(r, "input_tokens").coverage, "PARTIAL");
  assert.ok(r.limits.some((l) => /conflicting revisions/.test(l)));
});

test("tool calls pair with outputs; unpaired calls are flagged; items give timing and failures", () => {
  const r = collectCodexRun(base(basicSession().text));
  const calls = r.observations.filter((o) => o.kind === "TOOL_CALL");
  assert.equal(calls.length, 2);
  const c1 = calls.find((o) => o.tool?.call_id === "call-1");
  assert.deepEqual(c1?.tool, { call_id: "call-1", name: "exec" });
  assert.equal(c1?.status, "completed");
  assert.equal(c1?.started_at, T(13));
  assert.equal(c1?.completed_at, T(15));
  assert.equal(c1?.duration_ms, 2000);
  assert.equal(c1?.step_ref, "turn-1");
  assert.equal(calls.find((o) => o.tool?.call_id === "call-2")?.tool?.name, "sleep");
  assert.equal(metric(r, "tool_calls").value, 2);
  assert.equal(metric(r, "tool_executions").value, 4);
  assert.equal(metric(r, "tool_failures").value, 2);
  // [13s,16s] covers cmd-1/cmd-2; mcp [18.000,18.090] covers the file change => 3000 + 90
  assert.equal(metric(r, "tool_wall_ms").value, 3090);
  assert.equal(metric(r, "run_wall_ms").value, 16500);

  resetOrdinal();
  const text = join(
    sessionMeta(),
    turnStart("t1", 10),
    toolCall("c-open", "t1", 12, { output: false }),
    toolCall("c-done", "t1", 13),
    turnEnd("t1", 10, 20),
  );
  const u = collectCodexRun(base(text));
  assert.equal(u.observations.find((o) => o.tool?.call_id === "c-open")?.status, "NO_OUTPUT");
  assert.equal(u.observations.find((o) => o.tool?.call_id === "c-open")?.completed_at, null);
  assert.ok(u.limits.some((l) => /1 tool call\(s\) without an output line/.test(l)));
  assert.equal(metric(u, "tool_calls").value, 2);
});

test("run boundaries: aborted and still-open turns", () => {
  resetOrdinal();
  const text = join(
    sessionMeta(),
    turnStart("t1", 10),
    request({
      responseId: "r1",
      turn: "t1",
      s: 12,
      delta: usage(100, 50, 10),
      thread: usage(100, 50, 10),
    }),
    turnEnd("t1", 10, 20, "turn_aborted"),
    turnStart("t2", 30),
    request({
      responseId: "r2",
      turn: "t2",
      s: 32,
      delta: usage(100, 50, 10),
      thread: usage(200, 100, 20),
    }),
  );
  const r = collectCodexRun(base(text));
  const rb = r.observations.filter((o) => o.kind === "RUN_BOUNDARY");
  assert.equal(rb.find((o) => o.step_ref === "t1")?.status, "ABORTED_INTERRUPTED");
  assert.equal(rb.find((o) => o.step_ref === "t2")?.status, "OPEN");
  assert.equal(rb.find((o) => o.step_ref === "t2")?.completed_at, null);
  assert.ok(r.limits.some((l) => /1 turn\(s\) without completion/.test(l)));
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.equal(metric(r, "run_wall_ms").coverage, "PARTIAL");
  assert.equal(r.run.finished_at, null);
  assert.equal(metric(r, "input_tokens").value, 200);
});

test("truncated trailing line (live session) and garbage lines are rejected, not fatal", () => {
  const { text } = basicSession();
  const live = `${text}{"timestamp":"${T(40)}","ordinal":9999,"type":"token_usage_rec`;
  const r = collectCodexRun(base(`${live}`));
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0]?.reason, "truncated trailing line");
  assert.equal(metric(r, "input_tokens").value, 10000);
  assert.equal(metric(r, "input_tokens").coverage, "PARTIAL");
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  const noise = collectCodexRun(base(`not json\n[1]\n{"type":"x"}\n${text}`));
  assert.equal(noise.rejected.length, 3);
  assert.equal(metric(noise, "model_requests").value, 5);
});

test("counter mismatch against the running thread total is flagged, deltas kept", () => {
  resetOrdinal();
  const d1 = usage(100, 50, 10);
  const d2 = usage(200, 100, 20);
  const r = collectCodexRun(
    base(
      join(
        sessionMeta(),
        turnStart("t1", 10),
        request({ responseId: "r1", turn: "t1", s: 12, delta: d1, thread: d1 }),
        // reported thread total jumps by more than this response's delta (a response is missing)
        request({ responseId: "r2", turn: "t1", s: 14, delta: d2, thread: usage(900, 100, 70) }),
        turnEnd("t1", 10, 20),
      ),
    ),
  );
  assert.ok(r.limits.some((l) => /disagree with the running thread total/.test(l)));
  assert.equal(metric(r, "input_tokens").value, 300);
  assert.equal(metric(r, "input_tokens").coverage, "PARTIAL");
});

test("continuation file: base + child sum exactly; the child alone is PARTIAL", () => {
  const d = [usage(1000, 800, 100, 10), usage(1500, 1200, 60, 0), usage(2000, 1900, 140, 40)];
  const th = [
    d[0] as typeof ZERO,
    add(d[0] as typeof ZERO, d[1] as typeof ZERO),
    add(add(d[0] as typeof ZERO, d[1] as typeof ZERO), d[2] as typeof ZERO),
  ];
  resetOrdinal();
  const baseText = join(
    sessionMeta(),
    turnStart("t1", 10),
    request({
      responseId: "r1",
      turn: "t1",
      s: 12,
      delta: d[0] as typeof ZERO,
      thread: th[0] as typeof ZERO,
    }),
    request({
      responseId: "r2",
      turn: "t1",
      s: 14,
      delta: d[1] as typeof ZERO,
      thread: th[1] as typeof ZERO,
    }),
    turnEnd("t1", 10, 20),
  );
  resetOrdinal(8);
  const child = join(
    sessionMeta({ historyBase: { thread_id: SID, end_ordinal_exclusive: 8 } }),
    turnStart("t2", 100),
    request({
      responseId: "r3",
      turn: "t2",
      s: 102,
      delta: d[2] as typeof ZERO,
      thread: th[2] as typeof ZERO,
    }),
    turnEnd("t2", 100, 110),
  );
  const both = collectCodexRun(base([baseText, child]));
  assert.equal(metric(both, "model_requests").value, 3);
  assert.equal(metric(both, "input_tokens").value, 4500);
  assert.equal(metric(both, "output_tokens").value, 300);
  assert.equal(both.summary.capture_coverage, "COMPLETE");
  assert.ok(!both.limits.some((l) => /continuation/.test(l)));
  // order of the files does not matter
  const swapped = collectCodexRun(base([child, baseText]));
  assert.equal(metric(swapped, "input_tokens").value, 4500);
  assert.equal(swapped.summary.capture_coverage, "COMPLETE");

  const alone = collectCodexRun(base(child));
  assert.equal(metric(alone, "input_tokens").value, 2000);
  assert.equal(metric(alone, "input_tokens").coverage, "PARTIAL");
  assert.equal(alone.summary.capture_coverage, "PARTIAL");
  assert.ok(alone.limits.some((l) => /continuation rollout without its base file/.test(l)));
});

test("rollout of another thread is ignored; no session_meta is an error", () => {
  const { text } = basicSession();
  resetOrdinal();
  const foreign = join(
    sessionMeta({ id: "01a1ffff-0000-7000-8000-000000000000" }),
    turnStart("tf", 10),
    request({
      responseId: "rf",
      turn: "tf",
      s: 12,
      delta: usage(999, 0, 1),
      thread: usage(999, 0, 1),
    }),
  );
  const r = collectCodexRun(base([text, foreign]));
  assert.equal(metric(r, "input_tokens").value, 10000);
  assert.ok(r.limits.some((l) => /rollout file\(s\) of other threads ignored/.test(l)));
  assert.throws(() => collectCodexRun(base("{}\n")), /no session_meta/);
});

test("session facts: git commit is a start head, not a source sha; run segment for lineage", () => {
  const r = collectCodexRun(base(basicSession().text));
  assert.equal(r.summary.source_sha, null);
  assert.equal(r.run.head_before, COMMIT);
  assert.equal(r.run.head_after, null);
  assert.equal(r.run.started_at, T(10).replace(".000Z", ".000Z"));
  assert.equal(r.run.finished_at, new Date(Date.parse(T(30)) + 5250).toISOString());
  assert.ok(r.limits.some((l) => /source SHA at the end of the session not witnessed/.test(l)));
  assert.equal(r.summary.verifier.status, "NOT_RUN");
  assert.equal(r.summary.attempt_binding, "COLLECTOR_ONLY");
});

test("capability profile is honest about what is unknown", () => {
  assert.equal(CODEX_CAPABILITY.adapter_id, "codex");
  assert.equal(CODEX_CAPABILITY.signals.reasoning_tokens?.epistemic, "OBSERVED");
  assert.equal(CODEX_CAPABILITY.signals.billed_cost?.supported, false);
  assert.equal(CODEX_CAPABILITY.signals.tool_input_class?.supported, false);
  assert.ok(CODEX_CAPABILITY.known_gaps.some((g) => /model_wall_ms/.test(g)));
  assert.equal(CODEX_CAPABILITY.signals.token_usage?.notes.includes("INCLUDES cached"), true);
});

test("remote url parsing keeps owner/name only", () => {
  assert.equal(repoNameFromRemote("https://github.com/o/n.git"), "o/n");
  assert.equal(repoNameFromRemote("git@github.com:o/n.git"), "o/n");
  assert.equal(repoNameFromRemote("https://tok:en@github.com/o/n"), "o/n");
  assert.equal(repoNameFromRemote("nonsense"), null);
  assert.equal(repoNameFromRemote(42), null);
});
