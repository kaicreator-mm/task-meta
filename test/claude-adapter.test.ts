import assert from "node:assert/strict";
import { test } from "node:test";
import { CLAUDE_HOOK_SCHEMA, parseClaudeHookSpool } from "../src/adapters/claude/hooks.ts";
import { collectClaudeRun, normalizeClaudeUsage } from "../src/adapters/claude/index.ts";
import { parseClaudeTranscript } from "../src/adapters/claude/parse.ts";
import { canonicalDigest, canonicalize } from "../src/canonical.ts";
import type { MetricValue } from "../src/model.ts";
import { assertNoForbiddenContent, findForbiddenContent } from "../src/privacy.ts";
import {
  AGENT,
  basicSession,
  msg,
  prompt,
  SENTINELS,
  SID,
  T,
  toolResult,
  U1,
} from "./fixtures/claude/build.ts";

const actor = {
  role: "builder",
  operator_kind: "agent",
  operator_id: "claude",
  session_ref: SID,
  transport_actor: null,
};
const base = {
  repository: "kaicreator-mm/task-meta",
  issue_number: 2,
  actor,
  observed_at: "2026-10-23T00:00:00.000Z",
};
const H1 = "a".repeat(40);
const H2 = "b".repeat(40);

const metric = (ms: MetricValue[], name: string): MetricValue => {
  const m = ms.find((x) => x.name === name);
  assert.ok(m, `metric ${name} missing`);
  return m;
};

