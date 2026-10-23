import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BindingRef,
  extractRefs,
  loadRepoInventory,
  parseWorktreeName,
  resolveBinding,
} from "../src/binding/index.ts";

const inv = loadRepoInventory();
const opts = { aliases: inv.aliases, knownRepos: inv.repos };
const I = (repo: string | null, number: number): BindingRef => ({ kind: "ISSUE", repo, number });
const P = (repo: string | null, number: number): BindingRef => ({ kind: "PR", repo, number });
const R = (repo: string): BindingRef => ({ kind: "REPO", repo, number: null });

test("inventory is loaded from config/repo-aliases.json", () => {
  assert.equal(inv.owner, "kaicreator-mm");
  for (const r of ["task-meta", "task-meta-e2e", "domain-harness", "ai-development-standard"]) {
    assert.ok(inv.repos.includes(r), r);
  }
  assert.equal(inv.aliases.dh, "domain-harness");
  assert.equal(inv.aliases.ads, "ai-development-standard");
  assert.equal(inv.aliases.tm, "task-meta");
  assert.equal(inv.aliases.tme, "task-meta-e2e");
});

const CASES: Array<[string, string, BindingRef[]]> = [
  [
    "domain-harness example",
    "执行 domain-harness v0.10.1 #1296：针对 PR #1298 当前精确 HEAD…",
    [I("domain-harness", 1296), P("domain-harness", 1298)],
  ],
  [
    "issue URL",
    "see https://github.com/kaicreator-mm/task-meta/issues/14 now",
    [I("task-meta", 14)],
  ],
  ["pull URL", "https://github.com/kaicreator-mm/runx/pull/77", [P("runx", 77)]],
  ["URL of unknown repo", "https://github.com/someone/else/issues/3", []],
  ["owner/repo#n", "处理 kaicreator-mm/runx#5 吧", [I("runx", 5)]],
  ["owner/repo#n unknown repo", "foo/bar#3", []],
  ["alias dh #12", "dh #12", [I("domain-harness", 12)]],
  ["alias without space", "DH#12 请看", [I("domain-harness", 12)]],
  ["alias tme", "tme #3 e2e", [I("task-meta-e2e", 3)]],
  ["repo name before version", "task-meta v0.2 #14", [I("task-meta", 14)]],
  ["longest repo token wins", "task-meta-e2e #3", [I("task-meta-e2e", 3)]],
  ["PR only", "PR #5", [P(null, 5)]],
  ["pull request", "check pull request #5", [P(null, 5)]],
  ["PR glued", "PR#5", [P(null, 5)]],
  ["issue lowercase", "issue #7", [I(null, 7)]],
  ["Issue capitalised", "Issue #7 is open", [I(null, 7)]],
  ["bare hash", "fix #12", [I(null, 12)]],
  ["unknown word before hash", "step #3", [I(null, 3)]],
  ["code-like include ignored", "#include <stdio.h>", []],
  ["html entity ignored", "a &#123; b", []],
  ["glued to word ignored", "abc#12", []],
  ["too many digits ignored", "color #123456789", []],
  ["Chinese connector", "针对 runx 的 #440 的问题", [I("runx", 440)]],
  ["two repos two issues", "runx #1 and tally #2", [I("runx", 1), I("tally", 2)]],
  ["version tokens skipped", "domain-harness v0.10.1 PR #1298", [P("domain-harness", 1298)]],
  ["PR inherits only mentioned repo", "PR #9 of runx", [P("runx", 9)]],
  ["repo mention alone", "仅提到 task-meta 这个仓库", [R("task-meta")]],
  ["repo mention trailing period", "see runx.", [R("runx")]],
  ["repeats are deduplicated", "runx #1, runx #1", [I("runx", 1)]],
  ["unknown words only", "hello world, nothing here", []],
  ["empty", "", []],
];

for (const [name, text, expected] of CASES) {
  test(`extractRefs: ${name}`, () => {
    assert.deepEqual(extractRefs(text, opts).refs, expected);
  });
}

test("extractRefs table has at least 25 cases", () => {
  assert.ok(CASES.length >= 25);
});

