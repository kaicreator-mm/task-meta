import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunRecord } from "../src/adapters/zcode/parse.ts";
import { sha256Hex } from "../src/canonical.ts";
import { buildLineage, type GitExec, makeGitExec } from "../src/lineage/index.ts";
import { findForbiddenContent } from "../src/privacy.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

function seg(n: number, before: string | null, after: string | null, finished = true): RunRecord {
  return {
    started_at: `2026-01-01T00:0${n}:00.000Z`,
    finished_at: finished ? `2026-01-01T00:0${n}:30.000Z` : null,
    exit_code: finished ? 0 : null,
    head_before: before,
    head_after: after,
  };
}

function fakeGit(known: string[], diffs: Record<string, string> = {}): GitExec {
  return async (args) => {
    const sha = args[args.length - 1] ?? "";
    switch (args[0]) {
      case "cat-file":
        return known.includes(sha) ? { stdout: "commit\n", code: 0 } : { stdout: "", code: 128 };
      case "rev-list":
        return { stdout: sha === A ? `${sha}\n` : `${sha} ${A}\n`, code: 0 };
      case "show":
        return { stdout: "2026-01-01T09:00:00+08:00\n", code: 0 };
      case "diff": {
        const key = `${args[args.length - 2]}..${sha}`;
        if (args.includes("--shortstat")) {
          return {
            stdout: diffs[`${key}:stat`] ?? " 2 files changed, 5 insertions(+), 1 deletion(-)\n",
            code: 0,
          };
        }
        return { stdout: diffs[key] ?? `diff-of-${key}`, code: 0 };
      }
    }
    return { stdout: "", code: 1 };
  };
}

test("dedupes repeated SHA into one version with all refs", async () => {
  const l = await buildLineage({
    attempt_ref: "att",
    runs: [seg(1, A, B), seg(2, B, B)],
    git: fakeGit([A, B]),
  });
  assert.equal(l.versions.length, 2);
  const vb = l.versions.find((v) => v.sha === B);
  assert.deepEqual(vb?.observed_in, ["run-segment:1", "run-segment:2"]);
  assert.equal(vb?.observability, "COMMITTED");
  assert.deepEqual(vb?.parents, [A]);
  assert.equal(vb?.first_seen_at, "2026-01-01T01:00:00.000Z");
  assert.equal(vb?.version_id, `git:${B}`);
});

test("NO_CHANGE yields zero change when git confirms", async () => {
  const l = await buildLineage({ attempt_ref: "att", runs: [seg(1, A, A)], git: fakeGit([A]) });
  const t = l.transitions[0];
  assert.equal(t?.kind, "NO_CHANGE");
  assert.equal(t?.change.files_changed, 0);
  assert.equal(t?.change.diff_digest, null);
  const nogit = await buildLineage({ attempt_ref: "att", runs: [seg(1, A, A)] });
  assert.equal(nogit.transitions[0]?.change.files_changed, null);
});

test("ADVANCE parses shortstat and digests diff", async () => {
  const l = await buildLineage({ attempt_ref: "att", runs: [seg(1, A, B)], git: fakeGit([A, B]) });
  const t = l.transitions[0];
  assert.equal(t?.kind, "ADVANCE");
  assert.equal(t?.transition_id, "att#run-segment:1");
  assert.equal(t?.from_version, `git:${A}`);
  assert.equal(t?.to_version, `git:${B}`);
  assert.deepEqual([t?.change.files_changed, t?.change.insertions, t?.change.deletions], [2, 5, 1]);
  assert.equal(t?.change.diff_digest, sha256Hex(`diff-of-${A}..${B}`));
  assert.deepEqual(t?.verifier_refs, []);
});

test("empty shortstat gives zeros", async () => {
  const l = await buildLineage({
    attempt_ref: "att",
    runs: [seg(1, A, B)],
    git: fakeGit([A, B], { [`${A}..${B}:stat`]: "", [`${A}..${B}`]: "" }),
  });
  assert.deepEqual(
    [l.transitions[0]?.change.files_changed, l.transitions[0]?.change.insertions],
    [0, 0],
  );
});

test("A->B->A is a REVISIT and not a new version", async () => {
  const l = await buildLineage({
    attempt_ref: "att",
    runs: [seg(1, A, B), seg(2, B, A)],
    git: fakeGit([A, B]),
  });
  assert.equal(l.versions.length, 2);
  assert.deepEqual(
    l.transitions.map((t) => t.kind),
    ["ADVANCE", "REVISIT"],
  );
  assert.deepEqual(l.revisits, [{ version_id: `git:${A}`, transition_ids: ["att#run-segment:2"] }]);
  assert.deepEqual(l.limits, []);
});

test("INCOMPLETE unfinished segment has no to_version", async () => {
  const l = await buildLineage({
    attempt_ref: "att",
    runs: [seg(1, A, B, false)],
    git: fakeGit([A, B]),
  });
  const t = l.transitions[0];
  assert.equal(t?.kind, "INCOMPLETE");
  assert.equal(t?.to_version, null);
  assert.ok(t?.limits.length);
  assert.equal(t?.change.diff_digest, null);
});

