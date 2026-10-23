import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  analyzeHooks,
  bindingInputFromSpool,
  type HookEntry,
  parseHookSpool,
} from "../src/adapters/zcode/hooks.ts";
import { collectZcodeRun, type ZcodeRunInput } from "../src/adapters/zcode/index.ts";
import { loadRepoInventory, resolveBinding } from "../src/binding/index.ts";
import { canonicalDigest, canonicalize } from "../src/canonical.ts";

const fxDir = join(import.meta.dirname, "fixtures", "zcode");
const SID = "sess-synth-0001";
const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const H3 = "c".repeat(40);

const line = (e: unknown): string => `{"d":"${canonicalDigest(e)}","e":${canonicalize(e)}}\n`;
const T = (s: string) => `2026-10-22T13:${s}Z`;

function ent(over: Partial<HookEntry> & Pick<HookEntry, "event">): HookEntry {
  return {
    schema: "task-meta/zcode-hook/v1",
    plugin_version: "0.2.0",
    session_id: SID,
    turn_id: "turn-1",
    trace_id: "trace-1",
    agent_name: "main",
    tool_call_id: null,
    tool_name: null,
    hook_ts: null,
    received_at: "2026-10-22T13:00:00.000Z",
    mode: "default",
    input_class: null,
    outcome: null,
    error_type: null,
    result_bytes: null,
    tool_call_count: null,
    session_source: null,
    model: null,
    prompt_bytes: null,
    cwd_digest: null,
    binding_refs: null,
    git_head: null,
    git_dirty: null,
    git_remote_repo: null,
    worktree_refs: null,
    ...over,
  };
}

const wt = [
  { source: "WORKTREE" as const, kind: "ISSUE" as const, repo: "domain-harness", number: 1296 },
  { source: "BRANCH" as const, kind: "ISSUE" as const, repo: "domain-harness", number: 1296 },
];
const start = (ts: string, head: string | null) =>
  ent({
    event: "SessionStart",
    session_source: "startup",
    hook_ts: T(ts),
    git_head: head,
    git_dirty: false,
    git_remote_repo: "kaicreator-mm/domain-harness",
    worktree_refs: wt,
  });
const stop = (ts: string, head: string | null, dirty = false) =>
  ent({
    event: "Stop",
    hook_ts: T(ts),
    git_head: head,
    git_dirty: dirty,
    git_remote_repo: "kaicreator-mm/domain-harness",
    worktree_refs: wt,
  });
const spoolOf = (...es: HookEntry[]) => es.map(line).join("");

function hookOnly(hookSpool: string): ZcodeRunInput {
  return {
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor: {
      role: "implementer",
      operator_kind: "agent",
      operator_id: "zcode",
      session_ref: "sess",
      transport_actor: null,
    },
    observed_at: "2026-10-23T00:00:00.000Z",
    headless: readFileSync(join(fxDir, "headless.json.txt"), "utf8"),
    hookSpool,
  };
}

test("spool parse accepts the new fields", () => {
  const prompt = ent({
    event: "UserPromptSubmit",
    hook_ts: T("00:30.000"),
    binding_refs: [{ kind: "ISSUE", repo: "domain-harness", number: 1296 }],
  });
  const r = parseHookSpool(spoolOf(start("00:00.000", H1), prompt, stop("05:00.000", H2, true)));
  assert.deepEqual(r.skipped, []);
  assert.equal(r.entries.length, 3);
  assert.equal(r.entries[0]?.git_head, H1);
  assert.equal(r.entries[0]?.git_remote_repo, "kaicreator-mm/domain-harness");
  assert.deepEqual(r.entries[0]?.worktree_refs, wt);
  assert.deepEqual(r.entries[1]?.binding_refs, [
    { kind: "ISSUE", repo: "domain-harness", number: 1296 },
  ]);
  assert.equal(r.entries[2]?.git_dirty, true);
});

test("malformed new fields are dropped, not carried", () => {
  const bad = {
    ...start("00:00.000", H1),
    git_head: "not-a-sha",
    git_remote_repo: "has spaces/and/more",
    git_dirty: "yes",
    binding_refs: [
      { kind: "BOGUS", repo: "x", number: 1 },
      { kind: "PR", repo: "runx", number: -3 },
    ],
    worktree_refs: [{ kind: "ISSUE", repo: "runx", number: 4, source: "ELSEWHERE" }],
  };
  const r = parseHookSpool(line(bad) + line(stop("01:00.000", H2)));
  const e = r.entries[0] as HookEntry;
  assert.equal(e.git_head, null);
  assert.equal(e.git_remote_repo, null);
  assert.equal(e.git_dirty, null);
  assert.deepEqual(e.binding_refs, [{ kind: "PR", repo: "runx", number: null }]);
  assert.deepEqual(e.worktree_refs, []);
});