test("extractRefs output never carries prompt text", () => {
  const SENT = "SENTINEL_PROMPT_9x7q secret sentence about nothing";
  const text = `${SENT} domain-harness v0.10.1 #1296 ${SENT} PR #1298 ${SENT} https://github.com/kaicreator-mm/runx/issues/4 ${SENT}`;
  const { refs } = extractRefs(text, opts);
  assert.ok(refs.length >= 3);
  const json = JSON.stringify(refs);
  assert.ok(!json.includes("SENTINEL"));
  assert.ok(!json.includes("secret"));
  const longest = Math.max(...inv.repos.map((r) => r.length));
  for (const r of refs) {
    assert.deepEqual(Object.keys(r).sort(), ["kind", "number", "repo"]);
    if (r.repo !== null) assert.ok(inv.repos.includes(r.repo));
    assert.ok((r.repo ?? "").length <= longest);
  }
});

test("parseWorktreeName follows the workspace convention", () => {
  const w = (n: string) => parseWorktreeName(n, opts).refs;
  assert.deepEqual(w("dh-i1296-zcode"), [I("domain-harness", 1296)]);
  assert.deepEqual(w("tme-i1-zcode"), [I("task-meta-e2e", 1)]);
  assert.deepEqual(w("domain-harness-i1264-review"), [I("domain-harness", 1264)]);
  assert.deepEqual(w("dh-pr1268-review-zcode"), [P("domain-harness", 1268)]);
  assert.deepEqual(w("app8-i107-zcode"), [I("app8", 107)]);
  assert.deepEqual(w("hv-i53-zcode"), [I("hidden-validation", 53)]);
  assert.deepEqual(w("ai-development-standard-i1207-scope"), [I("ai-development-standard", 1207)]);
  assert.deepEqual(w("i778-v44-seq"), [I(null, 778)]);
  // branch form: task numbers are not Issue numbers
  assert.deepEqual(w("task/tm-t13-sonnet"), [R("task-meta")]);
  assert.deepEqual(w("task/dh-i1296-zcode"), [I("domain-harness", 1296)]);
  assert.deepEqual(w("main"), []);
  assert.deepEqual(w(""), []);
  assert.ok(!w("task/tm-t13-sonnet").some((r) => r.kind === "ISSUE"));
});

// ---- resolver ----
const base = {
  promptRefs: [] as BindingRef[],
  worktreeRefs: [] as BindingRef[],
  branchRefs: [] as BindingRef[],
  gitRemoteRepo: null as string | null,
  knownRepos: inv.repos,
  aliases: inv.aliases,
};

test("resolver: prompt, worktree and remote agree", () => {
  const b = resolveBinding({
    ...base,
    promptRefs: [I("domain-harness", 1296), P("domain-harness", 1298)],
    worktreeRefs: [I("domain-harness", 1296)],
    gitRemoteRepo: "kaicreator-mm/domain-harness",
  });
  assert.equal(b.state, "RESOLVED");
  assert.equal(b.repository, "kaicreator-mm/domain-harness");
  assert.equal(b.issue_number, 1296);
  assert.equal(b.pr_number, 1298);
  assert.deepEqual(b.reasons, []);
  const values = b.evidence.map((e) => `${e.kind}:${e.value}`);
  assert.ok(values.includes("PROMPT_REF:kaicreator-mm/domain-harness#1296"));
  assert.ok(values.includes("WORKTREE_NAME:kaicreator-mm/domain-harness#1296"));
  assert.ok(values.includes("GIT_REMOTE:kaicreator-mm/domain-harness"));
});

test("resolver: a single source is enough", () => {
  const p = resolveBinding({ ...base, promptRefs: [I("runx", 5)] });
  assert.equal(p.state, "RESOLVED");
  assert.equal(p.repository, "kaicreator-mm/runx");
  const w = resolveBinding({ ...base, branchRefs: [I("task-meta", 9)] });
  assert.equal(w.state, "RESOLVED");
  assert.equal(w.issue_number, 9);
});

test("resolver: conflicting repositories are AMBIGUOUS", () => {
  const b = resolveBinding({
    ...base,
    promptRefs: [I("domain-harness", 1)],
    worktreeRefs: [I("runx", 1)],
  });
  assert.equal(b.state, "AMBIGUOUS");
  assert.equal(b.repository, null);
  assert.equal(b.issue_number, null);
  assert.match(b.reasons.join("|"), /conflicting repositories: domain-harness, runx/);
  const remote = resolveBinding({
    ...base,
    promptRefs: [I("domain-harness", 1)],
    gitRemoteRepo: "kaicreator-mm/runx",
  });
  assert.equal(remote.state, "AMBIGUOUS");
});

