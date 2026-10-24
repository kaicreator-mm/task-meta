import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { analyzeCodexHooks, parseCodexHookSpool } from "../src/adapters/codex/hooks.ts";
import { collectCodexRun } from "../src/adapters/codex/index.ts";
import { canonicalize } from "../src/canonical.ts";
import { findForbiddenContent } from "../src/privacy.ts";
import { basicSession, SID } from "./fixtures/codex/build.ts";

const require = createRequire(import.meta.url);
const ROOT = join(import.meta.dirname, "..");
const PLUGIN = join(ROOT, "plugins", "codex", "task-meta-capture");
const RUN = join(PLUGIN, "scripts", "run.cjs");
const cap = require(join(PLUGIN, "scripts", "capture.cjs")) as {
  jcs: (v: unknown) => string;
  classifyCommand: (c: string) => string;
  buildEntry: (
    i: unknown,
    now?: Date,
    probe?: (cwd: unknown) => unknown,
  ) => Record<string, unknown>;
  spoolDir: () => string;
};

const SENT = [
  "SENTINEL_CWD_4c1d",
  "SENTINEL_PROMPT_7f3a",
  "SENTINEL_TOOLARG_3d2e",
  "SENTINEL_RESPONSE_c0de",
  "SENTINEL_TRANSCRIPT_55aa",
  "SENTINEL_LASTMSG_d0d0",
  "SENTINEL_REASON_91bc",
  "ghp_SENTINELSENTINEL1234",
];

const temps: string[] = [];
after(async () => {
  for (const t of temps) await rm(t, { recursive: true, force: true });
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "tm-codex-plugin-"));
  temps.push(d);
  return d;
}

function spawnScript(stdin: string, spool: string, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [RUN], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, TASK_META_CODEX_SPOOL: spool, TASK_META_AUTO_REPORT: "0", ...env },
    timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function input(event: string, cwd: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    session_id: SID,
    transcript_path: "C:\\Users\\someone\\SENTINEL_TRANSCRIPT_55aa\\rollout.jsonl",
    cwd,
    hook_event_name: event,
    model: "gpt-test-1",
    permission_mode: "default",
    ...extra,
  });
}