const line = (e: unknown): string => `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;
function hook(over: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: CLAUDE_HOOK_SCHEMA,
    plugin_version: "0.2.1",
    agent: "claude",
    session_id: SID,
    agent_id: null,
    tool_call_id: null,
    tool_name: null,
    received_at: T(0),
    mode: "default",
    model: null,
    session_source: null,
    input_class: null,
    outcome: null,
    error_type: null,
    duration_ms: null,
    result_bytes: null,
    prompt_bytes: null,
    end_reason: null,
    binding_refs: null,
    git_head: null,
    git_dirty: null,
    git_remote_repo: null,
    worktree_refs: null,
    cwd_digest: null,
    ...over,
  };
}

test("exact metrics: duplicate lines per message id counted once, sidechain included, inclusive input", () => {
  const s = basicSession();
  const c = collectClaudeRun({ ...base, transcript: [s.main, s.sub] });
  const ms = c.summary.metrics;
  // 6 distinct message ids (A1..A5 + subagent S1), however many lines each was split into
  assert.equal(metric(ms, "model_requests").value, 6);
  assert.equal(metric(ms, "subagent_requests").value, 1);
  // inclusive input = input + cache_read + cache_creation, per message, exact arithmetic
  assert.equal(metric(ms, "input_tokens").value, 1210 + 1205 + 1313 + 1424 + 602 + 1501);
  assert.equal(metric(ms, "input_tokens").value, 7255);
  assert.equal(metric(ms, "output_tokens").value, 225);
  assert.equal(metric(ms, "cache_read_tokens").value, 6900);
  assert.equal(metric(ms, "cache_write_tokens").value, 330);
  // thinking_tokens is exposed on 5 of 6 responses: the sum is PARTIAL, never padded with 0
  const rs = metric(ms, "reasoning_tokens");
  assert.equal(rs.value, 51);
  assert.equal(rs.coverage, "PARTIAL");
  assert.equal(metric(ms, "tool_calls").value, 4);
  assert.equal(metric(ms, "tool_failures").value, 1);
  // tool_use->tool_result transcript timestamps: [3,5] [6,7] [61,70] [62,63] -> 2000+1000+9000 ms
  assert.equal(metric(ms, "tool_wall_ms").value, 12000);
  assert.equal(metric(ms, "tool_wall_ms").epistemic, "INFERRED");
  // turn 1 T(0)..T(9), turn 2 T(60)..T(72)
  assert.equal(metric(ms, "run_wall_ms").value, 9000 + 12000);
  assert.equal(metric(ms, "model_wall_ms").value, null);
  assert.equal(metric(ms, "model_wall_ms").epistemic, "UNKNOWN");
  assert.equal(metric(ms, "input_tokens").identity?.adapter_id, "claude");
  assert.equal(metric(ms, "input_tokens").identity?.measurement_kind, "COUNTER_DELTA");
  assert.equal(c.sessionId, SID);
  assert.equal(c.summary.cost.value, null);
  assert.ok(c.summary.limits.some((l) => l.includes("inclusive convention")));
  assert.equal(c.summary.capture_coverage, "COMPLETE");
  assert.equal(c.profile.provider_version, "2.1.261");
  assert.equal(c.profile.signals.token_usage?.notes.includes("EXCLUDES cache"), true);
  assert.equal(c.rejected.length, 0);
});

test("the same transcript delivered twice (copy / resumed file) does not double count", () => {
  const s = basicSession();
  const once = collectClaudeRun({ ...base, transcript: [s.main, s.sub] });
  const twice = collectClaudeRun({ ...base, transcript: [s.main, s.main, s.sub, s.sub] });
  const pick = (c: typeof once) =>
    c.summary.metrics.map((m) => [m.name, m.value, m.coverage] as const);
  assert.deepEqual(pick(twice), pick(once));
  assert.equal(twice.observations.length, once.observations.length);
});

test("usage normalization: exact per-message arithmetic and UNKNOWN (never 0) when counters are missing", () => {
  assert.deepEqual(
    normalizeClaudeUsage({ input: 10, cacheRead: 1000, cacheWrite: 200, output: 50, thinking: 20 }),
    {
      input_tokens: 1210,
      output_tokens: 50,
      cache_read_tokens: 1000,
      cache_write_tokens: 200,
      reasoning_tokens: 20,
      total_tokens: 1260,
    },
  );
  const noCache = normalizeClaudeUsage({
    input: 10,
    cacheRead: null,
    cacheWrite: 200,
    output: 50,
    thinking: null,
  });
  assert.equal(noCache.input_tokens, null);
  assert.equal(noCache.total_tokens, null);
  assert.equal(noCache.reasoning_tokens, null);

  const s = basicSession();
  const c = collectClaudeRun({ ...base, transcript: [s.main, s.sub] });
  const a1 = c.observations.find((o) => o.source_event_id === "msg:msg_A1");
  assert.deepEqual(a1?.usage, {
    input_tokens: 1210,
    output_tokens: 50,
    cache_read_tokens: 1000,
    cache_write_tokens: 200,
    reasoning_tokens: 20,
    total_tokens: 1260,
  });
  const a2 = c.observations.find((o) => o.source_event_id === "msg:msg_A2");
  assert.equal(a2?.usage?.reasoning_tokens, null);
  assert.equal(a2?.fields_epistemic["usage.reasoning_tokens"], undefined);

  // a session without any usage object: tokens UNKNOWN, requests still counted
  const bare = [
    prompt(0),
    ...msg({ id: "msg_N1", t: 1, usage: null, blocks: [{ t: "text" }] }),
  ].join("\n");
  const b = collectClaudeRun({ ...base, transcript: `${bare}\n` });
  assert.equal(metric(b.summary.metrics, "model_requests").value, 1);
  for (const n of ["input_tokens", "output_tokens", "cache_read_tokens", "reasoning_tokens"]) {
    const m = metric(b.summary.metrics, n);
    assert.equal(m.value, null, n);
    assert.equal(m.epistemic, "UNKNOWN", n);
  }
  assert.equal(b.summary.capture_coverage, "PARTIAL");

  // no thinking_tokens anywhere => reasoning UNKNOWN, not 0
  const nothink = [
    prompt(0),
    ...msg({
      id: "msg_N2",
      t: 1,
      usage: { input: 1, cr: 2, cw: 3, out: 4 },
      blocks: [{ t: "text" }],
    }),
  ].join("\n");
  const n = collectClaudeRun({ ...base, transcript: `${nothink}\n` });
  assert.equal(metric(n.summary.metrics, "reasoning_tokens").value, null);
  assert.equal(metric(n.summary.metrics, "input_tokens").value, 6);
  assert.equal(metric(n.summary.metrics, "output_tokens").value, 4);
});

test("repeated lines with differing usage keep the largest output_tokens line and flag it", () => {
  const partial = msg({
    id: "msg_P",
    t: 1,
    usage: { input: 5, cr: 10, cw: 0, out: 3 },
    blocks: [{ t: "text" }],
  });
  const final = msg({
    id: "msg_P",
    t: 2,
    usage: { input: 5, cr: 10, cw: 0, out: 40 },
    blocks: [{ t: "text" }],
  });
  const c = collectClaudeRun({
    ...base,
    transcript: `${[prompt(0), ...partial, ...final].join("\n")}\n`,
  });
  assert.equal(metric(c.summary.metrics, "model_requests").value, 1);
  assert.equal(metric(c.summary.metrics, "output_tokens").value, 40);
  assert.equal(metric(c.summary.metrics, "output_tokens").coverage, "PARTIAL");
  assert.ok(c.summary.limits.some((l) => l.includes("differing usage")));
});

test("tool calls pair with tool_result: success, is_error, denied, missing result", () => {
  const lines = [
    prompt(0),
    ...msg({
      id: "msg_T",
      t: 1,
      usage: U1,
      stop: "tool_use",
      blocks: [
        { t: "tool_use", id: "toolu_ok", name: "Bash" },
        { t: "tool_use", id: "toolu_bad", name: "Edit" },
        { t: "tool_use", id: "toolu_den", name: "Write" },
        { t: "tool_use", id: "toolu_open", name: "Read" },
      ],
    }),
    toolResult("toolu_ok", 4),
    toolResult("toolu_bad", 5, { isError: true }),
    toolResult("toolu_den", 6, { isError: true, denied: true }),
  ];
  const c = collectClaudeRun({ ...base, transcript: `${lines.join("\n")}\n` });
  const st = (id: string) => c.observations.find((o) => o.source_event_id === `tool:${id}`)?.status;
  assert.equal(st("toolu_ok"), "success");
  assert.equal(st("toolu_bad"), "failure");
  assert.equal(st("toolu_den"), "denied");
  assert.equal(st("toolu_open"), "NO_RESULT");
  assert.equal(metric(c.summary.metrics, "tool_calls").value, 4);
  assert.equal(metric(c.summary.metrics, "tool_failures").value, 1);
  assert.equal(metric(c.summary.metrics, "tool_calls").coverage, "PARTIAL");
  assert.ok(c.summary.limits.some((l) => l.includes("without a tool_result")));
  // the last turn never closed with an end_turn message
  assert.ok(c.observations.some((o) => o.kind === "RUN_BOUNDARY" && o.status === "OPEN"));
});

test("subagent invocation without a transcript file is reported, not guessed", () => {
  const s = basicSession();
  const c = collectClaudeRun({ ...base, transcript: s.main });
  assert.equal(metric(c.summary.metrics, "model_requests").value, 5);
  assert.equal(metric(c.summary.metrics, "subagent_requests").value, 0);
  assert.equal(metric(c.summary.metrics, "subagent_requests").coverage, "PARTIAL");
  assert.ok(c.summary.limits.some((l) => l.includes("subagent invocation")));
  assert.equal(c.summary.capture_coverage, "PARTIAL");
  // with the subagent file the limit disappears and the agent id is in the request's parent ref
  const full = collectClaudeRun({ ...base, transcript: [s.main, s.sub] });
  assert.ok(!full.summary.limits.some((l) => l.includes("subagent invocation")));
  const sub = full.observations.find((o) => o.source_event_id === "msg:msg_S1");
  assert.equal(sub?.parent_ref, `claude:agent:${AGENT}`);
});

test("truncated last line, foreign sessions, synthetic placeholders and noise records", () => {
  const s = basicSession();
  const foreign = msg({
    id: "msg_F",
    t: 3,
    usage: U1,
    blocks: [{ t: "text" }],
    session: "other-session-id",
  });
  const synthetic = msg({
    id: "msg_SYN",
    t: 4,
    usage: { input: 0, cr: 0, cw: 0, out: 0 },
    blocks: [{ t: "text" }],
    model: "<synthetic>",
  });
  const text = `${s.main}${[...foreign, ...synthetic].join("\n")}\n{"type":"assistant","message":{"id":"msg_TR`;
  const c = collectClaudeRun({ ...base, transcript: [text, s.sub] });
  assert.equal(metric(c.summary.metrics, "model_requests").value, 6);
  assert.equal(c.rejected.length, 1);
  assert.equal(c.rejected[0]?.reason, "truncated trailing line");
  assert.ok(c.summary.limits.some((l) => l.includes("other sessions")));
  assert.ok(c.summary.limits.some((l) => l.includes("placeholder")));
  assert.equal(c.summary.capture_coverage, "PARTIAL");
  assert.throws(() => collectClaudeRun({ ...base, transcript: "{}\n" }), /no session id/);
});