test("missing head_before is UNKNOWN", async () => {
  const l = await buildLineage({ attempt_ref: "att", runs: [seg(1, null, B)], git: fakeGit([B]) });
  assert.equal(l.transitions[0]?.kind, "UNKNOWN");
  assert.equal(l.transitions[0]?.from_version, null);
});

test("unknown SHA in repo", async () => {
  const l = await buildLineage({ attempt_ref: "att", runs: [seg(1, A, D)], git: fakeGit([A]) });
  const vd = l.versions.find((v) => v.sha === D);
  assert.equal(vd?.observability, "UNKNOWN");
  assert.equal(vd?.parents, null);
  assert.ok(l.limits.includes(`sha ${D.slice(0, 7)} not found in git`));
  assert.equal(l.transitions[0]?.kind, "ADVANCE");
  assert.equal(l.transitions[0]?.change.diff_digest, null);
});

test("no git available", async () => {
  const l = await buildLineage({ attempt_ref: "att", runs: [seg(1, A, B)] });
  assert.ok(l.limits.includes("git not available; parents unknown"));
  for (const v of l.versions) {
    assert.equal(v.observability, "UNKNOWN");
    assert.equal(v.epistemic, "OBSERVED");
    assert.equal(v.parents, null);
    assert.equal(v.first_seen_at, null);
  }
  assert.equal(l.transitions[0]?.kind, "ADVANCE");
});

test("broken head chain adds a limit and keeps both versions", async () => {
  const l = await buildLineage({
    attempt_ref: "att",
    runs: [seg(1, A, B), seg(2, C, D)],
    git: fakeGit([A, B, C, D]),
  });
  assert.equal(l.versions.length, 4);
  assert.ok(l.limits.includes("head chain broken before run-segment:2"));
});

test("diff_digest is stable and changes with content", async () => {
  const run = [seg(1, A, B)];
  const d1 = await buildLineage({ attempt_ref: "att", runs: run, git: fakeGit([A, B]) });
  const d2 = await buildLineage({ attempt_ref: "att", runs: run, git: fakeGit([A, B]) });
  const d3 = await buildLineage({
    attempt_ref: "att",
    runs: run,
    git: fakeGit([A, B], { [`${A}..${B}`]: "different" }),
  });
  assert.equal(d1.transitions[0]?.change.diff_digest, d2.transitions[0]?.change.diff_digest);
  assert.notEqual(d1.transitions[0]?.change.diff_digest, d3.transitions[0]?.change.diff_digest);
  assert.match(d1.transitions[0]?.change.diff_digest ?? "", /^[0-9a-f]{64}$/);
});

test("segmentRefs align with the original (unsorted) runs order", async () => {
  const runs = [seg(2, B, A), seg(1, A, B)];
  const l = await buildLineage({
    attempt_ref: "att",
    runs,
    segmentRefs: ["ref-late", "ref-early"],
    git: fakeGit([A, B]),
  });
  assert.deepEqual(
    l.transitions.map((t) => t.run_segment_ref),
    ["ref-early", "ref-late"],
  );
  assert.deepEqual(
    l.transitions.map((t) => t.kind),
    ["ADVANCE", "REVISIT"],
  );
  const dflt = await buildLineage({ attempt_ref: "att", runs, git: fakeGit([A, B]) });
  assert.deepEqual(
    dflt.transitions.map((t) => t.run_segment_ref),
    ["run-segment:1", "run-segment:2"],
  );
});

test("real temporary git repo: A -> B -> A revisit, no diff text or file names leak", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lineage-"));
  try {
    const g = (...a: string[]): string =>
      execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], {
        encoding: "utf8",
      }).trim();
    g("init", "-q");
    writeFileSync(join(dir, "planted-secret-name.txt"), "alpha\n");
    g("add", ".");
    g("commit", "-q", "-m", "a");
    const a = g("rev-parse", "HEAD");
    writeFileSync(join(dir, "planted-secret-name.txt"), "alpha\nPLANTED_BODY_TEXT\n");
    g("commit", "-q", "-am", "b");
    const b = g("rev-parse", "HEAD");
    const exec = makeGitExec(join(dir, ".git"));
    const l = await buildLineage({
      attempt_ref: "att",
      runs: [seg(1, a, b), seg(2, b, a)],
      git: exec,
    });
    assert.equal(l.versions.length, 2);
    assert.deepEqual(
      l.transitions.map((t) => t.kind),
      ["ADVANCE", "REVISIT"],
    );
    assert.deepEqual(l.versions.find((v) => v.sha === b)?.parents, [a]);
    assert.deepEqual(l.versions.find((v) => v.sha === a)?.parents, []);
    assert.deepEqual(
      [l.transitions[0]?.change.files_changed, l.transitions[0]?.change.insertions],
      [1, 1],
    );
    assert.deepEqual(
      [l.transitions[1]?.change.files_changed, l.transitions[1]?.change.deletions],
      [1, 1],
    );
    assert.equal(l.revisits.length, 1);
    const json = JSON.stringify(l);
    assert.ok(!json.includes("planted-secret-name"));
    assert.ok(!json.includes("PLANTED_BODY_TEXT"));
    assert.deepEqual(findForbiddenContent(l), []);
    const missing = await exec(["cat-file", "-t", "f".repeat(40)]);
    assert.notEqual(missing.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
