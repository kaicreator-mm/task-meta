import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { RunRecord } from "../src/adapters/zcode/parse.ts";
import { buildIssueDag, buildLineage, type GitExec, makeGitExec } from "../src/lineage/index.ts";
import type { VersionLineage } from "../src/model.ts";
import { findForbiddenContent } from "../src/privacy.ts";

let dir = "";
let git: GitExec;
const S: Record<string, string> = {};

function g(...args: string[]): string {
  return execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    encoding: "utf8",
  }).trim();
}
function commit(name: string): void {
  writeFileSync(join(dir, `${name}.txt`), name);
  g("add", ".");
  g("commit", "-m", name);
  S[name] = g("rev-parse", "HEAD");
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "tm-dag-"));
  g("init", "-q", "-b", "main");
  commit("c0");
  commit("c1");
  g("checkout", "-q", "-b", "side");
  commit("x1");
  g("checkout", "-q", "main");
  commit("c2");
  commit("c3");
  commit("c4");
  g("merge", "--no-ff", "-m", "m", "side");
  S.m = g("rev-parse", "HEAD");
  git = makeGitExec(join(dir, ".git"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

function seg(n: number, b: string | null, a: string | null, fin = true): RunRecord {
  return {
    started_at: `2026-01-01T00:0${n}:00.000Z`,
    finished_at: fin ? `2026-01-01T00:0${n}:30.000Z` : null,
    exit_code: fin ? 0 : null,
    head_before: b,
    head_after: a,
  };
}
async function att(
  ref: string,
  at: number,
  runs: RunRecord[],
  useGit = true,
): Promise<{ attempt_ref: string; lineage: VersionLineage; started_at: string }> {
  const lineage = await buildLineage(
    useGit ? { attempt_ref: ref, runs, git } : { attempt_ref: ref, runs },
  );
  return { attempt_ref: ref, lineage, started_at: `2026-01-01T0${at}:00:00.000Z` };
}
const base = { repository: "kaicreator-mm/x", issue_number: 1 };
const rel = (d: Awaited<ReturnType<typeof buildIssueDag>>, i = 0) =>
  d.attempt_relations[i]?.relation;

test("sequential attempts CONTINUE; one head; real ancestry edges", async () => {
  const d = await buildIssueDag({
    ...base,
    git,
    attempts: [
      await att("a1", 1, [seg(1, S.c0 as string, S.c1 as string)]),
      await att("a2", 2, [seg(1, S.c1 as string, S.c2 as string)]),
    ],
  });
  assert.equal(rel(d), "CONTINUES");
  assert.equal(d.versions.length, 3);
  assert.deepEqual(d.heads, [`git:${S.c2}`]);
  assert.ok(d.edges.some((e) => e.kind === "GIT_PARENT" && e.to_version === `git:${S.c1}`));
  assert.deepEqual(findForbiddenContent(d), []);
});

test("same base, two outcomes: RESTARTS_FROM_BASE and two heads", async () => {
  const d = await buildIssueDag({
    ...base,
    git,
    attempts: [
      await att("a1", 1, [seg(1, S.c0 as string, S.c2 as string)]),
      await att("a2", 2, [seg(1, S.c0 as string, S.x1 as string)]),
    ],
  });
  assert.equal(rel(d), "RESTARTS_FROM_BASE");
  assert.equal(d.branches.length, 2);
  assert.ok(d.gaps.some((x) => x.kind === "CONCURRENT_BRANCHES"));
});

test("attempt starting from an older commit BRANCHES_FROM", async () => {
  const d = await buildIssueDag({
    ...base,
    git,
    attempts: [
      await att("a1", 1, [seg(1, S.c0 as string, S.c2 as string)]),
      await att("a2", 2, [seg(1, S.c1 as string, S.x1 as string)]),
    ],
  });
  assert.equal(rel(d), "BRANCHES_FROM");
});

test("cross-attempt A->B->A revisit kept as provenance", async () => {
  const d = await buildIssueDag({
    ...base,
    git,
    attempts: [
      await att("a1", 1, [seg(1, S.c0 as string, S.c1 as string)]),
      await att("a2", 2, [seg(1, S.c1 as string, S.c0 as string)]),
    ],
  });
  assert.equal(d.revisits.length, 1);
  assert.equal(d.revisits[0]?.version_id, `git:${S.c0}`);
  assert.equal(d.revisits[0]?.transition_ids.length, 1);
});

test("duplicate attempt dedups, no new versions", async () => {
  const runs = [seg(1, S.c0 as string, S.c1 as string)];
  const d = await buildIssueDag({
    ...base,
    git,
    attempts: [await att("a1", 1, runs), await att("a2", 2, runs)],
  });
  assert.equal(d.versions.length, 2);
  assert.deepEqual(d.attempts, ["a1"]);
  assert.equal(d.edges.filter((e) => e.kind === "TRANSITION").length, 1);
  assert.ok(d.gaps.some((x) => x.kind === "DUPLICATE_ATTEMPT"));
  assert.equal(d.versions[0]?.observed_in.length, 1);
});

test("observed_in unions across attempts", async () => {
  const d = await buildIssueDag({
    ...base,
    git,
    attempts: [
      await att("a1", 1, [seg(1, S.c0 as string, S.c1 as string)]),
      await att("a2", 2, [seg(1, S.c1 as string, S.c2 as string)]),
    ],
  });
  const v = d.versions.find((x) => x.sha === S.c1);
  assert.equal(v?.observed_in.length, 2);
});

test("unknown SHA and unfinished attempt are gaps", async () => {
  const ghost = "9".repeat(40);
  const d = await buildIssueDag({
    ...base,
    git,
    attempts: [
      await att("a1", 1, [seg(1, S.c0 as string, ghost)]),
      await att("a2", 2, [seg(1, S.c0 as string, null, false)]),
    ],
  });
  assert.ok(d.gaps.some((x) => x.kind === "SHA_NOT_IN_REPO"));
  assert.ok(d.gaps.some((x) => x.kind === "UNFINISHED_ATTEMPT" && x.ref === "a2"));
  assert.ok(d.versions.every((v) => v.sha !== null));
});

test("without git: CONTINUES by SHA equality, others UNKNOWN", async () => {
  const d = await buildIssueDag({
    ...base,
    attempts: [
      await att("a1", 1, [seg(1, S.c0 as string, S.c1 as string)], false),
      await att("a2", 2, [seg(1, S.c1 as string, S.c2 as string)], false),
      await att("a3", 3, [seg(1, S.c3 as string, S.c4 as string)], false),
    ],
  });
  assert.equal(rel(d, 0), "CONTINUES");
  assert.equal(rel(d, 1), "UNKNOWN");
  assert.equal(rel(d, 2), "UNKNOWN");
  assert.ok(d.gaps.some((x) => x.kind === "NO_GIT"));
  assert.ok(d.edges.every((e) => e.kind === "TRANSITION"));
});

test("ancestry depth bound and intermediate_commits", async () => {
  const attempts = [await att("a1", 1, [seg(1, S.c0 as string, S.c4 as string)])];
  const full = await buildIssueDag({ ...base, git, attempts });
  const e = full.edges.find((x) => x.kind === "GIT_PARENT");
  assert.equal(e?.intermediate_commits, 3);
  const bounded = await buildIssueDag({ ...base, git, attempts, maxAncestryDepth: 2 });
  assert.ok(!bounded.edges.some((x) => x.kind === "GIT_PARENT"));
  assert.ok(bounded.gaps.some((x) => x.kind === "ANCESTRY_DEPTH_EXCEEDED"));
});

test("merge makes merged branches share a descendant; stale detection", async () => {
  const d = await buildIssueDag({
    ...base,
    git,
    defaultBranchRef: S.c2 as string,
    attempts: [
      await att("a1", 1, [seg(1, S.c0 as string, S.x1 as string)]),
      await att("a2", 2, [seg(1, S.c0 as string, S.m as string)]),
    ],
  });
  assert.deepEqual(d.heads, [`git:${S.m}`]);
  assert.ok(d.gaps.some((x) => x.kind === "STALE_VERSION"));
  assert.deepEqual(findForbiddenContent(d), []);
});