test("resolver: several issues are AMBIGUOUS and listed", () => {
  const b = resolveBinding({
    ...base,
    promptRefs: [I("domain-harness", 12), I("domain-harness", 3)],
  });
  assert.equal(b.state, "AMBIGUOUS");
  assert.equal(b.repository, "kaicreator-mm/domain-harness");
  assert.equal(b.issue_number, null);
  assert.match(b.reasons.join("|"), /several issues: #3, #12/);
  const conflict = resolveBinding({
    ...base,
    promptRefs: [I("domain-harness", 12)],
    worktreeRefs: [I("domain-harness", 13)],
  });
  assert.equal(conflict.state, "AMBIGUOUS");
});

test("resolver: multiple issues extracted from one prompt are AMBIGUOUS", () => {
  const { refs } = extractRefs("see #3 and also #4", opts);
  const b = resolveBinding({ ...base, promptRefs: refs, gitRemoteRepo: "kaicreator-mm/runx" });
  assert.equal(b.state, "AMBIGUOUS");
  assert.equal(b.repository, "kaicreator-mm/runx");
});

test("resolver: PR-only is UNRESOLVED with the T14 hint", () => {
  const b = resolveBinding({ ...base, promptRefs: [P("domain-harness", 1298)] });
  assert.equal(b.state, "UNRESOLVED");
  assert.equal(b.repository, "kaicreator-mm/domain-harness");
  assert.equal(b.issue_number, null);
  assert.equal(b.pr_number, 1298);
  assert.ok(b.reasons.includes("pr-only: resolve linked issue"));
});

test("resolver: nothing is UNRESOLVED", () => {
  const b = resolveBinding(base);
  assert.equal(b.state, "UNRESOLVED");
  assert.equal(b.repository, null);
  assert.equal(b.issue_number, null);
  assert.equal(b.pr_number, null);
  assert.deepEqual(b.evidence, []);
  assert.ok(b.reasons.length > 0);
});

test("resolver: bare #n uses the repository from the git remote", () => {
  const b = resolveBinding({
    ...base,
    promptRefs: [I(null, 77)],
    gitRemoteRepo: "kaicreator-mm/task-meta",
  });
  assert.equal(b.state, "RESOLVED");
  assert.equal(b.repository, "kaicreator-mm/task-meta");
  assert.equal(b.issue_number, 77);
  assert.ok(
    b.evidence.some((e) => e.kind === "PROMPT_REF" && e.value === "kaicreator-mm/task-meta#77"),
  );
});

test("resolver: bare #n without any repository stays UNRESOLVED", () => {
  const b = resolveBinding({ ...base, promptRefs: [I(null, 77)] });
  assert.equal(b.state, "UNRESOLVED");
  assert.equal(b.repository, null);
  assert.match(b.reasons.join("|"), /no repository evidence/);
});

test("resolver: foreign or unknown remotes are ignored with a reason", () => {
  const b = resolveBinding({
    ...base,
    promptRefs: [I("runx", 5)],
    gitRemoteRepo: "someone/runx",
  });
  assert.equal(b.state, "RESOLVED");
  assert.equal(b.repository, "kaicreator-mm/runx");
  assert.match(b.reasons.join("|"), /git remote is not a known repository/);
});

test("resolver: weak repo mentions bind only when nothing stronger exists", () => {
  const weakOnly = resolveBinding({ ...base, promptRefs: [R("task-meta"), I(null, 5)] });
  assert.equal(weakOnly.state, "RESOLVED");
  assert.equal(weakOnly.repository, "kaicreator-mm/task-meta");
  const overridden = resolveBinding({
    ...base,
    promptRefs: [R("formula"), I(null, 5)],
    worktreeRefs: [I("task-meta", 5)],
  });
  assert.equal(overridden.state, "RESOLVED");
  assert.equal(overridden.repository, "kaicreator-mm/task-meta");
  const several = resolveBinding({ ...base, promptRefs: [R("task-meta"), R("runx"), I(null, 5)] });
  assert.equal(several.state, "AMBIGUOUS");
});

test("resolver: aliases in refs are normalized", () => {
  const b = resolveBinding({ ...base, promptRefs: [I("dh", 12)] });
  assert.equal(b.repository, "kaicreator-mm/domain-harness");
  assert.equal(b.issue_number, 12);
});
