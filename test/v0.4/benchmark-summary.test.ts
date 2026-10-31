import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BenchmarkRecord,
  resolveSourceSha,
  summarize,
} from "../../scripts/bench-task-meta-summary.ts";

const records = (walls: number[], kind = "ON"): BenchmarkRecord[] =>
  walls.map((hook_wall_ms) => ({
    kind,
    hook_wall_ms,
    exit_code: 0,
    stop_to_outbox_ms: kind === "ON" ? hook_wall_ms + 100 : null,
    spool_bytes: kind === "ON" ? 842 : null,
    outbox: kind === "ON" ? { state: "HELD" } : null,
    absence_witnessed: kind === "OFF",
  }));

test("C2: odd sample median sorts values and uses the middle element", () => {
  const input = records([9, 1, 5]);
  const before = structuredClone(input);
  const summary = summarize(input, "ON");
  assert.deepEqual(summary.hook_wall_ms, { n: 3, min: 1, median: 5, max: 9 });
  assert.deepEqual(summary.stop_to_outbox_ms, { n: 3, min: 101, median: 105, max: 109 });
  assert.deepEqual(input, before);
});

test("C2: even sample median averages both middle values for each cohort", () => {
  const input = [...records([8, 1, 4, 2]), ...records([20, 10], "OFF")];
  const on = summarize(input, "ON");
  const off = summarize(input, "OFF");
  assert.deepEqual(on.hook_wall_ms, { n: 4, min: 1, median: 3, max: 8 });
  assert.deepEqual(on.stop_to_outbox_ms, { n: 4, min: 101, median: 103, max: 108 });
  assert.deepEqual(off.hook_wall_ms, { n: 2, min: 10, median: 15, max: 20 });
  assert.equal(off.stop_to_outbox_ms, undefined);
  assert.equal(off.absence_witnessed, true);
});

test("C2: empty, singleton and missing outbox timings retain honest sample counts", () => {
  assert.deepEqual(summarize([], "ON").hook_wall_ms, { n: 0 });
  const input = records([7]);
  input.push({ kind: "ON", hook_wall_ms: 3, exit_code: 0, stop_to_outbox_ms: null });
  const on = summarize(input, "ON");
  assert.deepEqual(on.hook_wall_ms, { n: 2, min: 3, median: 5, max: 7 });
  assert.deepEqual(on.stop_to_outbox_ms, { n: 1, min: 107, median: 107, max: 107 });
  assert.deepEqual(on.outbox_states, ["HELD", "MISSING"]);
});

test("C2: explicit source SHA never evaluates Git fallback; absent SHA does once", () => {
  const explicit = "b".repeat(40);
  assert.equal(
    resolveSourceSha(explicit, () => {
      throw new Error("Git fallback must not run for an explicit --source-sha");
    }),
    explicit,
  );
  let calls = 0;
  assert.equal(
    resolveSourceSha(undefined, () => {
      calls += 1;
      return "a".repeat(40);
    }),
    "a".repeat(40),
  );
  assert.equal(calls, 1);
});
