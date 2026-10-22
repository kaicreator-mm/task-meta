import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeObservations, unionIntervalMs } from "../src/correlate.ts";
import type { ObservationRecord } from "../src/model.ts";

function obs(id: string, extra: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    observation_id: id,
    source_event_id: id,
    source_revision: 1,
    adapter_id: "zcode",
    kind: "MODEL_REQUEST",
    task_ref: null,
    run_ref: "r",
    attempt_ref: "r",
    step_ref: null,
    parent_ref: null,
    logical_call_ref: null,
    physical_attempt_ref: null,
    started_at: null,
    completed_at: null,
    duration_ms: null,
    model: null,
    tool: null,
    usage: null,
    status: null,
    fields_epistemic: {},
    privacy_class: "PROJECT_PRIVATE",
    ...extra,
  };
}

test("identical delivery is dropped and counted", () => {
  const r = dedupeObservations([obs("a"), obs("a"), obs("b")]);
  assert.equal(r.unique.length, 2);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.revisions, []);
});

test("same id with different content becomes revision 2 and is listed", () => {
  const r = dedupeObservations([obs("a"), obs("a", { status: "x" }), obs("a", { status: "y" })]);
  assert.equal(r.unique.length, 3);
  assert.deepEqual(
    r.unique.map((u) => u.source_revision),
    [1, 2, 3],
  );
  assert.deepEqual(r.revisions, ["a"]);
  // redelivery of revision 2 content is a duplicate, not revision 4
  const again = dedupeObservations([
    obs("a"),
    obs("a", { status: "x" }),
    obs("a", { status: "x" }),
  ]);
  assert.equal(again.unique.length, 2);
  assert.equal(again.duplicates, 1);
});

test("key order does not matter for duplicate detection", () => {
  const a = obs("a", { fields_epistemic: { x: "OBSERVED", y: "OBSERVED" } });
  const b = obs("a", { fields_epistemic: { y: "OBSERVED", x: "OBSERVED" } });
  assert.equal(dedupeObservations([a, b]).duplicates, 1);
});

test("unionIntervalMs merges overlaps and keeps gaps", () => {
  assert.equal(unionIntervalMs([]), 0);
  assert.equal(
    unionIntervalMs([
      [0, 10000],
      [5000, 15000],
    ]),
    15000,
  );
  assert.equal(
    unionIntervalMs([
      [0, 10000],
      [20000, 30000],
    ]),
    20000,
  );
  assert.equal(
    unionIntervalMs([
      [0, 100],
      [10, 20],
    ]),
    100,
  );
  assert.equal(
    unionIntervalMs([
      [20, 30],
      [0, 10],
      [10, 20],
    ]),
    30,
  );
  assert.equal(unionIntervalMs([[5, 1]]), 0);
});