test("old 0.1.1 spool lines still parse; no git heads, no derived segments", () => {
  const strip = (e: HookEntry): Record<string, unknown> => {
    const o: Record<string, unknown> = { ...e, plugin_version: "0.1.1" };
    for (const k of ["binding_refs", "git_head", "git_dirty", "git_remote_repo", "worktree_refs"]) {
      delete o[k];
    }
    return o;
  };
  const oldStart = strip(start("00:00.000", H1));
  const oldStopRaw = strip(ent({ event: "Stop", hook_ts: T("05:00.000") }));
  const text = line(oldStart) + line(oldStopRaw);
  const parsed = parseHookSpool(text);
  assert.deepEqual(parsed.skipped, []);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0]?.git_head ?? null, null);
  const a = analyzeHooks(parsed.entries);
  assert.equal(a.segments[0]?.headBefore, null);
  const r = collectZcodeRun(hookOnly(text));
  assert.equal(r.summary.source_sha, null);
  assert.ok(r.summary.limits.includes("run record missing; run boundary and source SHA unknown"));
  assert.ok(!r.summary.limits.some((l) => l.includes("derived from hook git heads")));
});

test("run segments and source_sha derive from SessionStart/Stop git heads when no run.txt", () => {
  const r = collectZcodeRun(hookOnly(spoolOf(start("00:00.000", H1), stop("05:00.000", H2))));
  assert.equal(r.summary.source_sha, H2);
  assert.ok(
    r.summary.limits.includes(
      "run segments derived from hook git heads (no run.txt); exit code unknown",
    ),
  );
  assert.ok(!r.summary.limits.includes("run record missing; run boundary and source SHA unknown"));
  // boundaries come from hooks only (no duplicate run: record)
  const bounds = r.observations.filter((o) => o.kind === "RUN_BOUNDARY");
  assert.deepEqual(
    bounds.map((o) => o.observation_id),
    [`zcode:hook-segment:${SID}:1`],
  );
  assert.equal(bounds[0]?.completed_at, "2026-10-22T13:05:00.000Z");
});

test("several Stops: head_after is the latest Stop; resumed segments chain", () => {
  const spool = spoolOf(start("00:00.000", H1), stop("02:00.000", H2), stop("05:00.000", H3, true));
  const r = collectZcodeRun(hookOnly(spool));
  assert.equal(r.summary.source_sha, H3);
  assert.ok(r.summary.limits.some((l) => l.includes("working tree dirty at Stop")));

  const resumed = spoolOf(
    start("00:00.000", H1),
    stop("02:00.000", H2),
    start("10:00.000", H2),
    stop("12:00.000", H3),
  );
  const r2 = collectZcodeRun(hookOnly(resumed));
  assert.equal(r2.summary.source_sha, H3);
  assert.ok(!r2.summary.limits.some((l) => l.includes("head chain broken")));
});

test("an explicit run.txt takes precedence over derived segments", () => {
  const input = {
    ...hookOnly(spoolOf(start("00:00.000", H1), stop("05:00.000", H2))),
    runRecord: readFileSync(join(fxDir, "run.txt"), "utf8"),
  };
  const r = collectZcodeRun(input);
  assert.ok(!r.summary.limits.some((l) => l.includes("derived from hook git heads")));
  assert.notEqual(r.summary.source_sha, H2);
});

test("bindingInputFromSpool returns refs and the remote, nothing else", () => {
  const entries = parseHookSpool(
    spoolOf(
      start("00:00.000", H1),
      ent({
        event: "UserPromptSubmit",
        hook_ts: T("00:10.000"),
        binding_refs: [
          { kind: "ISSUE", repo: "domain-harness", number: 1296 },
          { kind: "PR", repo: "domain-harness", number: 1298 },
        ],
      }),
      stop("05:00.000", H2),
    ),
  ).entries;
  const b = bindingInputFromSpool(entries);
  assert.deepEqual(Object.keys(b).sort(), [
    "branchRefs",
    "gitRemoteRepo",
    "promptRefs",
    "worktreeRefs",
  ]);
  assert.deepEqual(b.promptRefs, [
    { kind: "ISSUE", repo: "domain-harness", number: 1296 },
    { kind: "PR", repo: "domain-harness", number: 1298 },
  ]);
  assert.deepEqual(b.worktreeRefs, [{ kind: "ISSUE", repo: "domain-harness", number: 1296 }]);
  assert.deepEqual(b.branchRefs, [{ kind: "ISSUE", repo: "domain-harness", number: 1296 }]);
  assert.equal(b.gitRemoteRepo, "kaicreator-mm/domain-harness");

  const inv = loadRepoInventory();
  const binding = resolveBinding({ ...b, knownRepos: inv.repos, aliases: inv.aliases });
  assert.equal(binding.state, "RESOLVED");
  assert.equal(binding.repository, "kaicreator-mm/domain-harness");
  assert.equal(binding.issue_number, 1296);
  assert.equal(binding.pr_number, 1298);
});
