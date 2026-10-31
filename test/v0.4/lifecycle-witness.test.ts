// v0.4 A2 (#67) — source-qualified Hook lifecycle witness, T0 vocabulary only.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessSessionLifecycle,
  CLIENT_PROFILES,
  type HookEventObservation,
} from "../../src/lifecycle/index.ts";

function ev(over: Partial<HookEventObservation>): HookEventObservation {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    session_ref: "zcode:s1",
    alt_session_ref: null,
    step: "STOP",
    evidence_level: "SOURCE_ONLY",
    epistemic: "OBSERVED",
    missing_reason: null,
    error_class: null,
    observed_at_ms: 1000,
    source_ref: "private-fixture:hooks",
    ...over,
  };
}

test("A2: ZCode SessionEnd absence projects NOT_INSTRUMENTED from the client profile", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "e1", step: "SESSION_START" }),
    ev({ event_id: "e2", step: "STOP" }),
  ]);
  assert.equal(a.terminal_step, "STOP");
  assert.equal(a.session_end_missing_reason, "NOT_INSTRUMENTED");
  assert.ok(a.limits.some((l) => l.includes("NOT_INSTRUMENTED")));
  assert.deepEqual(a.witnessed_steps.sort(), ["SESSION_START", "STOP"]);
});

test("A2: instrumented client with observed-missing SessionEnd projects UNKNOWN cause", () => {
  const a = assessSessionLifecycle("codex:s1", CLIENT_PROFILES.codex, [
    ev({ event_id: "e1", session_ref: "codex:s1", step: "SESSION_START" }),
    ev({ event_id: "e2", session_ref: "codex:s1", step: "STOP" }),
  ]);
  assert.equal(a.terminal_step, "STOP");
  assert.equal(a.session_end_missing_reason, "UNKNOWN");
  assert.ok(a.limits.some((l) => l.includes("cause UNKNOWN")));
});

test("A2: witnessed SessionEnd outranks Stop as the terminal step", () => {
  const a = assessSessionLifecycle("claude:s1", CLIENT_PROFILES.claude, [
    ev({ event_id: "e1", session_ref: "claude:s1", step: "STOP" }),
    ev({ event_id: "e2", session_ref: "claude:s1", step: "SESSION_END" }),
  ]);
  assert.equal(a.terminal_step, "SESSION_END");
  assert.equal(a.session_end_missing_reason, null);
});

test("A2: repeated Stop deliveries are witnessed counts; transport replays de-duplicate", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "stop-1" }),
    ev({ event_id: "stop-2" }),
    ev({ event_id: "stop-2" }), // transport replay of the same event id
    ev({ event_id: "stop-3" }),
  ]);
  assert.equal(a.repeated_stop_deliveries, 2);
});

test("A2: session-id mismatch is flagged, never silently merged or fabricated away", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "e1", alt_session_ref: "zcode:s-other" }),
  ]);
  assert.equal(a.session_id_mismatch, true);
  assert.ok(a.limits.some((l) => l.includes("mismatch")));
});

test("A2: Hook-error classes only as trusted bounded tokens; raw text never leaks", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "e1", step: "HOOK_ERROR", error_class: "SPOOL_WRITE_FAILED" }),
    ev({ event_id: "e2", step: "HOOK_ERROR", error_class: "ENOENT: no such file /raw/path" }),
    ev({ event_id: "e3", step: "HOOK_ERROR", error_class: null }),
    // Non-observed error fact: not trusted.
    ev({
      event_id: "e4",
      step: "HOOK_ERROR",
      error_class: "ADAPTER_FAILURE",
      epistemic: "INFERRED",
    }),
  ]);
  assert.deepEqual(a.hook_error_classes, ["SPOOL_WRITE_FAILED"]);
});

test("A2: fixture evidence never qualifies a real Agent CLI run", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "e1", evidence_level: "REAL_AGENT_CLI" }),
  ]);
  assert.equal(a.real_agent_cli_qualified, false);
  for (const f of a.facts) {
    assert.equal(f.schema, "task-meta/private-diagnostics/v1");
  }
});

test("A2: non-observed or missing-reason events never prove a step", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "e1", step: "STOP", epistemic: "SELF_REPORTED" }),
    ev({ event_id: "e2", step: "SESSION_END", missing_reason: "HOST_EVENT_NOT_OBSERVED" }),
  ]);
  assert.equal(a.terminal_step, null);
  assert.equal(a.terminal_epistemic, "UNKNOWN");
  // Still NOT_INSTRUMENTED from the zcode profile, not the event's own reason.
  assert.equal(a.session_end_missing_reason, "NOT_INSTRUMENTED");
});

test("A2 R1: unproved STOP events never count as repeated Stop deliveries", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "stop-1" }), // proved delivery
    ev({ event_id: "stop-2", missing_reason: "HOST_EVENT_NOT_OBSERVED" }),
    ev({ event_id: "stop-3", missing_reason: "SOURCE_DROPPED" }),
    ev({ event_id: "stop-4", epistemic: "SELF_REPORTED" }),
  ]);
  assert.equal(a.repeated_stop_deliveries, 0);
});

test("A2 R1: a STOP carrying another session's id is not attributed to this session", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "stop-1" }),
    // Same claimed session, but the payload's alternate id disagrees: the
    // delivery belongs to the other session's facts, not s1's.
    ev({ event_id: "stop-2", alt_session_ref: "zcode:s-other" }),
    ev({ event_id: "stop-3", alt_session_ref: "zcode:s-other" }),
  ]);
  assert.equal(a.session_id_mismatch, true);
  assert.equal(a.repeated_stop_deliveries, 0);
  // And identity-doubtful steps never prove this session's terminal either.
  const terminalOnly = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "stop-9", alt_session_ref: "zcode:s-other" }),
  ]);
  assert.equal(terminalOnly.terminal_step, null);
  assert.ok(terminalOnly.limits.some((l) => l.includes("mismatch")));
});

test("A2 R2: facts exclude foreign-session and identity-doubtful events; quarantine is counted", () => {
  const a = assessSessionLifecycle("zcode:s1", CLIENT_PROFILES.zcode, [
    ev({ event_id: "own-1", step: "SESSION_START" }),
    ev({ event_id: "own-2", step: "STOP" }),
    // Foreign session: never this session's fact.
    ev({ event_id: "foreign-1", session_ref: "zcode:s-other", step: "STOP" }),
    // Identity-doubtful: claimed s1 but the alternate id disagrees.
    ev({ event_id: "doubt-1", alt_session_ref: "zcode:s-other" }),
  ]);
  assert.equal(a.facts.length, 2);
  assert.ok(a.facts.every((f) => f.agent === "zcode"));
  assert.ok(a.facts.every((f) => f.source_ref !== "private-fixture:foreign"));
  assert.equal(a.quarantined_foreign_events, 2);
  assert.ok(a.limits.some((l) => l.includes("quarantined_foreign_events=2")));
  assert.equal(a.session_id_mismatch, true);
});

test("A2 R2: facts inherit the client profile agent; no silent prefix fallback", () => {
  // Session ref carries no recognizable prefix; the agent still comes from the
  // profile instead of being silently mapped to zcode.
  const a = assessSessionLifecycle("opaque-session-9", CLIENT_PROFILES.codex, [
    ev({ event_id: "e1", session_ref: "opaque-session-9" }),
  ]);
  assert.equal(a.agent, "codex");
  assert.ok(a.facts.every((f) => f.agent === "codex"));
});