function makeRepo(dir: string): string {
  const g = (...args: string[]) => {
    const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  g("init", "-q");
  g("remote", "add", "origin", "https://github.com/kaicreator-mm/task-meta.git");
  writeFileSync(join(dir, "a.txt"), "x");
  g("add", "a.txt");
  g("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "m");
  return g("rev-parse", "HEAD");
}

test("manifest and marketplace follow the structure of installed Codex plugins", () => {
  const manifest = JSON.parse(
    readFileSync(join(PLUGIN, ".codex-plugin", "plugin.json"), "utf8"),
  ) as {
    name: string;
    version: string;
    hooks: { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> };
  };
  assert.equal(manifest.name, "task-meta-capture");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const events = Object.keys(manifest.hooks.hooks).sort();
  assert.deepEqual(events, [
    "Interrupt",
    "PostToolUse",
    "PreToolUse",
    "SessionEnd",
    "SessionStart",
    "Stop",
    "UserPromptSubmit",
  ]);
  for (const groups of Object.values(manifest.hooks.hooks)) {
    for (const g of groups) {
      for (const h of g.hooks) {
        assert.equal(h.type, "command");
        assert.equal(typeof h.timeout, "number");
        assert.equal(typeof h.async, "boolean");
        assert.match(String(h.command), /CLAUDE_PLUGIN_ROOT/);
        assert.match(String(h.command), /scripts\/run\.cjs/);
      }
    }
  }
  const mk = JSON.parse(
    readFileSync(join(ROOT, "plugins", "codex", ".agents", "plugins", "marketplace.json"), "utf8"),
  ) as { name: string; plugins: Array<{ name: string; source: { source: string; path: string } }> };
  assert.equal(mk.name, "dev-task-meta");
  assert.equal(mk.plugins[0]?.name, "task-meta-capture");
  assert.deepEqual(mk.plugins[0]?.source, { source: "local", path: "./task-meta-capture" });
  assert.ok(
    existsSync(join(ROOT, "plugins", "codex", mk.plugins[0]?.source.path ?? "x", ".codex-plugin")),
  );
});

test("the manifest's own hook command line runs the capture (shell-independent launcher)", async () => {
  const spool = await tmp();
  const manifest = JSON.parse(readFileSync(join(PLUGIN, ".codex-plugin", "plugin.json"), "utf8"));
  const command = manifest.hooks.hooks.PostToolUse[0].hooks[0].command as string;
  const r = spawnSync(command, {
    shell: true,
    input: input("PostToolUse", tmpdir(), {
      tool_name: "exec",
      tool_use_id: "call-1",
      tool_input: {},
      tool_response: {},
      turn_id: "t1",
    }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, TASK_META_CODEX_SPOOL: spool },
    timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.equal(
    readFileSync(join(spool, `${SID}.jsonl`), "utf8")
      .split("\n")
      .filter(Boolean).length,
    1,
  );
  // a missing plugin root must still exit 0 and print nothing
  const missing = spawnSync(command, {
    shell: true,
    input: "{}",
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "", PLUGIN_ROOT: "", TASK_META_CODEX_SPOOL: spool },
    timeout: 20000,
  });
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, "");
});

test("each event appends one verifiable metadata-only line; sentinel content never lands", async () => {
  const spool = await tmp();
  const repo = await tmp();
  const head = makeRepo(repo);
  const cases: Array<[string, Record<string, unknown>]> = [
    ["SessionStart", { source: "startup" }],
    ["UserPromptSubmit", { turn_id: "t1", prompt: "SENTINEL_PROMPT_7f3a hello" }],
    [
      "PreToolUse",
      {
        turn_id: "t1",
        tool_name: "shell",
        tool_use_id: "call-1",
        tool_input: { command: ["bash", "-lc", "npm test SENTINEL_TOOLARG_3d2e"] },
      },
    ],
    [
      "PostToolUse",
      {
        turn_id: "t1",
        tool_name: "shell",
        tool_use_id: "call-1",
        tool_input: { command: ["bash", "-lc", "npm test SENTINEL_TOOLARG_3d2e"] },
        tool_response: { exit_code: 1, output: "SENTINEL_RESPONSE_c0de" },
      },
    ],
    [
      "PostToolUse",
      {
        turn_id: "t1",
        tool_name: "exec",
        tool_use_id: "call-2",
        tool_input: { input: "SENTINEL_TOOLARG_3d2e" },
        tool_response: "SENTINEL_RESPONSE_c0de",
      },
    ],
    ["Interrupt", { turn_id: "t1" }],
    [
      "Stop",
      { turn_id: "t1", stop_hook_active: false, last_assistant_message: "SENTINEL_LASTMSG_d0d0" },
    ],
    ["SessionEnd", { reason: "SENTINEL_REASON_91bc with spaces" }],
  ];
  for (const [i, [ev, extra]] of cases.entries()) {
    const r = spawnScript(input(ev, repo, extra), spool);
    assert.equal(r.code, 0, ev);
    assert.equal(r.stdout, "", ev);
    const raw = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
    assert.equal(raw.split("\n").filter(Boolean).length, i + 1, ev);
  }
  const raw = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
  for (const s of SENT) assert.ok(!raw.includes(s), `spool leaks ${s}`);
  assert.ok(!raw.includes(repo), "cwd path leaked");
  assert.ok(!raw.includes("someone"), "transcript path leaked");
  for (const k of [
    "tool_input",
    "tool_response",
    "prompt",
    "cwd",
    "last_assistant_message",
    "transcript_path",
  ]) {
    assert.ok(!raw.includes(`"${k}"`), `spool has key ${k}`);
  }
  const { entries, skipped } = parseCodexHookSpool(raw);
  assert.deepEqual(skipped, []);
  assert.equal(entries.length, cases.length);
  assert.deepEqual(findForbiddenContent(entries, SENT), []);
  const by = (ev: string, n = 0) => entries.filter((e) => e.event === ev)[n];
  assert.equal(by("SessionStart")?.git_head, head);
  assert.equal(by("SessionStart")?.git_dirty, false);
  assert.equal(by("SessionStart")?.git_remote_repo, "kaicreator-mm/task-meta");
  assert.equal(by("SessionStart")?.session_source, "startup");
  assert.equal(by("SessionStart")?.model, "gpt-test-1");
  assert.equal(
    by("UserPromptSubmit")?.prompt_bytes,
    Buffer.byteLength("SENTINEL_PROMPT_7f3a hello"),
  );
  assert.equal(by("PreToolUse")?.input_class, "TEST");
  assert.equal(by("PostToolUse", 0)?.exit_code, 1);
  assert.equal(by("PostToolUse", 0)?.outcome, "failure");
  assert.equal(by("PostToolUse", 1)?.outcome, "success");
  assert.equal(by("PostToolUse", 1)?.result_bytes, Buffer.byteLength("SENTINEL_RESPONSE_c0de"));
  assert.equal(by("PostToolUse", 1)?.input_class, null);
  assert.equal(by("Interrupt")?.outcome, "interrupt");
  assert.equal(by("Stop")?.message_bytes, Buffer.byteLength("SENTINEL_LASTMSG_d0d0"));
  assert.equal(by("Stop")?.git_head, head);
  assert.equal(by("SessionEnd")?.end_reason, "OTHER");
  assert.match(String(by("Stop")?.cwd_digest), /^[0-9a-f]{64}$/);
  for (const e of entries) assert.equal(e.schema, "task-meta/codex-hook/v1");
  for (const line of raw.split("\n").filter(Boolean)) {
    const o = JSON.parse(line).e as Record<string, unknown>;
    assert.equal(o.agent, "codex");
    assert.ok(!("cwd" in o));
  }
});

test("git facts: dirty tree is reported and a non-repo cwd yields nulls", async () => {
  const repo = await tmp();
  makeRepo(repo);
  writeFileSync(join(repo, "b.txt"), "untracked");
  const spool = await tmp();
  assert.equal(spawnScript(input("Stop", repo, { turn_id: "t1" }), spool).code, 0);
  const plain = await tmp();
  const spool2 = await tmp();
  assert.equal(spawnScript(input("SessionStart", plain, { source: "resume" }), spool2).code, 0);
  const a = parseCodexHookSpool(readFileSync(join(spool, `${SID}.jsonl`), "utf8")).entries[0];
  const b = parseCodexHookSpool(readFileSync(join(spool2, `${SID}.jsonl`), "utf8")).entries[0];
  assert.equal(a?.git_dirty, true);
  assert.match(String(a?.git_head), /^[0-9a-f]{40}$/);
  assert.equal(b?.git_head, null);
  assert.equal(b?.git_dirty, null);
  assert.equal(b?.git_remote_repo, null);
  // tool events never probe git
  const spool3 = await tmp();
  spawnScript(input("PreToolUse", repo, { tool_name: "exec", tool_use_id: "c" }), spool3);
  const c = parseCodexHookSpool(readFileSync(join(spool3, `${SID}.jsonl`), "utf8")).entries[0];
  assert.equal(c?.git_head, null);
});

test("garbage stdin and unknown events exit 0, write no entry, log only a class name", async () => {
  const spool = await tmp();
  for (const raw of [
    "",
    "not json {{{",
    "[]",
    "null",
    '{"hook_event_name":"Nope","session_id":"x"}',
  ]) {
    const r = spawnScript(raw, spool);
    assert.equal(r.code, 0, raw);
    assert.equal(r.stdout, "");
  }
  assert.ok(!readdirSync(spool).some((f) => f.endsWith(".jsonl")));
  for (const l of readFileSync(join(spool, "_errors.log"), "utf8").split("\n").filter(Boolean)) {
    assert.match(l, /^\S+ (SyntaxError|TypeError|RangeError)$/);
  }
});

test("unwritable spool still exits 0 silently; session id only sanitizes the file name", async () => {
  const d = await tmp();
  const blocker = join(d, "file");
  writeFileSync(blocker, "x");
  const r = spawnScript(input("Stop", d), join(blocker, "sub"));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  const spool = await tmp();
  const evil = JSON.parse(input("Stop", d));
  evil.session_id = "../evil/sess id";
  assert.equal(spawnScript(JSON.stringify(evil), spool).code, 0);
  assert.deepEqual(readdirSync(spool), ["___evil_sess_id.jsonl"]);
});

test("default spool dir is under the home directory", () => {
  const saved = process.env.TASK_META_CODEX_SPOOL;
  delete process.env.TASK_META_CODEX_SPOOL;
  try {
    assert.equal(cap.spoolDir(), join(homedir(), ".task-meta", "codex-spool"));
  } finally {
    if (saved !== undefined) process.env.TASK_META_CODEX_SPOOL = saved;
  }
});

test("plugin JCS equals the task-meta canonicalizer", () => {
  const samples: unknown[] = [
    { b: 1, a: [1, 2.5, -0, 'x\u00e9\u4e2d\n"\\'], "\u00e9": null, A: true, "10": 0, "9": 1 },
    { z: { y: { x: [] } }, "\ud83d\ude00": "\ud83d\ude00", "\uffff": 1 },
    [],
    "s",
  ];
  for (const s of samples) assert.equal(cap.jcs(s), canonicalize(s));
});

test("end to end: plugin spool + rollout => source_sha, hook metrics, honest capability", async () => {
  const spool = await tmp();
  const repo = await tmp();
  const head = makeRepo(repo);
  for (const [ev, extra] of [
    ["SessionStart", { source: "startup" }],
    [
      "PostToolUse",
      {
        turn_id: "turn-1",
        tool_name: "exec",
        tool_use_id: "call-1",
        tool_input: {},
        tool_response: {},
      },
    ],
    ["Stop", { turn_id: "turn-2" }],
  ] as const) {
    assert.equal(spawnScript(input(ev, repo, extra), spool).code, 0);
  }
  const hookSpool = readFileSync(join(spool, `${SID}.jsonl`), "utf8");
  const actor = {
    role: "builder",
    operator_kind: "agent",
    operator_id: "codex",
    session_ref: SID,
    transport_actor: null,
  };
  const r = collectCodexRun({
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor,
    observed_at: "2026-10-23T00:00:00.000Z",
    rollout: basicSession().text,
    hookSpool,
  });
  assert.equal(r.summary.source_sha, head);
  assert.equal(r.run.head_after, head);
  assert.equal(r.run.head_before, head);
  assert.equal(r.summary.metrics.find((m) => m.name === "hook_events")?.value, 3);
  assert.equal(r.profile.signals.capture_plugin?.notes, "task-meta-capture@0.3.0");
  assert.equal(r.profile.signals.source_head?.epistemic, "OBSERVED");
  assert.ok(r.summary.observation_refs.includes(`codex:hook-spool:${SID}`));
  assert.ok(!r.limits.some((l) => /source SHA at the end/.test(l)));
  assert.deepEqual(findForbiddenContent(r.summary, SENT), []);
  const an = analyzeCodexHooks(parseCodexHookSpool(hookSpool).entries);
  assert.equal(an.toolCalls, 1);
  assert.equal(an.stops, 1);
  assert.equal(an.remoteRepo, "kaicreator-mm/task-meta");

  // another session's entries, torn and tampered lines are accounted for, never trusted
  const spoolB = await tmp();
  const foreignIn = JSON.parse(input("Stop", repo, { turn_id: "t9" }));
  foreignIn.session_id = "other-session";
  assert.equal(spawnScript(JSON.stringify(foreignIn), spoolB).code, 0);
  const other = readFileSync(join(spoolB, "other-session.jsonl"), "utf8");
  const lines = hookSpool.split("\n").filter(Boolean);
  const tampered = lines[0]?.replace('"mode":"default"', '"mode":"plan"') ?? "";
  const messy = `${other}${tampered}\n${lines[1]}\n${lines[1]}\n{"d":"x"`;
  const r2 = collectCodexRun({
    repository: "kaicreator-mm/task-meta",
    issue_number: 7,
    actor,
    observed_at: "2026-10-23T00:00:00.000Z",
    rollout: basicSession().text,
    hookSpool: messy,
  });
  assert.ok(r2.limits.some((l) => /hook entr\(ies\) from other sessions ignored/.test(l)));
  assert.ok(r2.limits.some((l) => /hook spool line\(s\) skipped/.test(l)));
  assert.ok(r2.limits.some((l) => /duplicate hook spool line/.test(l)));
  assert.equal(r2.summary.source_sha, null);
});

test("shell command classes match the zcode classifier on shared samples", () => {
  assert.equal(cap.classifyCommand("npm test"), "TEST");
  assert.equal(cap.classifyCommand("cd x && git status"), "VCS");
  assert.equal(cap.classifyCommand("npx tsc --noEmit"), "TYPECHECK_LINT");
  assert.equal(cap.classifyCommand("cat a > b"), "FILE_WRITE");
  assert.equal(cap.classifyCommand("weird-tool"), "OTHER");
});
