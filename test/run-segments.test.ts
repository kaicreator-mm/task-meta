import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { collectZcodeRun, type ZcodeRunInput } from "../src/adapters/zcode/index.ts";

const dir = join(import.meta.dirname, "fixtures", "zcode");
const fx = (n: string) => readFileSync(join(dir, n), "utf8");
const H = (c: string) => c.repeat(40);

// Synthetic model-io requests live at 13:10:00Z .. 13:10:40Z.
function seg(startUtc: string, endUtc: string | null, before: string, after: string | null) {
  let t = `started=${startUtc} mode=yolo worktree=x\nhead_before=${before}\n`;
  if (endUtc) t += `exit=0 finished=${endUtc}\n`;
  if (after) t += `head_after=${after}\n`;
  return t;
}
const A = seg("2026-10-22T13:09:00Z", "2026-10-22T13:10:20Z", H("a"), H("b"));
const B = seg("2026-10-22T13:10:30Z", "2026-10-22T13:11:00Z", H("b"), H("c"));

function collect(runRecords: string[], over: Partial<ZcodeRunInput> = {}) {
  return collectZcodeRun({
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor: {
      role: "builder",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: "sess",
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    headless: fx("headless.json.txt"),
    modelIo: fx("model-io.jsonl"),
    runRecords,
    ...over,
  });
}
const runWall = (r: ReturnType<typeof collect>) =>
  r.summary.metrics.find((m) => m.name === "run_wall_ms");

test("multi-segment happy path: COMPLETE, union wall, last head (input order irrelevant)", () => {
  const r = collect([B, A]);
  assert.equal(r.summary.capture_coverage, "COMPLETE");
  assert.equal(r.summary.source_sha, H("c"));
  assert.equal(runWall(r)?.value, 80_000 + 30_000);
  assert.equal(runWall(r)?.coverage, "COMPLETE");
  assert.equal(r.observations.filter((o) => o.kind === "RUN_BOUNDARY").length, 2);
  assert.ok(!r.summary.limits.some((l) => /segment|outside/.test(l)));
});

test("unfinished last segment: PARTIAL, source_sha is the last witnessed head", () => {
  const C = seg("2026-10-22T13:11:10Z", null, H("c"), null);
  const r = collect([A, B, C]);
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.equal(r.summary.source_sha, H("c"));
  assert.ok(r.summary.limits.includes("1 run segment(s) without finish record"));
  assert.ok(
    r.summary.limits.includes(
      "latest run segment unfinished; source_sha is the last witnessed head",
    ),
  );
  assert.equal(runWall(r)?.coverage, "PARTIAL");
  assert.equal(runWall(r)?.value, 110_000);
});

test("all segments unfinished: source_sha null", () => {
  const r = collect([seg("2026-10-22T13:09:00Z", null, H("a"), null)]);
  assert.equal(r.summary.source_sha, null);
  assert.equal(runWall(r)?.value, null);
  assert.equal(r.summary.capture_coverage, "PARTIAL");
});

test("broken head chain is PARTIAL with a specific limit", () => {
  const B2 = seg("2026-10-22T13:10:30Z", "2026-10-22T13:11:00Z", H("d"), H("c"));
  const r = collect([A, B2]);
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.ok(r.summary.limits.includes("run segment head chain broken at 1"));
  assert.equal(r.summary.source_sha, H("c"));
});

test("model request outside all segment windows is PARTIAL", () => {
  const early = seg("2026-10-22T13:10:20Z", "2026-10-22T13:11:00Z", H("a"), H("b"));
  const r = collect([early]);
  assert.equal(r.summary.capture_coverage, "PARTIAL");
  assert.ok(r.summary.limits.includes("2 model request(s) outside recorded run segments"));
});

test("overlapping segments are not double counted", () => {
  const X = seg("2026-10-22T13:09:00Z", "2026-10-22T13:10:00Z", H("a"), H("b"));
  const Y = seg("2026-10-22T13:09:30Z", "2026-10-22T13:11:00Z", H("b"), H("c"));
  const r = collect([X, Y]);
  assert.equal(runWall(r)?.value, 120_000);
});

test("single runRecord still works", () => {
  const r = collectZcodeRun({
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor: {
      role: "builder",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: "sess",
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    headless: fx("headless.json.txt"),
    modelIo: fx("model-io.jsonl"),
    runRecord: fx("run.txt"),
  });
  assert.equal(r.summary.capture_coverage, "COMPLETE");
  assert.equal(r.summary.source_sha, "0123456789abcdef0123456789abcdef01234567");
});