test("planted sentinels never reach observations, summary or capability profile", () => {
  const s = basicSession();
  const c = collectClaudeRun({
    ...base,
    transcript: [s.main, s.sub],
    hookSpool: line(hook({ event: "SessionStart", git_head: H1, session_source: "startup" })),
  });
  const all = { observations: c.observations, summary: c.summary, profile: c.profile };
  assert.deepEqual(findForbiddenContent(all, SENTINELS), []);
  assertNoForbiddenContent(all, SENTINELS);
  const text = JSON.stringify(all);
  for (const x of SENTINELS) assert.ok(!text.includes(x), `leaks ${x}`);
  // the parser output (before any aggregation) is clean too
  const p = JSON.stringify(parseClaudeTranscript(s.main));
  for (const x of SENTINELS) assert.ok(!p.includes(x), `parse leaks ${x}`);
});

test("hook spool: heads, tool duration_ms and Bash class win over transcript timing", () => {
  const s = basicSession();
  const spool =
    line(
      hook({
        event: "SessionStart",
        received_at: T(0),
        git_head: H1,
        git_dirty: false,
        session_source: "startup",
        git_remote_repo: "kaicreator-mm/task-meta",
      }),
    ) +
    line(
      hook({
        event: "PreToolUse",
        received_at: T(3),
        tool_call_id: "toolu_1",
        tool_name: "Bash",
        input_class: "TEST",
      }),
    ) +
    line(
      hook({
        event: "PostToolUse",
        received_at: T(5),
        tool_call_id: "toolu_1",
        tool_name: "Bash",
        outcome: "success",
        duration_ms: 1500,
      }),
    ) +
    line(
      hook({
        event: "PostToolUseFailure",
        received_at: T(7),
        tool_call_id: "toolu_2",
        tool_name: "Read",
        outcome: "interrupt",
      }),
    ) +
    line(hook({ event: "Stop", received_at: T(72), git_head: H2, git_dirty: true })) +
    line(
      hook({
        event: "SessionEnd",
        received_at: T(80),
        end_reason: "other",
        git_head: H2,
        git_dirty: false,
      }),
    );
  const c = collectClaudeRun({ ...base, transcript: [s.main, s.sub], hookSpool: spool });
  assert.equal(c.summary.source_sha, H2);
  assert.equal(c.run.head_before, H1);
  assert.equal(c.run.head_after, H2);
  assert.equal(metric(c.summary.metrics, "hook_events").value, 6);
  assert.equal(c.profile.signals.capture_plugin?.notes, "task-meta-capture@0.2.1");
  assert.equal(c.profile.signals.source_head?.epistemic, "OBSERVED");
  const t1 = c.observations.find((o) => o.source_event_id === "tool:toolu_1");
  assert.equal(t1?.duration_ms, 1500);
  assert.equal(t1?.fields_epistemic.duration_ms, "OBSERVED");
  assert.equal(t1?.tool?.input_class, "TEST");
  const t2 = c.observations.find((o) => o.source_event_id === "tool:toolu_2");
  assert.equal(t2?.status, "interrupt");
  assert.equal(t2?.duration_ms, 1000); // transcript timestamps (no hook duration)
  // hook-measured duration replaces the transcript interval for toolu_1: [3.5, 5] not [3, 5]
  assert.equal(metric(c.summary.metrics, "tool_wall_ms").value, 1500 + 1000 + 9000);
  // the unwritten-source-sha-dirty limit does not fire: the last head-bearing entry is clean
  assert.ok(!c.summary.limits.some((l) => l.includes("dirty")));
});

test("hook spool parser: digest check, truncated tail, duplicates, foreign sessions", () => {
  const good = line(hook({ event: "Stop", git_head: H1 }));
  const forged = good.replace(H1, H2);
  const foreign = line(hook({ event: "Stop", session_id: "someone-else", git_head: H1 }));
  const text = `${good}${good}${forged}${foreign}{"d":"x","e":`;
  const p = parseClaudeHookSpool(text);
  assert.equal(p.entries.length, 2);
  assert.equal(p.duplicates, 1);
  assert.deepEqual(
    p.skipped.map((x) => x.reason),
    ["digest mismatch", "truncated trailing line"],
  );
  const s = basicSession();
  const c = collectClaudeRun({ ...base, transcript: s.main, hookSpool: text });
  assert.ok(c.summary.limits.some((l) => l.includes("from other sessions ignored")));
});
